/**
 * Phase 3 — kill-switch engine tests. In-memory fake Prisma (no DB).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  evaluateKillSwitch,
  executeKillSwitch,
} from "./engine.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined, ctx: Ctx): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if (k === "click") {
        const click = ctx.clicks.find((c) => c.id === row.clickId);
        return !!click && matches(click, v, ctx);
      }
      const rv = row[k];
      if ("in" in v) return (v.in as any[]).includes(rv);
      if ("not" in v) return rv !== v.not;
      if ("notIn" in v) return !(v.notIn as any[]).includes(rv);
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

interface Ctx {
  clicks: Row[];
  offers: Row[];
  merchants: Row[];
  configs: Row[];
  profitModels: Row[];
  conversions: Row[];
  riskScores: Row[];
  linkOffers: Row[];
  links: Row[];
  events: Row[];
  alerts: Row[];
  auditLogs: Row[];
  campaigns: Row[];
  syncJobs: Row[];
}

function makeFake(ctx: Ctx) {
  const first = (rows: Row[], args: any) => {
    const out = rows.filter((r) => matches(r, args?.where, ctx));
    if (args?.orderBy) {
      const [key, dir] = Object.entries(args.orderBy)[0] as [string, string];
      out.sort((a, b) =>
        dir === "desc"
          ? (b[key] > a[key] ? 1 : -1)
          : (a[key] > b[key] ? 1 : -1)
      );
    }
    return out[0] ?? null;
  };
  return {
    offer: {
      findUnique: async (args: any) => {
        const offer = ctx.offers.find((o) => o.id === args.where.id) ?? null;
        if (!offer) return null;
        return {
          ...offer,
          merchant:
            ctx.merchants.find((m) => m.id === offer.merchantId) ?? null,
        };
      },
      findFirst: async (args: any) =>
        ctx.offers.find((o) => matches(o, args?.where, ctx)) ?? null,
    },
    killSwitchConfig: {
      findUnique: async (args: any) =>
        ctx.configs.find((c) => c.offerId === args.where.offerId) ?? null,
      findMany: async (args: any) =>
        ctx.configs.filter((c) => matches(c, args?.where, ctx)),
      upsert: async (args: any) => {
        let row = ctx.configs.find((c) => c.offerId === args.where.offerId);
        if (row) Object.assign(row, args.update);
        else {
          row = { ...args.create };
          ctx.configs.push(row);
        }
        return row;
      },
    },
    click: {
      count: async (args: any) =>
        ctx.clicks.filter((c) => matches(c, args?.where, ctx)).length,
      findMany: async (args: any) => {
        let rows = ctx.clicks.filter((c) => matches(c, args?.where, ctx));
        if (args?.orderBy) {
          const [key, dir] = Object.entries(args.orderBy)[0] as [string, string];
          rows = [...rows].sort((a, b) =>
            dir === "desc" ? (b[key] > a[key] ? 1 : -1) : (a[key] > b[key] ? 1 : -1)
          );
        }
        if (typeof args?.take === "number") rows = rows.slice(0, args.take);
        return rows.map((c) => ({
          gclid: c.gclid ?? null,
          ipAddress: c.ipAddress ?? null,
          trackingLinkId: c.trackingLinkId,
          occurredAt: c.occurredAt,
        }));
      },
    },
    profitModel: {
      findFirst: async (args: any) => first(ctx.profitModels, args),
    },
    conversion: {
      count: async (args: any) =>
        ctx.conversions.filter((c) => matches(c, args?.where, ctx)).length,
    },
    offerRiskScore: {
      findFirst: async (args: any) => first(ctx.riskScores, args),
    },
    trackingLinkOffer: {
      findMany: async (args: any) =>
        ctx.linkOffers
          .filter((r) => matches(r, args?.where, ctx))
          .map((r) => ({ trackingLinkId: r.trackingLinkId })),
    },
    trackingLink: {
      findMany: async (args: any) =>
        ctx.links.filter((r) => matches(r, args?.where, ctx)),
      updateMany: async (args: any) => {
        let count = 0;
        for (const link of ctx.links) {
          if (matches(link, args.where, ctx)) {
            Object.assign(link, args.data);
            count += 1;
          }
        }
        return { count };
      },
    },
    killSwitchEvent: {
      create: async (args: any) => {
        const row = { createdAt: new Date(), ...args.data };
        ctx.events.push(row);
        return args.select ? { id: row.id } : row;
      },
      count: async (args: any) =>
        ctx.events.filter((e) => matches(e, args?.where, ctx)).length,
      findMany: async (args: any) =>
        ctx.events.filter((e) => matches(e, args?.where, ctx)),
    },
    alert: {
      findMany: async (args: any) =>
        ctx.alerts.filter((a) => matches(a, args?.where, ctx)),
      create: async (args: any) => {
        const row = { createdAt: new Date(), updatedAt: new Date(), status: "open", ...args.data };
        ctx.alerts.push(row);
        return row;
      },
    },
    auditLog: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.auditLogs.push(row);
        return row;
      },
    },
    campaign: {
      findMany: async (args: any) =>
        ctx.campaigns.filter((r) => matches(r, args?.where, ctx)),
    },
    syncJob: {
      findUnique: async (args: any) =>
        ctx.syncJobs.find(
          (j) =>
            j.tenantId ===
              args.where.tenantId_idempotencyScope_idempotencyKey.tenantId &&
            j.idempotencyScope ===
              args.where.tenantId_idempotencyScope_idempotencyKey
                .idempotencyScope &&
            j.idempotencyKey ===
              args.where.tenantId_idempotencyScope_idempotencyKey.idempotencyKey
        ) ?? null,
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.syncJobs.push(row);
        return row;
      },
    },
  } as unknown as PrismaClient;
}

const TENANT = randomUUID();

function baseCtx(): Ctx {
  return {
    clicks: [],
    offers: [],
    merchants: [],
    configs: [],
    profitModels: [],
    conversions: [],
    riskScores: [],
    linkOffers: [],
    links: [],
    events: [],
    alerts: [],
    auditLogs: [],
    campaigns: [],
    syncJobs: [],
  };
}

function seedOffer(ctx: Ctx, overrides: Partial<Row> = {}) {
  const offerId = randomUUID();
  ctx.offers.push({
    id: offerId,
    tenantId: TENANT,
    name: "Test Offer",
    deletedAt: null,
    merchantId: null,
    ...overrides,
  });
  return offerId;
}

function seedConfig(ctx: Ctx, offerId: string, overrides: Partial<Row> = {}) {
  ctx.configs.push({
    id: randomUUID(),
    tenantId: TENANT,
    offerId,
    enabled: false,
    maxSpend: null,
    minExpectedProfit: null,
    minCvr: null,
    maxPolicyRisk: null,
    pauseOnMerchantTerminated: true,
    ...overrides,
  });
}

function seedProfitModel(ctx: Ctx, offerId: string) {
  ctx.profitModels.push({
    id: randomUUID(),
    tenantId: TENANT,
    offerId,
    commission: 10,
    expectedCvr: 2,
    approvalRate: 0.9,
    attributionRate: 0.95,
    refundRate: 0.05,
    scenarios: { base: { cpc: 0.5, clicks: 1000, profit: 100 } },
    createdAt: new Date(),
    deletedAt: null,
  });
}

describe("evaluateKillSwitch", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = baseCtx();
  });

  it("SPEND_PROFIT fires when spend exceeds maxSpend and expected profit is below floor", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { maxSpend: 100, minExpectedProfit: 50 });
    seedProfitModel(ctx, offerId);
    // 1000 clicks × $0.50 CPC = $500 spend > $100; profit ≈ negative < $50
    for (let i = 0; i < 1000; i++) {
      ctx.clicks.push({ id: randomUUID(), tenantId: TENANT, offerId });
    }
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).toContain("SPEND_PROFIT");
  });

  it("SPEND_PROFIT does not fire when expected profit stays above the floor", async () => {
    const offerId = seedOffer(ctx);
    // Huge profit floor is not breached: expected profit here is strongly positive.
    seedConfig(ctx, offerId, { maxSpend: 10, minExpectedProfit: -100000 });
    seedProfitModel(ctx, offerId);
    for (let i = 0; i < 100; i++) {
      ctx.clicks.push({ id: randomUUID(), tenantId: TENANT, offerId });
    }
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).not.toContain("SPEND_PROFIT");
  });

  it("SPEND_PROFIT is skipped when click or profit-model data is missing", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { maxSpend: 1, minExpectedProfit: 1000 });
    // No clicks and no profit model.
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers).toHaveLength(0);
    expect(result.skipped.some((s) => s.startsWith("SPEND_PROFIT"))).toBe(true);
  });

  it("CVR_FLOOR fires when actual CVR is below minCvr", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { minCvr: 0.05 });
    const clickIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = randomUUID();
      clickIds.push(id);
      ctx.clicks.push({ id, tenantId: TENANT, offerId });
    }
    // 1 conversion / 100 clicks = 1% < 5%
    ctx.conversions.push({
      id: randomUUID(),
      tenantId: TENANT,
      clickId: clickIds[0],
      deletedAt: null,
    });
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).toContain("CVR_FLOOR");
  });

  it("CVR_FLOOR does not fire when CVR is healthy", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { minCvr: 0.01 });
    for (let i = 0; i < 10; i++) {
      const id = randomUUID();
      ctx.clicks.push({ id, tenantId: TENANT, offerId });
      ctx.conversions.push({
        id: randomUUID(),
        tenantId: TENANT,
        clickId: id,
        deletedAt: null,
      });
    }
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers).toHaveLength(0);
  });

  it("POLICY_RISK fires when 100 - policyScore >= maxPolicyRisk", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { maxPolicyRisk: 50 });
    ctx.riskScores.push({
      id: randomUUID(),
      tenantId: TENANT,
      offerId,
      policyScore: 10, // risk = 90 >= 50
      createdAt: new Date(),
      deletedAt: null,
    });
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).toContain("POLICY_RISK");
  });

  it("MERCHANT_TERMINATED fires when the merchant is terminated", async () => {
    const merchantId = randomUUID();
    ctx.merchants.push({ id: merchantId, tenantId: TENANT, status: "TERMINATED" });
    const offerId = seedOffer(ctx, { merchantId });
    seedConfig(ctx, offerId, {});
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).toContain("MERCHANT_TERMINATED");
  });

  it("MERCHANT_TERMINATED is skipped when the config disables it", async () => {
    const merchantId = randomUUID();
    ctx.merchants.push({ id: merchantId, tenantId: TENANT, status: "TERMINATED" });
    const offerId = seedOffer(ctx, { merchantId });
    seedConfig(ctx, offerId, { pauseOnMerchantTerminated: false });
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers).toHaveLength(0);
  });

  it("returns no triggers when the offer has no config", async () => {
    const offerId = seedOffer(ctx);
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.config).toBeNull();
    expect(result.triggers).toHaveLength(0);
  });

  it("throws for a missing offer", async () => {
    await expect(
      evaluateKillSwitch(makeFake(ctx), randomUUID())
    ).rejects.toThrow("offer not found");
  });
});

describe("evaluateKillSwitch — test stop-loss （第七批）", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = baseCtx();
  });

  // profit model base CPC = $0.5 → 200 clicks = $100 spend
  function seedClicks(offerId: string, n: number) {
    for (let i = 0; i < n; i++) {
      ctx.clicks.push({ id: randomUUID(), tenantId: TENANT, offerId });
    }
  }

  it("TEST_STOPLOSS_CAP fires when spend reaches the cap", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { testSpendCap: 80 });
    seedProfitModel(ctx, offerId);
    seedClicks(offerId, 200); // $100 ≥ $80
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).toContain("TEST_STOPLOSS_CAP");
  });

  it("TEST_STOPLOSS_CAP does not fire below the cap", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { testSpendCap: 80 });
    seedProfitModel(ctx, offerId);
    seedClicks(offerId, 100); // $50 < $80
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).not.toContain(
      "TEST_STOPLOSS_CAP"
    );
  });

  it("TEST_STOPLOSS_ZERO_CONV fires on X spend with 0 conversions", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { testZeroConvSpend: 30 });
    seedProfitModel(ctx, offerId);
    seedClicks(offerId, 100); // $50 ≥ $30, no conversions
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).toContain(
      "TEST_STOPLOSS_ZERO_CONV"
    );
  });

  it("TEST_STOPLOSS_ZERO_CONV does not fire when a conversion exists", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { testZeroConvSpend: 30 });
    seedProfitModel(ctx, offerId);
    const clickId = randomUUID();
    ctx.clicks.push({ id: clickId, tenantId: TENANT, offerId });
    for (let i = 1; i < 100; i++) seedClicks(offerId, 1);
    ctx.conversions.push({
      id: randomUUID(),
      tenantId: TENANT,
      clickId,
      deletedAt: null,
    });
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(result.triggers.map((t) => t.type)).not.toContain(
      "TEST_STOPLOSS_ZERO_CONV"
    );
  });

  it("TEST_STOPLOSS is skipped when thresholds are unset or data missing", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, {}); // thresholds unset
    seedClicks(offerId, 500);
    const result = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(
      result.skipped.some((s) => s.startsWith("TEST_STOPLOSS"))
    ).toBe(true);
    expect(result.triggers).toHaveLength(0);
  });
});

describe("evaluateKillSwitch — DUPLICATE_CLICKS (P1-24)", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = baseCtx();
  });

  function seedClicks(offerId: string, n: number, gclid: string | null) {
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      ctx.clicks.push({
        id: randomUUID(),
        tenantId: TENANT,
        offerId,
        trackingLinkId: randomUUID(),
        gclid,
        ipAddress: "1.2.3.4",
        occurredAt: new Date(now - i * 60 * 1000),
        isTest: false,
      });
    }
  }

  it("fires when the duplicate rate exceeds 5% on a sufficient sample", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId);
    // 60 clicks, all same gclid within 30-min windows → high duplicate rate.
    seedClicks(offerId, 60, "gclid-dup");
    const ev = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(ev.triggers.map((t) => t.type)).toContain("DUPLICATE_CLICKS");
  });

  it("does not fire on a small sample (<50 clicks)", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId);
    seedClicks(offerId, 10, "gclid-dup");
    const ev = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(ev.triggers.map((t) => t.type)).not.toContain("DUPLICATE_CLICKS");
    expect(ev.skipped).toContain("DUPLICATE_CLICKS:thin-traffic");
  });

  it("does not fire when clicks are distinct", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId);
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      ctx.clicks.push({
        id: randomUUID(),
        tenantId: TENANT,
        offerId,
        trackingLinkId: randomUUID(),
        gclid: `gclid-${i}`,
        ipAddress: `10.0.0.${i}`,
        occurredAt: new Date(now - i * 60 * 1000),
        isTest: false,
      });
    }
    const ev = await evaluateKillSwitch(makeFake(ctx), offerId);
    expect(ev.triggers.map((t) => t.type)).not.toContain("DUPLICATE_CLICKS");
  });
});

describe("executeKillSwitch", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = baseCtx();
  });

  function seedFiringOffer(enabled: boolean) {
    const offerId = seedOffer(ctx, { name: "Firing Offer" });
    seedConfig(ctx, offerId, { enabled, minCvr: 0.5 });
    const clickId = randomUUID();
    ctx.clicks.push({ id: clickId, tenantId: TENANT, offerId });
    // 0 conversions / 1 click = 0% < 50% → CVR_FLOOR fires
    return offerId;
  }

  function bindLinks(offerId: string, n: number, statuses: string[]) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const linkId = randomUUID();
      ids.push(linkId);
      ctx.links.push({
        id: linkId,
        tenantId: TENANT,
        status: statuses[i] ?? "ACTIVE",
        deletedAt: null,
      });
      ctx.linkOffers.push({
        id: randomUUID(),
        tenantId: TENANT,
        trackingLinkId: linkId,
        offerId,
      });
    }
    return ids;
  }

  it("enabled=false → ALERT_ONLY: alert created, no links paused, event written", async () => {
    const offerId = seedFiringOffer(false);
    bindLinks(offerId, 2, ["ACTIVE", "ACTIVE"]);
    const result = await executeKillSwitch(makeFake(ctx), offerId);

    expect(result.actionTaken).toBe("ALERT_ONLY");
    expect(result.linksPaused).toBe(0);
    expect(ctx.links.every((l) => l.status === "ACTIVE")).toBe(true);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0].triggeredBy).toBe("CVR_FLOOR");
    expect(ctx.events[0].actionTaken).toBe("ALERT_ONLY");
    expect(ctx.events[0].autoExecute).toBe(false);
    expect(ctx.alerts).toHaveLength(1);
    expect(ctx.alerts[0].metric).toBe("kill_switch");
    expect(ctx.alerts[0].severity).toBe("medium");
    expect(result.alertCreated).toBe(true);
    expect(ctx.auditLogs).toHaveLength(1);
    expect(ctx.auditLogs[0].action).toBe("KILL_SWITCH_ALERT");
  });

  it("enabled=true → pauses ALL bound tracking links", async () => {
    const offerId = seedFiringOffer(true);
    bindLinks(offerId, 3, ["ACTIVE", "ACTIVE", "PAUSED"]);
    const result = await executeKillSwitch(makeFake(ctx), offerId);

    expect(result.actionTaken).toBe("PAUSED_ALL_LINKS");
    expect(result.linksPaused).toBe(2); // already-paused link is not recounted
    expect(ctx.links.every((l) => l.status === "PAUSED")).toBe(true);
    expect(ctx.events[0].actionTaken).toBe("PAUSED_ALL_LINKS");
    expect(ctx.events[0].linksPaused).toBe(2);
    expect(ctx.events[0].autoExecute).toBe(true);
    expect(ctx.alerts[0].severity).toBe("high");
    expect(ctx.auditLogs[0].action).toBe("KILL_SWITCH_AUTO_PAUSE");
    expect(ctx.auditLogs[0].reason).toContain("CVR_FLOOR");
  });

  it("alert is deduped within 24h on repeat runs", async () => {
    const offerId = seedFiringOffer(false);
    const prisma = makeFake(ctx);
    await executeKillSwitch(prisma, offerId);
    const second = await executeKillSwitch(prisma, offerId);
    expect(ctx.alerts).toHaveLength(1);
    expect(second.alertCreated).toBe(false);
    // Events are the audit trail and are written every run.
    expect(ctx.events).toHaveLength(2);
  });

  it("does nothing when no condition fires", async () => {
    const offerId = seedOffer(ctx);
    seedConfig(ctx, offerId, { minCvr: 0.0001 });
    const clickId = randomUUID();
    ctx.clicks.push({ id: clickId, tenantId: TENANT, offerId });
    ctx.conversions.push({
      id: randomUUID(),
      tenantId: TENANT,
      clickId,
      deletedAt: null,
    });
    const result = await executeKillSwitch(makeFake(ctx), offerId);
    expect(result.actionTaken).toBe("NONE");
    expect(ctx.events).toHaveLength(0);
    expect(ctx.alerts).toHaveLength(0);
    expect(ctx.auditLogs).toHaveLength(0);
  });

  // P0-10: kill-switch → Google Ads campaign-toggle PAUSE.
  it("pauseGoogleAdsToo=true + enabled → queues campaign-toggle PAUSE + event/audit carry googleAdsPaused", async () => {
    const offerId = seedFiringOffer(true);
    // seedFiringOffer already created a config; opt this offer into P0-10.
    ctx.configs.find((c) => c.offerId === offerId).pauseGoogleAdsToo = true;
    const campaignId = randomUUID();
    const accountId = randomUUID();
    ctx.campaigns.push({
      id: campaignId,
      tenantId: TENANT,
      googleCampaignId: "123456789",
      googleAccountId: accountId,
      status: "ACTIVE",
      deletedAt: null,
    });
    const linkId = randomUUID();
    ctx.links.push({
      id: linkId,
      tenantId: TENANT,
      offerId,
      campaignId,
      status: "ACTIVE",
      deletedAt: null,
    });
    ctx.linkOffers.push({
      id: randomUUID(),
      tenantId: TENANT,
      trackingLinkId: linkId,
      offerId,
    });

    const result = await executeKillSwitch(makeFake(ctx), offerId);

    expect(result.actionTaken).toBe("PAUSED_ALL_LINKS");
    expect(result.googleAdsPaused).toBe(true);
    expect(result.googleAdsTaskIds).toHaveLength(1);
    expect(ctx.syncJobs).toHaveLength(1);
    expect(ctx.syncJobs[0].type).toBe("campaign-toggle");
    expect(ctx.syncJobs[0].status).toBe("PENDING");
    expect(ctx.events[0].googleAdsPaused).toBe(true);
    expect(ctx.events[0].googleAdsTaskId).toBe(result.googleAdsTaskIds[0]);
    const killSwitchAudit = ctx.auditLogs.find(
      (a) => a.action === "KILL_SWITCH_AUTO_PAUSE"
    );
    expect(killSwitchAudit.after.googleAdsPaused).toBe(true);
    expect(killSwitchAudit.after.googleAdsTaskIds).toEqual(
      result.googleAdsTaskIds
    );
  });

  it("pauseGoogleAdsToo=false → no Google Ads task (unchanged behavior)", async () => {
    const offerId = seedFiringOffer(true);
    const campaignId = randomUUID();
    ctx.campaigns.push({
      id: campaignId,
      tenantId: TENANT,
      googleCampaignId: "123456789",
      googleAccountId: randomUUID(),
      status: "ACTIVE",
      deletedAt: null,
    });
    ctx.links.push({
      id: randomUUID(),
      tenantId: TENANT,
      offerId,
      campaignId,
      status: "ACTIVE",
      deletedAt: null,
    });
    const result = await executeKillSwitch(makeFake(ctx), offerId);
    expect(result.actionTaken).toBe("PAUSED_ALL_LINKS");
    expect(result.googleAdsPaused).toBe(false);
    expect(result.googleAdsTaskIds).toHaveLength(0);
    expect(ctx.syncJobs).toHaveLength(0);
    expect(ctx.events[0].googleAdsPaused).toBe(false);
    expect(ctx.events[0].googleAdsTaskId).toBeNull();
  });

  it("ALERT_ONLY (enabled=false) + pauseGoogleAdsToo=true → no Google Ads task", async () => {
    const offerId = seedFiringOffer(false);
    ctx.configs.find((c) => c.offerId === offerId).pauseGoogleAdsToo = true;
    const campaignId = randomUUID();
    ctx.campaigns.push({
      id: campaignId,
      tenantId: TENANT,
      googleCampaignId: "123456789",
      googleAccountId: randomUUID(),
      status: "ACTIVE",
      deletedAt: null,
    });
    ctx.links.push({
      id: randomUUID(),
      tenantId: TENANT,
      offerId,
      campaignId,
      status: "ACTIVE",
      deletedAt: null,
    });
    const result = await executeKillSwitch(makeFake(ctx), offerId);
    expect(result.actionTaken).toBe("ALERT_ONLY");
    expect(result.googleAdsPaused).toBe(false);
    expect(ctx.syncJobs).toHaveLength(0);
  });

  it("skips campaigns already PAUSED in Google Ads", async () => {
    const offerId = seedFiringOffer(true);
    ctx.configs.find((c) => c.offerId === offerId).pauseGoogleAdsToo = true;
    const campaignId = randomUUID();
    ctx.campaigns.push({
      id: campaignId,
      tenantId: TENANT,
      googleCampaignId: "123456789",
      googleAccountId: randomUUID(),
      status: "PAUSED",
      deletedAt: null,
    });
    ctx.links.push({
      id: randomUUID(),
      tenantId: TENANT,
      offerId,
      campaignId,
      status: "ACTIVE",
      deletedAt: null,
    });
    const result = await executeKillSwitch(makeFake(ctx), offerId);
    expect(result.googleAdsPaused).toBe(false);
    expect(ctx.syncJobs).toHaveLength(0);
  });
});
