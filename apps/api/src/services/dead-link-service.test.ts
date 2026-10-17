/**
 * Automation pack ① — dead link monitor service tests.
 * In-memory fake Prisma; health check is injected (no network).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import type { LinkHealthResult } from "../ai/link-health-check.js";
import {
  checkAllActiveLinks,
  DEAD_LINK_ALERT_METRIC,
  getHealthHistory,
} from "./dead-link-service.js";

type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const rv = row[k];
    if (
      v !== null &&
      typeof v === "object" &&
      !(v instanceof Date) &&
      !Array.isArray(v)
    ) {
      return Object.entries(v).every(([op, ov]) => {
        if (op === "in") return (ov as any[]).includes(rv);
        const a = rv instanceof Date ? rv.getTime() : rv;
        const b = (ov as any) instanceof Date ? (ov as any).getTime() : ov;
        switch (op) {
          case "gt":
            return a > b;
          case "gte":
            return a >= b;
          case "lt":
            return a < b;
          case "lte":
            return a <= b;
          default:
            return true;
        }
      });
    }
    if (v === null) return rv === null || rv === undefined;
    return rv === v;
  });
}

function sortBy(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0] as [string, string];
  const out = [...rows];
  out.sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    return dir === "desc" ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function mkStore(rows: Row[]) {
  return {
    findMany: async ({ where, orderBy, skip, take }: any = {}) =>
      sortBy(
        rows.filter((r) => matchesWhere(r, where)),
        orderBy
      )
        .slice(skip ?? 0, take == null ? undefined : (skip ?? 0) + take)
        .map((r) => ({ ...r })),
    findFirst: async ({ where }: any = {}) =>
      rows.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r }))[0] ??
      null,
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        checkedAt: new Date(),
        // Production Prisma always returns the `healthChecks` relation select
        // (possibly empty); the service reads link.healthChecks[0].
        healthChecks: [],
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    count: async ({ where }: any = {}) =>
      rows.filter((r) => matchesWhere(r, where)).length,
  };
}

function makeFakePrisma() {
  const stores = {
    trackingLink: mkStore([]),
    linkHealthCheck: mkStore([]),
    alert: mkStore([]),
  };
  return { prisma: stores as unknown as PrismaClient };
}

const ALIVE: LinkHealthResult = {
  statusCode: 200,
  finalUrl: "https://merchant.example/deal",
  isAlive: true,
  responseTimeMs: 120,
};

const DEAD: LinkHealthResult = {
  statusCode: 404,
  finalUrl: "https://merchant.example/gone",
  isAlive: false,
  failureReason: "http_404",
  responseTimeMs: 90,
};

function seedLink(
  prisma: PrismaClient,
  overrides: Partial<Row> = {}
): Promise<Row> {
  return (prisma as any).trackingLink.create({
    data: {
      id: randomUUID(),
      tenantId: "tenant-a",
      publicId: "tl-1",
      status: "ACTIVE",
      offer: { name: "Offer A", destinationUrl: "https://merchant.example/deal" },
      landingPage: null,
      ...overrides,
    },
  });
}

describe("checkAllActiveLinks", () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = makeFakePrisma().prisma;
  });

  it("alive link → health row written, link stays ACTIVE, no alert", async () => {
    await seedLink(prisma);
    const summary = await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async () => ALIVE,
    });
    expect(summary).toMatchObject({
      checked: 1,
      alive: 1,
      dead: 0,
      paused: 0,
      alertsCreated: 0,
    });
    const checks = await (prisma as any).linkHealthCheck.findMany({});
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      tenantId: "tenant-a",
      isAlive: true,
      statusCode: 200,
    });
    const link = await (prisma as any).trackingLink.findFirst({});
    expect(link.status).toBe("ACTIVE");
    expect(await (prisma as any).alert.count({})).toBe(0);
  });

  it("dead link → paused + HIGH alert created", async () => {
    const link = await seedLink(prisma);
    const summary = await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async () => DEAD,
    });
    expect(summary).toMatchObject({
      checked: 1,
      alive: 0,
      dead: 1,
      paused: 1,
      alertsCreated: 1,
    });
    const updated = await (prisma as any).trackingLink.findFirst({
      where: { id: link.id },
    });
    expect(updated.status).toBe("PAUSED");
    const alerts = await (prisma as any).alert.findMany({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      tenantId: "tenant-a",
      metric: DEAD_LINK_ALERT_METRIC,
      trackingLinkId: link.id,
      severity: "high",
      status: "open",
    });
    expect(alerts[0].message).toContain("死链");
  });

  it("alert deduped within 24h (second scan does not re-alert)", async () => {
    const link = await seedLink(prisma);
    await (prisma as any).alert.create({
      data: {
        id: randomUUID(),
        tenantId: "tenant-a",
        metric: DEAD_LINK_ALERT_METRIC,
        trackingLinkId: link.id,
        severity: "high",
        message: "old",
        status: "open",
        createdAt: new Date(),
      },
    });

    const summary = await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async () => DEAD,
    });
    expect(summary.dead).toBe(1);
    expect(summary.alertsCreated).toBe(0);
    expect(await (prisma as any).alert.count({})).toBe(1);
  });

  it("only scans the given tenant (tenant isolation)", async () => {
    await seedLink(prisma, { tenantId: "tenant-a" });
    await seedLink(prisma, {
      tenantId: "tenant-b",
      publicId: "tl-2",
    });
    const summary = await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async () => ALIVE,
    });
    expect(summary.checked).toBe(1);
    const checks = await (prisma as any).linkHealthCheck.findMany({});
    expect(checks.every((c: Row) => c.tenantId === "tenant-a")).toBe(true);
  });

  it("skips links without a resolvable URL", async () => {
    await seedLink(prisma, {
      offer: { name: "Offer A", destinationUrl: "" },
    });
    const summary = await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async () => ALIVE,
    });
    expect(summary).toMatchObject({ checked: 0, skippedNoUrl: 1 });
  });

  it("prefers landingPage.url over offer.destinationUrl", async () => {
    await seedLink(prisma, {
      offer: { name: "Offer A", destinationUrl: "https://offer.example/x" },
      landingPage: { name: "LP", url: "https://lp.example/y" },
    });
    let seenUrl = "";
    await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async (url: string) => {
        seenUrl = url;
        return ALIVE;
      },
    });
    expect(seenUrl).toBe("https://lp.example/y");
  });

  it("non-ACTIVE links are not scanned", async () => {
    await seedLink(prisma, { status: "PAUSED" });
    const summary = await checkAllActiveLinks(prisma, "tenant-a", {
      checkImpl: async () => ALIVE,
    });
    expect(summary.checked).toBe(0);
  });
});

describe("getHealthHistory", () => {
  it("paginates newest-first, tenant-isolated, with link names", async () => {
    const fake = makeFakePrisma();
    const prisma = fake.prisma;
    const link = await seedLink(prisma);
    await seedLink(prisma, {
      tenantId: "tenant-b",
      publicId: "tl-other",
    });
    for (let i = 0; i < 5; i++) {
      await (prisma as any).linkHealthCheck.create({
        data: {
          id: randomUUID(),
          tenantId: "tenant-a",
          trackingLinkId: link.id,
          statusCode: 200,
          finalUrl: "https://merchant.example/deal",
          isAlive: true,
          responseTimeMs: 100 + i,
          checkedAt: new Date(Date.now() + i * 1000),
        },
      });
    }
    await (prisma as any).linkHealthCheck.create({
      data: {
        id: randomUUID(),
        tenantId: "tenant-b",
        trackingLinkId: "other",
        isAlive: false,
        finalUrl: "https://x.example",
        checkedAt: new Date(),
      },
    });

    const page1 = await getHealthHistory(prisma, "tenant-a", {
      page: 1,
      pageSize: 2,
    });
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0].linkName).toBe("Offer A");
    expect(page1.rows[0].linkPublicId).toBe("tl-1");
    expect(page1.rows[0].isAlive).toBe(true);
    // newest first
    expect(
      new Date(page1.rows[0].checkedAt).getTime()
    ).toBeGreaterThanOrEqual(
      new Date(page1.rows[1].checkedAt).getTime()
    );

    const page3 = await getHealthHistory(prisma, "tenant-a", {
      page: 3,
      pageSize: 2,
    });
    expect(page3.rows).toHaveLength(1);

    const filtered = await getHealthHistory(prisma, "tenant-a", {
      trackingLinkId: link.id,
      pageSize: 50,
    });
    expect(filtered.total).toBe(5);
  });
});
