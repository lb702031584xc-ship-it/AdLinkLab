/**
 * Offer 一键推演报告 — orchestrator tests.
 * Deterministic math is tested directly; LLM sections run against a fake
 * chatJson that returns canned shapes per prompt type.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fakes need loose types */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import type { ChatJsonArgs } from "./llm.js";
import {
  computeBlueprintPayout,
  generateBlueprint,
  suggestMatchType,
  type BlueprintDeps,
  type BlueprintInput,
} from "./blueprint.js";

const baseInput: BlueprintInput = {
  offerName: "TestVPN",
  productDescription: "Fast VPN for streaming and privacy.",
  avgPrice: 65.88,
  commissionType: "percentage",
  commissionValue: 40,
  currency: "USD",
  targetMarket: "US",
  landingMode: "landing",
  brandPolicy: "allowed",
  language: "zh",
};

function fakePrisma(): PrismaClient {
  return {
    aiAnalysis: { create: async () => ({ id: "x" }) },
  } as any;
}

/** Fake LLM: returns canned shapes based on which prompt it sees. */
function fakeChat(kind: "ok" | "failKeywords" = "ok") {
  return async (args: ChatJsonArgs): Promise<unknown> => {
    const blob = `${args.system ?? ""}\n${args.user ?? ""}`;
    // failKeywords 只杀真正的关键词分支：广告 prompt 也含 "keyword ideas" 不能误伤
    if (kind === "failKeywords" && blob.includes("keyword ideas") && !blob.includes('"headlines"')) {
      throw new Error("boom");
    }
    // 注意：广告 prompt 里也含 "keyword ideas"（suggestedNegatives），先判 headlines
    if (blob.includes('"headlines"')) {
      return {
        campaignName: "TestVPN",
        dailyBudget: { amount: 20, currency: "USD" },
        geoTargets: ["US"],
        bidding: { strategy: "MANUAL_CPC", maxCpc: null },
        brandTerms: [],
        adGroupName: "通用",
        keywords: [{ text: "vpn for streaming", matchType: "EXACT" }],
        suggestedNegatives: ["free"],
        headlines: Array.from({ length: 15 }, (_, i) => `Test headline ${i + 1}`),
        descriptions: [
          "Test description one for the ad plan.",
          "Test description two for the ad plan.",
          "Test description three for the ad plan.",
          "Test description four for the ad plan.",
        ],
        path1: "guide",
        path2: "vpn",
      };
    }
    if (blob.includes("keyword ideas")) {
      return {
        keywords: [
          { keyword: "vpn for streaming", reason: "高购买意图长尾" },
          { keyword: "best vpn for travel 2026", reason: "长尾对比词" },
        ],
      };
    }
    if (blob.includes("TermsRestriction") || blob.includes("overallVerdict")) {
      return {
        overallVerdict: "caution",
        traffic: {
          search: "allowed",
          display: "allowed",
          email: "forbidden",
          social: "allowed",
          incentivized: "forbidden",
        },
        brandBidding: "forbidden",
        directLinking: "allowed",
        geoRestrictions: [],
        caps: null,
        payoutTerms: "40% annual",
        redFlags: [],
        summary: "测试摘要",
      };
    }
    if (blob.includes("<markdown report>")) {
      return { report: "# 投流决策\n测试报告" };
    }
    throw new Error(`unexpected prompt: ${blob.slice(0, 120)}`);
  };
}

function deps(kind: "ok" | "failKeywords" = "ok"): BlueprintDeps {
  return {
    prisma: fakePrisma(),
    tenantId: "t1",
    userId: "u1",
    baseUrl: "https://x",
    model: "m",
    apiKey: "k",
    chatJsonImpl: fakeChat(kind) as any,
  };
}

describe("computeBlueprintPayout", () => {
  it("percentage: avgPrice × pct", () => {
    expect(computeBlueprintPayout(baseInput)).toBeCloseTo(26.35, 2);
  });
  it("fixed: returns the value", () => {
    expect(
      computeBlueprintPayout({ ...baseInput, commissionType: "fixed", commissionValue: 30 })
    ).toBe(30);
  });
  it("null when price missing for percentage", () => {
    expect(computeBlueprintPayout({ ...baseInput, avgPrice: null })).toBeNull();
  });
});

