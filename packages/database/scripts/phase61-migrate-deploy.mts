/**
 * TEST-ONLY: deploy migrations to Phase 6.1 DB without mutating repo migrations.
 * Strips UTF-8 BOM which PostgreSQL rejects (P3018 / 42601).
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const SRC_MIGRATIONS = join(ROOT, "prisma", "migrations");
const SRC_SCHEMA = join(ROOT, "prisma", "schema.prisma");
const STAGING = "C:\\adlinklab-epg\\prisma-deploy";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://adlinklab:adlinklab@127.0.0.1:55432/adlinklab_phase61_test?schema=public";

function stripBom(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  const text = buf.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

rmSync(STAGING, { recursive: true, force: true });
mkdirSync(join(STAGING, "migrations"), { recursive: true });
writeFileSync(join(STAGING, "schema.prisma"), readFileSync(SRC_SCHEMA));

for (const name of readdirSync(SRC_MIGRATIONS)) {
  const srcDir = join(SRC_MIGRATIONS, name);
  const destDir = join(STAGING, "migrations", name);
  if (name === "migration_lock.toml") {
    writeFileSync(join(STAGING, "migrations", name), readFileSync(srcDir));
    continue;
  }
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    const src = join(srcDir, file);
    const dest = join(destDir, file);
    if (file.endsWith(".sql")) {
      writeFileSync(dest, stripBom(readFileSync(src)), "utf8");
    } else {
      writeFileSync(dest, readFileSync(src));
    }
  }
}

console.log(
  JSON.stringify({
    staging: STAGING,
    databaseUrlConfigured: true,
    bomStripped: true,
    repoMigrationsUnchanged: true,
  })
);

const result = spawnSync(
  "pnpm",
  ["exec", "prisma", "migrate", "deploy", "--schema", join(STAGING, "schema.prisma")],
  {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    encoding: "utf8",
    shell: true,
  }
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
