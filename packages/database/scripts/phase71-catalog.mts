/**
 * TEST-ONLY Phase 7.1 catalog dump for Order / Conversion / SyncJob / AuditLog.
 * Reuses Phase 6.1 DATABASE_URL (port 55432). Does not mutate business code.
 */
import pg from "pg";

const url =
  process.env.DATABASE_URL ??
  "postgresql://adlinklab:adlinklab@127.0.0.1:55432/adlinklab_phase61_test?schema=public";

const tables = ["orders", "conversions", "sync_jobs", "audit_logs", "clicks"];

const c = new pg.Client({ connectionString: url });
await c.connect();

const ver = await c.query("SELECT version()");
console.log("PG_VERSION:", String(ver.rows[0].version).split(",")[0]);

const cols = await c.query(
  `
  SELECT table_name, column_name, data_type, udt_name, numeric_precision, numeric_scale,
         is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  ORDER BY table_name, ordinal_position
`,
  [tables]
);
console.log("\n=== COLUMNS ===");
for (const r of cols.rows) {
  const num =
    r.data_type === "numeric"
      ? ` numeric(${r.numeric_precision},${r.numeric_scale})`
      : "";
  console.log(
    `${r.table_name}.${r.column_name}: ${r.data_type}/${r.udt_name}${num} null=${r.is_nullable}`
  );
}

const idxs = await c.query(
  `
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = ANY($1::text[])
  ORDER BY tablename, indexname
`,
  [tables]
);
console.log("\n=== INDEXES ===");
for (const r of idxs.rows) {
  console.log(`${r.tablename} | ${r.indexname}`);
  console.log(`  ${r.indexdef}`);
}

const fks = await c.query(
  `
  SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column,
    rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = ANY($1::text[])
  ORDER BY tc.table_name, kcu.column_name
`,
  [tables]
);
console.log("\n=== FOREIGN KEYS ===");
for (const r of fks.rows) {
  console.log(
    `${r.table_name}.${r.column_name} → ${r.foreign_table}.${r.foreign_column} ON DELETE ${r.delete_rule}`
  );
}

await c.end();
