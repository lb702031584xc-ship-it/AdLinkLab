/**
 * TEST-ONLY Phase 6.1 / 7.1 PostgreSQL harness.
 * Binaries: C:\adlinklab-epg\windows-x64 (ASCII path — required on Chinese Windows).
 *
 * Windows lifecycle facts baked into this harness:
 * 1) `pg_ctl start` always implies `-w` on Windows and can hang forever under Cursor.
 * 2) `spawn(postgres, { detached: true })` creates new consoles → popup storm.
 * 3) Non-detached `postgres.exe` as Node child dies when the CLI Node process exits.
 *
 * Strategy:
 * - `spawn(pg_ctl start)` with windowsHide (no wait on the Node side)
 * - poll TCP/auth until ready
 * - then kill ONLY the hung pg_ctl waiter (not /T tree) so postmaster keeps running
 * - stop via pg_ctl stop (timeout-bounded) + scoped postmaster taskkill /PID /T if needed
 * - duplicate start reuses healthy instance
 * - SIGINT/SIGTERM/exit cleanup when ownedInProcess (in-process tests)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

const ASCII_ROOT = "C:\\adlinklab-epg";
const BIN_DIR = join(ASCII_ROOT, "windows-x64", "native", "bin");
const DATA_DIR = join(ASCII_ROOT, "data-phase61");
const LOG_FILE = join(ASCII_ROOT, "phase61-postgres.log");
const MARKER_FILE = join(ASCII_ROOT, "phase61.running.json");
const MUTEX_FILE = join(ASCII_ROOT, "phase61.mutex");
const LEASE_FILE = join(ASCII_ROOT, "phase61.leases.json");
const PORT = 55432;
const USER = "adlinklab";
const PASSWORD = "adlinklab";
const DB_NAME = "adlinklab_phase61_test";

export function phase61DatabaseUrl(database = DB_NAME): string {
  return `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${database}?schema=public`;
}

function bin(name: string): string {
  const p = join(BIN_DIR, name);
  if (!existsSync(p)) {
    throw new Error(`Missing binary ${p}`);
  }
  return p;
}

function runSync(
  command: string,
  args: string[],
  timeoutMs = 120_000
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync(command, args, {
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
    windowsHide: true,
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function waitForPort(
  port: number,
  host = "127.0.0.1",
  ms = 20000
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > ms) {
          reject(new Error(`timeout waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });
    };
    tryConnect();
  });
}

async function waitForPortClosed(
  port: number,
  host = "127.0.0.1",
  ms = 15000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!open) return;
    await delay(200);
  }
  throw new Error(`timeout waiting for ${host}:${port} to close`);
}

async function isHealthy(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: phase61DatabaseUrl("postgres"),
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function readPostmasterPid(): number | null {
  const pidPath = join(DATA_DIR, "postmaster.pid");
  if (!existsSync(pidPath)) return null;
  try {
    const first = readFileSync(pidPath, "utf8").split(/\r?\n/)[0]?.trim();
    const pid = first ? Number(first) : NaN;
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill ONLY data-phase61 postmaster tree. Never taskkill /IM postgres.exe. */
function killScopedClusterTree(): void {
  const pid = readPostmasterPid();
  if (!pid) return;
  runSync("taskkill", ["/PID", String(pid), "/T", "/F"], 30_000);
}

function writeMarker(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    MARKER_FILE,
    JSON.stringify(
      {
        dataDir: DATA_DIR,
        port: PORT,
        database: DB_NAME,
        postmasterPid: readPostmasterPid(),
        startedAt: new Date().toISOString(),
        ...extra,
      },
      null,
      2
    ),
    "utf8"
  );
}

