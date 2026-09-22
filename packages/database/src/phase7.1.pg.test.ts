/**
 * Phase 7.1 — PostgreSQL catalog + constraint verification (TEST-ONLY).
 * Reuses Phase 6.1 harness (C:\\adlinklab-epg, port 55432).
 * Opt-in: PHASE61_PG=1 or PHASE71_PG=1
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../scripts/phase61-pg-harness.mts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const RUN_PG =
  process.env.PHASE61_PG === "1" || process.env.PHASE71_PG === "1";

describe.skipIf(!RUN_PG)("Phase 7.1 PostgreSQL catalog / constraints", () => {
  let prisma: PrismaClient;
  let startedByUs = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = phase61DatabaseUrl();
    prisma = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });

    let healthy = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'conversions'
      `;
      healthy = tables.length > 0;
    } catch {
      healthy = false;
      await prisma.$disconnect().catch(() => undefined);
    }

    if (!healthy) {
      await startPhase61Postgres();
      startedByUs = true;
      const reset = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/phase61-reset-db.mts"],
        {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
          encoding: "utf8",
          shell: true,
        }
      );
      if (reset.status !== 0) {
        throw new Error(`reset failed: ${reset.stdout}\n${reset.stderr}`);
      }
      const migrate = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/phase61-migrate-deploy.mts"],
        {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
          encoding: "utf8",
          shell: true,
        }
      );
      if (migrate.status !== 0) {
        throw new Error(`migrate failed: ${migrate.stdout}\n${migrate.stderr}`);
      }
      prisma = new PrismaClient({
        datasources: { db: { url: phase61DatabaseUrl() } },
      });
      await prisma.$queryRaw`SELECT 1`;
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (startedByUs) {
      await stopPhase61Postgres();
    }
  });

  it("migration: orders/conversions/sync_jobs/audit_logs exist", async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const names = new Set(rows.map((r) => r.tablename));
    for (const t of ["orders", "conversions", "sync_jobs", "audit_logs", "clicks"]) {
      expect(names.has(t), t).toBe(true);
    }
  });

  it("decimal: orders.value + conversions.value are numeric(19,4)", async () => {
    const rows = await prisma.$queryRaw<
      Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }>
    >`
      SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'orders' AND column_name = 'value')
          OR (table_name = 'conversions' AND column_name = 'value')
        )
    `;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.data_type).toBe("numeric");
      expect(r.numeric_precision).toBe(19);
      expect(r.numeric_scale).toBe(4);
    }
  });

  it("timestamps: timestamptz for Phase 7 fields", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; udt_name: string }>
    >`
      SELECT table_name, column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'conversions' AND column_name IN (
            'conversion_time', 'created_at', 'updated_at', 'archived_at', 'deleted_at'
          ))
          OR (table_name = 'orders' AND column_name IN (
            'created_at', 'updated_at', 'archived_at', 'deleted_at'
          ))
          OR (table_name = 'sync_jobs' AND column_name IN (
            'started_at', 'completed_at', 'created_at', 'updated_at'
          ))
          OR (table_name = 'audit_logs' AND column_name = 'created_at')
          OR (table_name = 'clicks' AND column_name IN ('occurred_at', 'created_at'))
        )
    `;
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) {
      expect(r.udt_name, `${r.table_name}.${r.column_name}`).toBe("timestamptz");
    }
  });

  it("catalog: Conversion has no order_id / gclid columns (Order.conversion_id authority)", async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversions'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("order_id");
    expect(names).not.toContain("gclid");
    expect(names).toContain("click_id");
    expect(names).toContain("idempotency_scope");
    expect(names).toContain("idempotency_key");
    expect(names).toContain("google_upload_status");
    expect(names).toContain("google_conversion_resource_name");
  });

  it("catalog: Order has conversion_id + tenant business order unique", async () => {
    const idxs = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'orders'
    `;
    const defs = idxs.map((i) => i.indexdef).join("\n");
    expect(defs).toMatch(/tenant_id.*order_id/i);
    expect(defs).toMatch(/idempotency/i);
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
    `;
    expect(cols.map((c) => c.column_name)).toContain("conversion_id");
  });

  it("catalog: SyncJob tenant+scope+key unique", async () => {
    const idxs = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'sync_jobs' AND indexdef ILIKE '%idempotency%'
    `;
    expect(idxs.some((r) => /tenant_id/i.test(r.indexdef))).toBe(true);
  });

  it("FK: conversions.click_id / orders.click_id / orders.conversion_id ON DELETE RESTRICT", async () => {
    const fks = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; delete_rule: string }>
    >`
      SELECT tc.table_name, kcu.column_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND (
          (tc.table_name = 'conversions' AND kcu.column_name = 'click_id')
          OR (tc.table_name = 'orders' AND kcu.column_name IN ('click_id', 'conversion_id'))
        )
    `;
    expect(fks.length).toBeGreaterThanOrEqual(3);
    for (const fk of fks) {
      expect(fk.delete_rule).toBe("RESTRICT");
    }
  });

  it("DB unique: duplicate conversion idempotency rejected (P2002)", async () => {
    const tenantId = randomUUID();
    const offerId = randomUUID();
    const landingId = randomUUID();
    const trackingId = randomUUID();
    const clickId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "p71-idem",
        slug: `p71-idem-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    await prisma.offer.create({
      data: {
        id: offerId,
        tenantId,
        name: "o",
        network: "test",
        destinationUrl: "https://example.com",
        status: "ACTIVE",
      },
    });
    await prisma.landingPage.create({
      data: {
        id: landingId,
        tenantId,
        offerId,
        name: "lp",
        url: "https://example.com/lp",
        domain: "example.com",
        status: "ACTIVE",
      },
    });
    await prisma.trackingLink.create({
      data: {
        id: trackingId,
        tenantId,
        publicId: `trk-${trackingId.slice(0, 8)}`,
        offerId,
        landingPageId: landingId,
        status: "ACTIVE",
      },
    });
    await prisma.click.create({
      data: {
        id: clickId,
        clickId,
        tenantId,
        trackingLinkId: trackingId,
        gclid: "gclid-catalog-1",
        occurredAt: new Date(),
      },
    });
    const scope = "CONVERSION";
    const key = "p71-conv-idem-1";
    await prisma.conversion.create({
      data: {
        id: randomUUID(),
        tenantId,
        clickId,
        conversionAction: "purchase",
        conversionTime: new Date(),
        value: "10.0000",
        currency: "USD",
        status: "ATTRIBUTED",
        googleUploadStatus: "NOT_UPLOADED",
        idempotencyScope: scope,
        idempotencyKey: key,
      },
    });
    await expect(
      prisma.conversion.create({
        data: {
          id: randomUUID(),
          tenantId,
          clickId,
          conversionAction: "purchase",
          conversionTime: new Date(),
          value: "10.0000",
          currency: "USD",
          status: "ATTRIBUTED",
          googleUploadStatus: "NOT_UPLOADED",
          idempotencyScope: scope,
          idempotencyKey: key,
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("DB unique: duplicate order (tenantId, orderId) rejected", async () => {
    const tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "p71-ord",
        slug: `p71-ord-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    await prisma.order.create({
      data: {
        id: randomUUID(),
        tenantId,
        orderId: "BIZ-001",
        value: "1.0000",
        currency: "USD",
        status: "CONFIRMED",
        idempotencyScope: "ORDER",
        idempotencyKey: "ord-key-1",
      },
    });
    await expect(
      prisma.order.create({
        data: {
          id: randomUUID(),
          tenantId,
          orderId: "BIZ-001",
          value: "2.0000",
          currency: "USD",
          status: "CONFIRMED",
          idempotencyScope: "ORDER",
          idempotencyKey: "ord-key-2",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("soft-delete columns exist; no uploaded_at column on conversions", async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('orders', 'conversions')
    `;
    const names = new Set(cols.map((c) => c.column_name));
    expect(names.has("archived_at")).toBe(true);
    expect(names.has("deleted_at")).toBe(true);
    expect(names.has("uploaded_at")).toBe(false);
  });

  it("transaction rollback leaves no half-created order+conversion", async () => {
    const tenantId = randomUUID();
    const offerId = randomUUID();
    const trackingId = randomUUID();
    const clickId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "p71-tx",
        slug: `p71-tx-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    await prisma.offer.create({
      data: {
        id: offerId,
        tenantId,
        name: "o",
        network: "test",
        destinationUrl: "https://example.com",
        status: "ACTIVE",
      },
    });
    await prisma.trackingLink.create({
      data: {
        id: trackingId,
        tenantId,
        publicId: `trk-tx-${trackingId.slice(0, 8)}`,
        offerId,
        status: "ACTIVE",
      },
    });
    await prisma.click.create({
      data: {
        id: clickId,
        clickId,
        tenantId,
        trackingLinkId: trackingId,
        gclid: "gclid-tx",
        occurredAt: new Date(),
      },
    });

    const orderId = randomUUID();
    const conversionId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            id: orderId,
            tenantId,
            orderId: "TX-ROLLBACK",
            clickId,
            value: "5.0000",
            currency: "USD",
            status: "CONFIRMED",
            idempotencyScope: "ORDER",
            idempotencyKey: "tx-ord",
          },
        });
        await tx.conversion.create({
          data: {
            id: conversionId,
            tenantId,
            clickId,
            conversionAction: "purchase",
            conversionTime: new Date(),
            value: "5.0000",
            currency: "USD",
            status: "ATTRIBUTED",
            googleUploadStatus: "NOT_UPLOADED",
            idempotencyScope: "CONVERSION",
            idempotencyKey: "tx-conv",
          },
        });
        throw new Error("forced rollback");
      })
    ).rejects.toThrow("forced rollback");

    expect(await prisma.order.findUnique({ where: { id: orderId } })).toBeNull();
    expect(
      await prisma.conversion.findUnique({ where: { id: conversionId } })
    ).toBeNull();
  });

  it("FK restrict: cannot delete click referenced by conversion", async () => {
    const tenantId = randomUUID();
    const offerId = randomUUID();
    const trackingId = randomUUID();
    const clickId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "p71-fk",
        slug: `p71-fk-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    await prisma.offer.create({
      data: {
        id: offerId,
        tenantId,
        name: "o",
        network: "test",
        destinationUrl: "https://example.com",
        status: "ACTIVE",
      },
    });
    await prisma.trackingLink.create({
      data: {
        id: trackingId,
        tenantId,
        publicId: `trk-fk-${trackingId.slice(0, 8)}`,
        offerId,
        status: "ACTIVE",
      },
    });
    await prisma.click.create({
      data: {
        id: clickId,
        clickId,
        tenantId,
        trackingLinkId: trackingId,
        gclid: "gclid-fk",
        occurredAt: new Date(),
      },
    });
    await prisma.conversion.create({
      data: {
        id: randomUUID(),
        tenantId,
        clickId,
        conversionAction: "purchase",
        conversionTime: new Date(),
        status: "ATTRIBUTED",
        googleUploadStatus: "NOT_UPLOADED",
        idempotencyScope: "CONVERSION",
        idempotencyKey: "fk-conv",
      },
    });
    await expect(prisma.click.delete({ where: { id: clickId } })).rejects.toBeTruthy();
  });
});
