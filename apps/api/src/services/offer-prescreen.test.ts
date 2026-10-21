/**
 * Offer 一键初筛基础流程（fake prisma + 注入 gate/网关）。
 * 覆盖：黑名单 stop、低佣金 stop、全过 go、佣金未知 unknown、
 * 流量门 false stop、结论写回 Offer 三字段、判停不删。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import type { TrafficGateResult } from "../traffic/types.js";
import { prescreenOffers } from "./offer-prescreen.js";

function offer(over: Record<string, unknown> = {}) {
  return {
    id: "o-x",
    name: "Widget Offer",
    network: "yeahpromos",
    source: "affiliate",
    destinationUrl: "https://example.com/go",
    merchantId: null,
    brandName: "WidgetCo",
    commissionValue: 20,
    commissionType: "FIXED",
    avgPrice: 100,
    ...over,
  };
}

function makeWorld(blacklist: Array<Record<string, unknown>> = []) {
  const offerUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const prisma = {
    catalogBlacklist: { findMany: async () => blacklist },
    catalogScreeningPreset: { findUnique: async () => null },
    aiSetting: { findUnique: async () => null },
    networkProduct: {
      findMany: async () => [
        { id: "np1", brand: "WidgetCo", adCount: 6 },
        { id: "np2", brand: "ZeroBrand", adCount: 0 },
      ],
    },
    offer: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        offerUpdates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
    adminGrantAudit: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return {};
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, offerUpdates, audits };
}

const gatewayOk = async () => ({
  allowed: true,
  feature: "catalog-ad-count" as const,
  keySource: "owner" as const,
  credentials: null,
  grantId: null,
  remainingCalls: null,
});

describe("prescreenOffers", () => {
  it("go / stop(佣金) / unknown(佣金未知) / stop(流量门) 四路分布", async () => {
    const world = makeWorld();
    const gate = async (input: { title: string }): Promise<TrafficGateResult> =>
      ({
        passed: input.title.includes("GateBad") ? false : true,
        reason: input.title.includes("GateBad") ? "流量不足" : "ok",
        officialSite: null,
        signals: [],
      }) as TrafficGateResult;
    const { outcomes, counts } = await prescreenOffers(
      { prisma: world.prisma, gateEvaluator: gate, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-go" }),
          offer({ id: "o-low", commissionValue: 3 }),
          offer({ id: "o-unknown", commissionValue: null, commissionType: null, avgPrice: null }),
          offer({ id: "o-gate", name: "GateBad Offer" }),
        ],
      }
    );
    expect(counts).toMatchObject({ go: 1, unknown: 1, stop: 2 });
    const byId = new Map(outcomes.map((o) => [o.offerId, o]));
    expect(byId.get("o-go")?.verdict).toBe("go");
    expect(byId.get("o-low")?.verdict).toBe("stop");
    expect(byId.get("o-unknown")?.verdict).toBe("unknown");
    expect(byId.get("o-gate")?.verdict).toBe("stop");
    // 结论写回三字段
    expect(world.offerUpdates).toHaveLength(4);
    const low = world.offerUpdates.find((u) => u.id === "o-low");
    expect(low?.data.prescreenVerdict).toBe("stop");
    expect(String(low?.data.prescreenReason)).toContain("8");
    expect(world.audits.some((a) => a.action === "OFFER_PRESCREEN_BATCH")).toBe(true);
  });

  it("黑名单（merchant）→ stop；品牌广告数全 0 → stop", async () => {
    const world = makeWorld([
      { channel: "affiliate", entityType: "merchant", entityId: "m-bad", reason: "拒付" },
    ]);
    const { outcomes } = await prescreenOffers(
      {
        prisma: world.prisma,
        gateEvaluator: async () =>
          ({ passed: true, reason: "ok", officialSite: null, signals: [] }) as TrafficGateResult,
        gatewayResolve: gatewayOk,
      },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-bl", merchantId: "m-bad" }),
          offer({ id: "o-zero", brandName: "ZeroBrand" }),
        ],
      }
    );
    const byId = new Map(outcomes.map((o) => [o.offerId, o]));
    expect(byId.get("o-bl")?.verdict).toBe("stop");
    expect(byId.get("o-bl")?.reason).toContain("黑名单");
    expect(byId.get("o-zero")?.verdict).toBe("stop");
    expect(byId.get("o-zero")?.reason).toContain("广告数为 0");
  });

  it("网关拒绝 → 广告层跳过（skippedPaidLayer），不因广告数判停", async () => {
    const world = makeWorld();
    const { outcomes, skippedPaidLayer } = await prescreenOffers(
      {
        prisma: world.prisma,
        gateEvaluator: async () =>
          ({ passed: true, reason: "ok", officialSite: null, signals: [] }) as TrafficGateResult,
        gatewayResolve: async () => ({
          allowed: false,
          feature: "catalog-ad-count" as const,
          reason: "no_grant" as const,
        }),
      },
      {
        tenantId: "t1",
        actorId: "u2",
        userRole: "member",
        offers: [offer({ id: "o-zero", brandName: "ZeroBrand" })],
      }
    );
    expect(skippedPaidLayer).toBe(true);
    expect(outcomes[0].verdict).toBe("go");
  });
});