function clearMarker(): void {
  try {
    rmSync(MARKER_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

let ownedInProcess = false;
let hooksInstalled = false;
let pgCtlWaiter: ChildProcess | null = null;
let startInFlight: Promise<{
  databaseUrl: string;
  port: number;
  reused: boolean;
}> | null = null;

async function withPhase61Mutex<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(ASCII_ROOT, { recursive: true });
  const deadline = Date.now() + 180_000;
  while (true) {
    let fd: number | undefined;
    try {
      fd = openSync(MUTEX_FILE, "wx");
      return await fn();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        throw new Error("timeout waiting for phase61 postgres mutex");
      }
      await delay(150);
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          rmSync(MUTEX_FILE, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function liveLeaseHolders(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(LEASE_FILE, "utf8")) as {
      holders?: Record<string, number>;
    };
    const holders: Record<string, number> = {};
    for (const [pid, count] of Object.entries(raw.holders ?? {})) {
      const n = Number(pid);
      const c = Number(count);
      if (Number.isFinite(n) && n > 0 && processExists(n) && c > 0) {
        holders[String(n)] = c;
      }
    }
    return holders;
  } catch {
    return {};
  }
}

function writeLeases(holders: Record<string, number>): void {
  writeFileSync(
    LEASE_FILE,
    JSON.stringify({ holders, updatedAt: new Date().toISOString() })
  );
}

function addLease(): void {
  const holders = liveLeaseHolders();
  const key = String(process.pid);
  holders[key] = (holders[key] ?? 0) + 1;
  writeLeases(holders);
}

function removeLease(): number {
  const holders = liveLeaseHolders();
  const key = String(process.pid);
  const next = (holders[key] ?? 1) - 1;
  if (next <= 0) delete holders[key];
  else holders[key] = next;
  writeLeases(holders);
  return Object.values(holders).reduce((sum, n) => sum + n, 0);
}

function rmDataDirBestEffort(): void {
  for (let i = 0; i < 8; i++) {
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
      return;
    } catch {
      spawnSync("cmd.exe", ["/c", "ping", "127.0.0.1", "-n", "2"], {
        windowsHide: true,
        timeout: 4000,
      });
    }
  }
}

function stopSyncBestEffort(): void {
  if (pgCtlWaiter && pgCtlWaiter.exitCode === null && !pgCtlWaiter.killed) {
    try {
      pgCtlWaiter.kill();
    } catch {
      /* ignore */
    }
  }
  pgCtlWaiter = null;
  if (existsSync(join(DATA_DIR, "postmaster.pid"))) {
    runSync(bin("pg_ctl.exe"), ["-D", DATA_DIR, "stop", "-m", "fast"], 30_000);
  }
  const pid = readPostmasterPid();
  if (pid && processExists(pid)) {
    killScopedClusterTree();
  }
  clearMarker();
  ownedInProcess = false;
}

function installExitHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  const onSignal = () => {
    try {
      if (ownedInProcess) stopSyncBestEffort();
    } finally {
      process.exitCode = process.exitCode ?? 130;
    }
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("exit", () => {
    if (ownedInProcess) stopSyncBestEffort();
  });
}

/**
 * Start postmaster via pg_ctl without blocking on Windows' implied -w.
 * After port is up, kill the hung pg_ctl waiter only (not process tree).
 */
async function startPostmasterViaPgCtl(): Promise<void> {
  try {
    rmSync(LOG_FILE, { force: true });
  } catch {
    /* ignore */
  }

  pgCtlWaiter = spawn(
    bin("pg_ctl.exe"),
    ["-D", DATA_DIR, "-l", LOG_FILE, "start"],
    {
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
      windowsHide: true,
      detached: false,
      stdio: "ignore",
      shell: false,
    }
  );

  try {
    await waitForPort(PORT);
  } catch (error) {
    if (pgCtlWaiter.exitCode === null && !pgCtlWaiter.killed) {
      try {
        pgCtlWaiter.kill();
      } catch {
        /* ignore */
      }
    }
    pgCtlWaiter = null;
    throw error;
  }

  // Postmaster is up. End the Windows-implied wait loop of pg_ctl only.
  if (pgCtlWaiter.exitCode === null && !pgCtlWaiter.killed) {
    try {
      pgCtlWaiter.kill();
    } catch {
      /* ignore */
    }
  }
  pgCtlWaiter = null;
  await delay(200);
}

async function startPhase61PostgresImpl(): Promise<{
  databaseUrl: string;
  port: number;
  reused: boolean;
}> {
  if (!existsSync(join(BIN_DIR, "postgres.exe"))) {
    throw new Error(
      `Missing ${BIN_DIR}\\postgres.exe — copy @embedded-postgres/windows-x64 to ${ASCII_ROOT}`
    );
  }

  installExitHooks();

  if (await isHealthy()) {
    ownedInProcess = true;
    writeMarker({ reused: true });
    return { databaseUrl: phase61DatabaseUrl(), port: PORT, reused: true };
  }

  await stopPhase61PostgresImpl().catch(() => undefined);

  rmDataDirBestEffort();
  if (existsSync(DATA_DIR) && (await isHealthy())) {
    ownedInProcess = true;
    writeMarker({ reused: true });
    return { databaseUrl: phase61DatabaseUrl(), port: PORT, reused: true };
  }
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(ASCII_ROOT, { recursive: true });

  const pwfile = join(ASCII_ROOT, "pwfile.txt");
  writeFileSync(pwfile, PASSWORD, { encoding: "utf8" });

  const init = runSync(bin("initdb.exe"), [
    "-D",
    DATA_DIR,
    "-U",
    USER,
    "--pwfile",
    pwfile,
    "--locale=C",
    "--encoding=UTF8",
    "--auth=password",
  ]);
  if (init.status !== 0) {
    if (await isHealthy()) {
      ownedInProcess = true;
      writeMarker({ reused: true });
      return { databaseUrl: phase61DatabaseUrl(), port: PORT, reused: true };
    }
    throw new Error(
      `initdb failed: ${init.stderr || init.stdout || init.error?.message}`
    );
  }

  writeFileSync(
    join(DATA_DIR, "postgresql.conf"),
    `
listen_addresses = '127.0.0.1'
port = ${PORT}
timezone = 'UTC'
lc_messages = 'C'
`,
    { flag: "a", encoding: "utf8" }
  );

  writeFileSync(
    join(DATA_DIR, "pg_hba.conf"),
    `host all all 127.0.0.1/32 password\nhost all all ::1/128 password\n`,
    { encoding: "utf8" }
  );

  await startPostmasterViaPgCtl();

  let admin: pg.Client | null = null;
  let lastError: unknown;
  for (let i = 0; i < 40; i++) {
    admin = new pg.Client({
      connectionString: phase61DatabaseUrl("postgres"),
      connectionTimeoutMillis: 2000,
    });
    try {
      await admin.connect();
      await admin.query("SELECT 1");
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      try {
        await admin.end();
      } catch {
        /* ignore */
      }
      admin = null;
      await delay(250);
    }
  }
  if (!admin) {
    await stopPhase61PostgresImpl().catch(() => undefined);
    throw new Error(`postgres auth not ready: ${String(lastError)}`);
  }
  try {
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [DB_NAME]
    );
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${DB_NAME}`);
    }
  } finally {
    await admin.end();
  }

  const db = new pg.Client({ connectionString: phase61DatabaseUrl() });
  await db.connect();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  } finally {
    await db.end();
  }

  ownedInProcess = true;
  writeMarker({ reused: false });
  return { databaseUrl: phase61DatabaseUrl(), port: PORT, reused: false };
}

export function startPhase61Postgres(): Promise<{
  databaseUrl: string;
  port: number;
  reused: boolean;
}> {
  if (!startInFlight) {
    startInFlight = withPhase61Mutex(async () => {
      const result = await startPhase61PostgresImpl();
      addLease();
      return result;
    }).finally(() => {
      startInFlight = null;
    });
  }
  return startInFlight;
}

async function stopPhase61PostgresImpl(): Promise<void> {
  if (pgCtlWaiter && pgCtlWaiter.exitCode === null && !pgCtlWaiter.killed) {
    try {
      pgCtlWaiter.kill();
    } catch {
      /* ignore */
    }
  }
  pgCtlWaiter = null;

  const pidPath = join(DATA_DIR, "postmaster.pid");
  const pid = readPostmasterPid();

  if (existsSync(pidPath)) {
    runSync(bin("pg_ctl.exe"), ["-D", DATA_DIR, "stop", "-m", "fast"], 30_000);
    await delay(400);
    if (pid && processExists(pid)) {
      killScopedClusterTree();
    }
  } else if (existsSync(MARKER_FILE) && (await isHealthy())) {
    try {
      const marker = JSON.parse(readFileSync(MARKER_FILE, "utf8")) as {
        postmasterPid?: number;
      };
      if (marker.postmasterPid) {
        runSync(
          "taskkill",
          ["/PID", String(marker.postmasterPid), "/T", "/F"],
          30_000
        );
      }
    } catch {
      /* ignore */
    }
  }

  try {
    await waitForPortClosed(PORT);
  } catch {
    if (readPostmasterPid()) {
      killScopedClusterTree();
      await waitForPortClosed(PORT).catch(() => undefined);
    }
  }

  const stalePid = readPostmasterPid();
  if (stalePid && !processExists(stalePid)) {
    try {
      rmSync(pidPath, { force: true });
    } catch {
      /* ignore */
    }
  }

  ownedInProcess = false;
  clearMarker();
  await delay(200);

  const stillOpen = await isHealthy().catch(() => false);
  if (!stillOpen) {
    rmDataDirBestEffort();
  }
}

export async function stopPhase61Postgres(): Promise<void> {
  await withPhase61Mutex(async () => {
    const remaining = removeLease();
    if (remaining > 0) return;
    await stopPhase61PostgresImpl();
  });
}

/** CLI leave-running: clear in-process ownership so exit hooks do not stop PG. */
export function releaseCliOwnership(): void {
  ownedInProcess = false;
}

export async function withPhase61Client<T>(
  fn: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({ connectionString: phase61DatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const cmd = process.argv[2] ?? "start";
  if (cmd === "start") {
    const r = await startPhase61Postgres();
    releaseCliOwnership();
    console.log(
      JSON.stringify({
        ok: true,
        port: r.port,
        database: DB_NAME,
        reused: r.reused,
        databaseUrlConfigured: true,
        note: "Cluster left running; call phase61:stop when finished",
      })
    );
  } else if (cmd === "stop") {
    await stopPhase61Postgres();
    console.log(JSON.stringify({ ok: true, stopped: true }));
  } else if (cmd === "status") {
    const healthy = await isHealthy();
    const pid = readPostmasterPid();
    console.log(
      JSON.stringify({
        ok: true,
        healthy,
        port: PORT,
        postmasterPid: pid,
        processAlive: pid ? processExists(pid) : false,
        dataDir: DATA_DIR,
        marker: existsSync(MARKER_FILE),
      })
    );
  } else if (cmd === "url") {
    console.log(phase61DatabaseUrl());
  } else {
    console.error("usage: phase61-pg-harness.mts start|stop|status|url");
    process.exitCode = 1;
  }
}
