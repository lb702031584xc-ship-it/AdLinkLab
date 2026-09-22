/**
 * Phase 6.1 — PostgreSQL runtime verification (TEST-ONLY).
 * Requires ASCII-path binaries at C:\adlinklab-epg\windows-x64 (see scripts/phase61-*).
 * Does not modify Domain / Provider / Phase 4–5 business logic.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuditActions } from "@adlinklab/domain";
import { isRetryableGoogleAdsCode } from "@adlinklab/google-ads";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../scripts/phase61-pg-harness.mts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const RUN_PG = process.env.PHASE61_PG === "1";

describe.skipIf(!RUN_PG)("Phase 6.1 PostgreSQL runtime", () => {
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
        WHERE schemaname = 'public' AND tablename = 'url_versions'
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
        throw new Error(
          `migrate failed: ${migrate.stdout}\n${migrate.stderr}`
        );
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

  it("catalog: required tables exist", async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    const names = new Set(rows.map((r) => r.tablename));
    for (const t of [
      "tenants",
      "users",
      "google_accounts",
      "campaigns",
      "ad_groups",
      "ads",
      "ad_group_criteria",
      "offers",
      "landing_pages",
      "tracking_links",
      "clicks",
      "conversions",
      "orders",
      "url_versions",
      "url_change_requests",
      "sync_jobs",
      "audit_logs",
    ]) {
      expect(names.has(t), t).toBe(true);
    }
  });

  it("catalog: UrlVersion version unique + ACTIVE partial unique", async () => {
    const idxs = await prisma.$queryRaw<
      Array<{ indexname: string; indexdef: string }>
    >`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'url_versions'
    `;
    const defs = idxs.map((i) => i.indexdef).join("\n");
    expect(defs).toMatch(/tenant_id.*entity_type.*entity_id.*version/i);
    expect(
      idxs.some(
        (i) =>
          i.indexname === "url_versions_one_active_per_entity" ||
          /WHERE.*ACTIVE/i.test(i.indexdef)
      )
    ).toBe(true);
  });

  it("catalog: UCR + SyncJob tenant idempotency unique", async () => {
    const ucr = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'url_change_requests'
        AND indexdef ILIKE '%idempotency%'
    `;
    expect(ucr.some((r) => /tenant_id/i.test(r.indexdef))).toBe(true);

    const jobs = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'sync_jobs'
        AND indexdef ILIKE '%idempotency%'
    `;
    expect(jobs.some((r) => /tenant_id/i.test(r.indexdef))).toBe(true);
  });

  it("UrlVersion version uniqueness rejects duplicate V1", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `p61-${tenantId.slice(0, 8)}`,
        slug: `p61-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    await prisma.urlVersion.create({
      data: {
        id: randomUUID(),
        tenantId,
        entityType: "CAMPAIGN",
        entityId,
        finalUrl: "https://example.com/v1",
        customParameters: {},
        version: 1,
        status: "DRAFT",
      },
    });
    await expect(
      prisma.urlVersion.create({
        data: {
          id: randomUUID(),
          tenantId,
          entityType: "CAMPAIGN",
          entityId,
          finalUrl: "https://example.com/v1-dup",
          customParameters: {},
          version: 1,
          status: "DRAFT",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("ACTIVE uniqueness: second ACTIVE without supersede fails", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `act-${tenantId.slice(0, 8)}`,
        slug: `act-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    await prisma.urlVersion.create({
      data: {
        id: randomUUID(),
        tenantId,
        entityType: "CAMPAIGN",
        entityId,
        finalUrl: "https://example.com/a1",
        customParameters: {},
        version: 1,
        status: "ACTIVE",
      },
    });
    await expect(
      prisma.urlVersion.create({
        data: {
          id: randomUUID(),
          tenantId,
          entityType: "CAMPAIGN",
          entityId,
          finalUrl: "https://example.com/a2",
          customParameters: {},
          version: 2,
          status: "ACTIVE",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    const active = await prisma.urlVersion.findMany({
      where: { tenantId, entityId, status: "ACTIVE" },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.version).toBe(1);
  });

  it("version sequencing 1,2,3", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `seq-${tenantId.slice(0, 8)}`,
        slug: `seq-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    for (const version of [1, 2, 3]) {
      await prisma.urlVersion.create({
        data: {
          id: randomUUID(),
          tenantId,
          entityType: "AD",
          entityId,
          finalUrl: `https://example.com/s${version}`,
          customParameters: {},
          version,
          status: version === 3 ? "ACTIVE" : "SUPERSEDED",
        },
      });
    }
    const rows = await prisma.urlVersion.findMany({
      where: { tenantId, entityId },
      orderBy: { version: "asc" },
    });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
  });

  it("tenant isolation + shared idempotencyKey across tenants", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const entityId = randomUUID();
    const key = "test-key-001";
    for (const [id, slug] of [
      [a, "ta"],
      [b, "tb"],
    ] as const) {
      await prisma.tenant.create({
        data: {
          id,
          name: slug,
          slug: `${slug}-${id.slice(0, 8)}`,
          status: "ACTIVE",
        },
      });
      const vid = randomUUID();
      await prisma.urlVersion.create({
        data: {
          id: vid,
          tenantId: id,
          entityType: "AD",
          entityId,
          finalUrl: "https://example.com/iso",
          customParameters: {},
          version: 1,
          status: "DRAFT",
        },
      });
      await prisma.urlChangeRequest.create({
        data: {
          id: randomUUID(),
          tenantId: id,
          entityType: "AD",
          entityId,
          toVersionId: vid,
          reason: "iso",
          requestedBy: "user",
          status: "DRAFT",
          idempotencyScope: "URL_CHANGE",
          idempotencyKey: key,
        },
      });
    }

    const aOnly = await prisma.urlChangeRequest.findMany({
      where: { tenantId: a },
    });
    const bOnly = await prisma.urlChangeRequest.findMany({
      where: { tenantId: b },
    });
    expect(aOnly).toHaveLength(1);
    expect(bOnly).toHaveLength(1);
    expect(aOnly[0]?.id).not.toBe(bOnly[0]?.id);

    const cross = await prisma.urlVersion.findFirst({
      where: { id: (await prisma.urlVersion.findFirst({ where: { tenantId: b } }))!.id, tenantId: a },
    });
    expect(cross).toBeNull();
  });

  it("UCR lifecycle DRAFT → VALIDATED → QUEUED", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "ucr",
        slug: `ucr-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const toVersionId = randomUUID();
    await prisma.urlVersion.create({
      data: {
        id: toVersionId,
        tenantId,
        entityType: "AD",
        entityId,
        finalUrl: "https://example.com/ucr",
        customParameters: {},
        version: 1,
        status: "DRAFT",
      },
    });
    const id = randomUUID();
    let req = await prisma.urlChangeRequest.create({
      data: {
        id,
        tenantId,
        entityType: "AD",
        entityId,
        toVersionId,
        reason: "lifecycle",
        requestedBy: "user",
        status: "DRAFT",
        idempotencyScope: "URL_CHANGE",
        idempotencyKey: `ucr-${id}`,
      },
    });
    expect(req.status).toBe("DRAFT");
    req = await prisma.urlChangeRequest.update({
      where: { id },
      data: { status: "VALIDATED" },
    });
    expect(req.status).toBe("VALIDATED");
    req = await prisma.urlChangeRequest.update({
      where: { id },
      data: { status: "QUEUED", jobId: `urlChange:${id}` },
    });
    expect(req.status).toBe("QUEUED");
  });

  it("preview-equivalent read does not mutate versions", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "prev",
        slug: `prev-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const vId = randomUUID();
    await prisma.urlVersion.create({
      data: {
        id: vId,
        tenantId,
        entityType: "AD",
        entityId,
        finalUrl: "https://example.com/preview",
        customParameters: {},
        version: 1,
        status: "DRAFT",
      },
    });
    const before = await prisma.urlVersion.findUnique({ where: { id: vId } });
    // read-only "preview"
    await prisma.urlVersion.findUnique({ where: { id: vId } });
    const after = await prisma.urlVersion.findUnique({ where: { id: vId } });
    expect(after?.status).toBe(before?.status);
    expect(after?.finalUrl).toBe(before?.finalUrl);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it("idempotency same tenant returns same UCR constraint", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "idem",
        slug: `idem-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const toVersionId = randomUUID();
    await prisma.urlVersion.create({
      data: {
        id: toVersionId,
        tenantId,
        entityType: "AD",
        entityId,
        finalUrl: "https://example.com/idem",
        customParameters: {},
        version: 1,
        status: "DRAFT",
      },
    });
    const key = "test-key-001-pg";
    const first = await prisma.urlChangeRequest.create({
      data: {
        id: randomUUID(),
        tenantId,
        entityType: "AD",
        entityId,
        toVersionId,
        reason: "idem",
        requestedBy: "user",
        status: "DRAFT",
        idempotencyScope: "URL_CHANGE",
        idempotencyKey: key,
      },
    });
    await expect(
      prisma.urlChangeRequest.create({
        data: {
          id: randomUUID(),
          tenantId,
          entityType: "AD",
          entityId,
          toVersionId,
          reason: "idem",
          requestedBy: "user",
          status: "DRAFT",
          idempotencyScope: "URL_CHANGE",
          idempotencyKey: key,
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
    const found = await prisma.urlChangeRequest.findFirst({
      where: { tenantId, idempotencyScope: "URL_CHANGE", idempotencyKey: key },
    });
    expect(found?.id).toBe(first.id);
  });

  it("concurrent ACTIVE inserts → exactly one ACTIVE", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "conc",
        slug: `conc-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const results = await Promise.allSettled(
      [2, 3].map((version) =>
        prisma.urlVersion.create({
          data: {
            id: randomUUID(),
            tenantId,
            entityType: "AD",
            entityId,
            finalUrl: `https://example.com/c${version}`,
            customParameters: {},
            version,
            status: "ACTIVE",
          },
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    const active = await prisma.urlVersion.count({
      where: { tenantId, entityId, status: "ACTIVE" },
    });
    expect(active).toBe(1);
  });

  it("rollback keeps V1/V2/V3 rows; V2 ROLLED_BACK; V3 ACTIVE", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "rb",
        slug: `rb-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const v1 = randomUUID();
    const v2 = randomUUID();
    const v3 = randomUUID();
    await prisma.urlVersion.create({
      data: {
        id: v1,
        tenantId,
        entityType: "AD",
        entityId,
        finalUrl: "https://example.com/r1",
        customParameters: {},
        version: 1,
        status: "SUPERSEDED",
      },
    });
    await prisma.urlVersion.create({
      data: {
        id: v2,
        tenantId,
        entityType: "AD",
        entityId,
        finalUrl: "https://example.com/r2",
        customParameters: {},
        version: 2,
        status: "ACTIVE",
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.urlVersion.update({
        where: { id: v2 },
        data: { status: "ROLLED_BACK" },
      });
      await tx.urlVersion.create({
        data: {
          id: v3,
          tenantId,
          entityType: "AD",
          entityId,
          finalUrl: "https://example.com/r1",
          customParameters: {},
          version: 3,
          status: "ACTIVE",
        },
      });
    });
    const count = await prisma.urlVersion.count({ where: { tenantId, entityId } });
    expect(count).toBe(3);
    expect((await prisma.urlVersion.findUnique({ where: { id: v2 } }))?.status).toBe(
      "ROLLED_BACK"
    );
    expect((await prisma.urlVersion.findUnique({ where: { id: v3 } }))?.status).toBe(
      "ACTIVE"
    );
  });

  it("SyncJob urlChange fields persist", async () => {
    const tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "job",
        slug: `job-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const requestId = randomUUID();
    const job = await prisma.syncJob.create({
      data: {
        id: randomUUID(),
        tenantId,
        type: "urlChange",
        status: "PENDING",
        provider: "mock",
        idempotencyScope: "SYNC_JOB",
        idempotencyKey: `job-${requestId}`,
        jobId: `urlChange:${requestId}`,
        attempts: 0,
      },
    });
    const running = await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: 1 },
    });
    expect(running.attempts).toBe(1);
    const done = await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    expect(done.status).toBe("COMPLETED");
  });

  it("transaction atomicity rolls back partial state", async () => {
    const tenantId = randomUUID();
    const entityId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: "tx",
        slug: `tx-${tenantId.slice(0, 8)}`,
        status: "ACTIVE",
      },
    });
    const v1 = randomUUID();
    await prisma.urlVersion.create({
      data: {
        id: v1,
        tenantId,
        entityType: "AD",
        entityId,
        finalUrl: "https://example.com/tx1",
        customParameters: {},
        version: 1,
        status: "ACTIVE",
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.urlVersion.update({
          where: { id: v1 },
          data: { status: "SUPERSEDED" },
        });
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId,
            action: AuditActions.URL_VERSION_SUPERSEDED,
            entityType: "UrlVersion",
            entityId: v1,
            after: { status: "SUPERSEDED" },
          },
        });
        // Force failure after writes
        throw new Error("forced-failure");
      })
    ).rejects.toThrow("forced-failure");

    const v = await prisma.urlVersion.findUnique({ where: { id: v1 } });
    expect(v?.status).toBe("ACTIVE");
    const audits = await prisma.auditLog.count({
      where: { tenantId, action: AuditActions.URL_VERSION_SUPERSEDED },
    });
    expect(audits).toBe(0);
  });

  it("retryable classification for provider codes", () => {
    expect(isRetryableGoogleAdsCode("RATE_LIMITED")).toBe(true);
    expect(isRetryableGoogleAdsCode("TEMPORARY_ERROR")).toBe(true);
    expect(isRetryableGoogleAdsCode("INVALID_ARGUMENT")).toBe(false);
    expect(isRetryableGoogleAdsCode("UNAUTHORIZED")).toBe(false);
    expect(isRetryableGoogleAdsCode("NOT_FOUND")).toBe(false);
  });

  it("audit logs are tenant scoped", async () => {
    const a = randomUUID();
    const b = randomUUID();
    for (const id of [a, b]) {
      await prisma.tenant.create({
        data: {
          id,
          name: id.slice(0, 8),
          slug: `aud-${id.slice(0, 8)}`,
          status: "ACTIVE",
        },
      });
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: id,
          action: AuditActions.URL_CHANGE_REQUEST_CREATED,
          entityType: "UrlChangeRequest",
          entityId: randomUUID(),
          after: { status: "DRAFT" },
        },
      });
    }
    expect(await prisma.auditLog.count({ where: { tenantId: a } })).toBe(1);
    expect(
      await prisma.auditLog.findFirst({
        where: { tenantId: a, action: AuditActions.URL_CHANGE_REQUEST_CREATED },
      })
    ).toBeTruthy();
    const leak = await prisma.auditLog.findMany({
      where: { tenantId: a },
    });
    expect(leak.every((l) => l.tenantId === a)).toBe(true);
  });
});
