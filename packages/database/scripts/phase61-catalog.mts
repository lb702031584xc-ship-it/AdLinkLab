import pg from "pg";

const url =
  process.env.DATABASE_URL ??
  "postgresql://adlinklab:adlinklab@127.0.0.1:55432/adlinklab_phase61_test?schema=public";

const c = new pg.Client({ connectionString: url });
await c.connect();
const ver = await c.query("SELECT version()");
console.log("PG_VERSION:", String(ver.rows[0].version).split(",")[0]);
const idx = await c.query(`
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('url_versions', 'url_change_requests', 'sync_jobs')
  ORDER BY tablename, indexname
`);
for (const r of idx.rows) {
  console.log(`${r.tablename} | ${r.indexname}`);
  console.log(`  ${r.indexdef}`);
}
await c.end();
