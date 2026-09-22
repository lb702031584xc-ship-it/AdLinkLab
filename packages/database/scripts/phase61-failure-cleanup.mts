/** TEST-ONLY: prove failure path still stops owned cluster */
import {
  startPhase61Postgres,
  stopPhase61Postgres,
  phase61DatabaseUrl,
} from "./phase61-pg-harness.mts";
import pg from "pg";

async function countPostgres(): Promise<number> {
  // Best-effort via port health, not process list (portable enough for this check).
  const client = new pg.Client({
    connectionString: phase61DatabaseUrl("postgres"),
    connectionTimeoutMillis: 800,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return 1;
  } catch {
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

await stopPhase61Postgres().catch(() => undefined);
await startPhase61Postgres();
const before = await countPostgres();
console.log(JSON.stringify({ started: true, healthy: before === 1 }));

try {
  throw new Error("intentional failure");
} catch {
  await stopPhase61Postgres();
}

const after = await countPostgres();
console.log(
  JSON.stringify({
    afterFailureCleanup: true,
    healthy: after === 1,
    cleaned: after === 0,
  })
);
if (after !== 0) process.exitCode = 1;