describe("suggestMatchType", () => {
  it("short core terms → exact", () => {
    expect(suggestMatchType("vpn for streaming")).toBe("exact");
  });
  it("long-tail → phrase", () => {
    expect(suggestMatchType("best vpn for travel 2026")).toBe("phrase");
  });
});

describe("generateBlueprint", () => {
  it("produces all 7 sections with deterministic math", async () => {
    const bp = await generateBlueprint(deps(), baseInput);
    expect(bp.payout).toBeCloseTo(26.35, 2);
    // 盈利测算：保本 CPC = payout × CVR
    const be2 = bp.profit.breakEven.find((b) => b.cvrPct === 2);
    expect(be2?.breakEvenCpc).toBeCloseTo(0.53, 2);
    // 关键词带匹配方式
    expect(bp.keywords.items.length).toBe(2);
    expect(bp.keywords.items[0]?.matchType).toBe("exact");
    // 监控规则
    expect(bp.monitor.stopLossPerKeyword).toBeCloseTo(52.7, 1);
    expect(bp.monitor.scaleCpa).toBeCloseTo(18.45, 2);
    // 条款未提供 → skipped，verdict 不高于 caution
    expect(bp.terms.skipped).toBe(true);
    expect(["caution", "stop"]).toContain(bp.verdict.level);
    // 广告计划生成
    expect(bp.adPlan.plan).not.toBeNull();
    expect(bp.traffic.report).toContain("投流决策");
  });

  it("parses terms when text provided and honors stop verdict", async () => {
    const chat = fakeChat();
    const stopChat = async (args: ChatJsonArgs): Promise<unknown> => {
      const blob = `${args.system ?? ""}\n${args.user ?? ""}`;
      if (blob.includes("overallVerdict")) {
        const base = (await chat(args)) as any;
        return { ...base, overallVerdict: "stop" };
      }
      return chat(args);
    };
    const bp = await generateBlueprint(
      { ...deps(), chatJsonImpl: stopChat as any },
      { ...baseInput, termsText: "x".repeat(60) }
    );
    expect(bp.terms.skipped).toBe(false);
    expect(bp.terms.result?.overallVerdict).toBe("stop");
    expect(bp.verdict.level).toBe("stop");
  });

  it("fail-soft: one failed LLM section does not nuke the report", async () => {
    const bp = await generateBlueprint(deps("failKeywords"), baseInput);
    expect(bp.keywords.error).toBe("boom");
    expect(bp.keywords.items).toEqual([]);
    expect(bp.adPlan.plan).not.toBeNull();
    expect(bp.verdict.reasons.join("")).toContain("1");
  });
});

describe("extractOfferMeta", () => {
  it("extracts title, description and price", async () => {
    const { extractOfferMeta } = await import("./blueprint.js");
    const html = `<html><head><title>NordVPN – Best VPN 2026 | NordVPN</title>
      <meta name="description" content="Fast and secure VPN for streaming.">
      </head><body></body></html>`;
    const meta = extractOfferMeta(html, "Get NordVPN for $65.88 for the first year.");
    expect(meta.title).toBe("NordVPN – Best VPN 2026");
    expect(meta.description).toBe("Fast and secure VPN for streaming.");
    expect(meta.price).toBe(65.88);
    expect(meta.currency).toBe("USD");
  });

  it("returns nulls when nothing found, never invents", async () => {
    const { extractOfferMeta } = await import("./blueprint.js");
    const meta = extractOfferMeta("<html><head></head><body>hello</body></html>", "hello world");
    expect(meta.title).toBeNull();
    expect(meta.price).toBeNull();
    expect(meta.currency).toBeNull();
  });

  it("falls back to og: tags", async () => {
    const { extractOfferMeta } = await import("./blueprint.js");
    const html = `<html><head>
      <meta property="og:title" content="Cool Gadget">
      <meta property="og:description" content="Does cool things.">
      </head><body></body></html>`;
    const meta = extractOfferMeta(html, "Only €49.99 today");
    expect(meta.title).toBe("Cool Gadget");
    expect(meta.description).toBe("Does cool things.");
    expect(meta.price).toBe(49.99);
    expect(meta.currency).toBe("EUR");
  });
});
