/**
 * Phase 8.1 — PostgreSQL durability via API createServices(persistence=prisma).
 * Opt-in: PHASE81_PG=1 or PHASE61_PG=1 / PHASE71_PG=1
 * TEST-ONLY — does not change business semantics.
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
} from "../../../../packages/database/scripts/phase61-pg-harness.mts";
import { createServices } from "../app.js";

const DB_ROOT = join(
  fileURLToPath(new URL("../../../../packages/database", import.meta.url))
);
const RUN_PG =
  process.env.PHASE81_PG === "1" ||
  process.env.PHASE61_PG === "1" ||
  process.env.PHASE71_PG === "1";

async function seedMinimalClick(prisma: PrismaClient, label: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const offerId = randomUUID();
  const landingId = randomUUID();
  const trackingId = randomUUID();
  const clickId = randomUUID();
  const accountId = randomUUID();
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: label,
      slug: `${label}-${tenantId.slice(0, 8)}`,
      status: "ACTIVE",
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: `${label}-${userId.slice(0, 8)}@example.com`,
      name: label,
      status: "ACTIVE",
    },
  });
  await prisma.googleAccount.create({
    data: {
      id: accountId,
      tenantId,
      userId,
      name: `${label}-ga`,
      customerId: `mock-cust-${label}-${accountId.slice(0, 8)}`,
      currency: "USD",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });
  await prisma.offer.create({
    data: {
      id: offerId,
      tenantId,
      name: `${label}-offer`,
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
      publicId: `trk-${label}-${trackingId.slice(0, 8)}`,
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
      gclid: `GCLID_${label}`,
      occurredAt: new Date(),
    },
  });
  return { tenantId, clickId };
}

describe.skipIf(!RUN_PG)("Phase 8.1 PostgreSQL API persistence", () => {
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
        WHERE schemaname = 'public' AND tablename = 'orders'
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
          cwd: DB_ROOT,
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
          cwd: DB_ROOT,
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
    await prisma?.$disconnect().catch(() => undefined);
    if (startedByUs) {
      await stopPhase61Postgres();
    }
  });

  it("createServices(prisma) Order survives new PrismaClient (durability)", async () => {
    const g = await seedMinimalClick(prisma, `p81_${Date.now()}`);
    const services = createServices({
      persistence: "prisma",
      prisma,
    });
    expect(services.persistence).toBe("prisma");

    const orderId = `ORD-P81-${Date.now()}`;
    const { order, created } = await services.orders.createOrder({
      tenantId: g.tenantId,
      orderId,
      clickId: g.clickId,
      value: "42.5000",
      currency: "USD",
      idempotencyKey: `p81:order:${orderId}`,
    });
    expect(created).toBe(true);

    const prisma2 = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });
    const services2 = createServices({
      persistence: "prisma",
      prisma: prisma2,
    });
    const reloaded = await services2.orders.getOrder(g.tenantId, order.id);
    expect(reloaded.orderId).toBe(orderId);
    expect(Number(reloaded.value)).toBe(42.5);
    expect(reloaded.clickId).toBe(g.clickId);

    await services2.dispose();
  }, 60_000);
});
