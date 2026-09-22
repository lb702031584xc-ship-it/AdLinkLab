/**
 * Phase 9.3 — Readiness dependency probes (no secrets in results).
 */
import type { PrismaClient } from "@adlinklab/database";
import RedisImport from "ioredis";

export type DependencyStatus = "ok" | "down" | "skipped";

export interface ReadinessCheck {
  name: "postgres" | "redis";
  status: DependencyStatus;
}

export interface ReadinessResult {
  status: "ok" | "not_ready";
  checks: ReadinessCheck[];
}

export interface ReadinessDeps {
  persistence: "memory" | "prisma";
  queueMode: "off" | "redis";
  prisma?: PrismaClient;
  /** Override redis URL for tests; never returned in responses. */
  redisUrl?: string;
  env?: NodeJS.ProcessEnv;
}

type RedisProbeClient = {
  connect(): Promise<void>;
  ping(): Promise<string>;
  disconnect(): void;
  on(event: "error", listener: (err: Error) => void): void;
};

/** ioredis CJS/ESM interop — constructable client for readiness probes only. */
const Redis = RedisImport as unknown as {
  new (url: string, options?: Record<string, unknown>): RedisProbeClient;
};

async function checkPostgres(prisma: PrismaClient | undefined): Promise<DependencyStatus> {
  if (!prisma) return "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "down";
  }
}

async function checkRedis(url: string): Promise<DependencyStatus> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on("error", () => {
    /* swallow probe errors — status returned as down */
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : "down";
  } catch {
    return "down";
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Ready when required deps are ok.
 * - prisma persistence → postgres required
 * - redis queue mode → redis required
 * - memory + queue off → postgres/redis skipped → ready
 */
export async function evaluateReadiness(
  deps: ReadinessDeps
): Promise<ReadinessResult> {
  const env = deps.env ?? process.env;
  const checks: ReadinessCheck[] = [];

  if (deps.persistence === "prisma") {
    checks.push({
      name: "postgres",
      status: await checkPostgres(deps.prisma),
    });
  } else {
    checks.push({ name: "postgres", status: "skipped" });
  }

  if (deps.queueMode === "redis") {
    const url = (deps.redisUrl ?? env.REDIS_URL ?? "").trim();
    checks.push({
      name: "redis",
      status: url ? await checkRedis(url) : "down",
    });
  } else {
    checks.push({ name: "redis", status: "skipped" });
  }

  const failed = checks.some((c) => c.status === "down");
  return {
    status: failed ? "not_ready" : "ok",
    checks,
  };
}
