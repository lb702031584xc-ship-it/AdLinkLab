/**
 * TEST-ONLY: ensure isolated R6 database exists on Phase 61 embedded Postgres.
 * Does not mutate production DBs. No credentials printed.
 */
import pg from "pg";
import {
  phase61DatabaseUrl,
  releaseCliOwnership,
  startPhase61Postgres,
} from "./phase61-pg-harness.mts";

const R6_DB = "adlinklab_phase8410_r6_test";

const started = await startPhase61Postgres();
// Leave cluster running for subsequent migrate/test processes.
releaseCliOwnership();
const admin = new pg.Client({
  connectionString: phase61DatabaseUrl("postgres"),
});
await admin.connect();
try {
  const exists = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [R6_DB]
  );
  if ((exists.rowCount ?? 0) === 0) {
    await admin.query(`CREATE DATABASE ${R6_DB}`);
  }
} finally {
  await admin.end();
}

const db = new pg.Client({ connectionString: phase61DatabaseUrl(R6_DB) });
await db.connect();
try {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  const ver = await db.query("SELECT version()");
  const version = String(ver.rows[0]?.version ?? "").split(",")[0];
  console.log(
    JSON.stringify({
      ok: true,
      database: R6_DB,
      port: started.port,
      reused: started.reused,
      postgresVersion: version,
      databaseUrlConfigured: true,
    })
  );
} finally {
  await db.end();
}
