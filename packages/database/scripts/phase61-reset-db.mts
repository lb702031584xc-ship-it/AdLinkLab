import pg from "pg";

const adminUrl = "postgresql://adlinklab:adlinklab@127.0.0.1:55432/postgres";
const dbName = "adlinklab_phase61_test";
const dbUrl = `postgresql://adlinklab:adlinklab@127.0.0.1:55432/${dbName}?schema=public`;

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
  [dbName]
);
await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
await db.end();
console.log(JSON.stringify({ ok: true, reset: dbName }));
