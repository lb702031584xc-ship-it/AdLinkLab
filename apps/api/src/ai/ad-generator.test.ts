/**
 * 功能2 — 自动化广告：AI 生成器单元测试。
 * Prompt 构建、strict JSON 校验、finalize（否词/预算钳制/质量标注）、
 * 文案包文本、内存计划存储。
 */
import { describe, expect, it } from "vitest";
import {
  AI_GENERATED_QUALITY,
  MAX_DAILY_BUDGET,
  MIN_DAILY_BUDGET,
  buildAdPlanPrompt,
  buildCopyPack,
  createPlanStore,
  finalizeAdPlan,
  normalizeCopyStyle,
  validateAdPlanUrlDraft,
  type AdPlan,
  type AdPlanUrlDraft,
  type FinalizeContext,
} from "./ad-generator.js";
import { AiError } from "./llm.js";

function headlines(n: number, len = 10): string[] {
  return Array.from({ length: n }, (_, i) => `Headline ${i + 1}`.slice(0, len).padEnd(len, "x"));
}

function descriptions(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Description number ${i + 1} with some ad copy text.`);
}

function validDraft(overrides: Partial<AdPlanUrlDraft> = {}): AdPlanUrlDraft {
  return {
    campaignName: "Test Campaign",
    dailyBudget: { amount: 30, currency: "USD" },
    geoTargets: ["US"],
    bidding: { strategy: "MANUAL_CPC", maxCpc: 1.5 },
    brandTerms: ["acme"],
    adGroupName: "Test Ad Group",
    keywords: [
      { text: "buy running shoes", matchType: "EXACT" },
      { text: "best running shoes 2026", matchType: "PHRASE" },
      { text: "acme running shoes sale", matchType: "BROAD" },
    ],
    suggestedNegatives: ["free", "jobs"],
    headlines: headlines(15),
    descriptions: descriptions(4),
    path1: "shoes",
    path2: null,
    ...overrides,
  };
}

function finalizeCtx(overrides: Partial<FinalizeContext> = {}): FinalizeContext {
  return {
    planId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    language: "en",
    offerId: null,
    googleAccountId: null,
    copyStyle: "affiliate",
    finalUrls: ["https://merchant.example/offer?a=1"],
    ...overrides,
  };
}

describe("buildAdPlanPrompt", () => {
  it("asks for strict JSON with 15 headlines / 4 descriptions", () => {
    const { system, user } = buildAdPlanPrompt({
      url: "https://merchant.example/offer",
      pageText: "Great running shoes, $99.",
      language: "en",
      copyStyle: "affiliate",
    });
    expect(system).toContain("STRICT JSON");
    expect(system).toContain("exactly 15 headlines");
    expect(system).toContain("exactly 4 descriptions");
    expect(user).toContain("https://merchant.example/offer");
    expect(user).toContain("Great running shoes");
  });

  it("writes copy in the requested language", () => {
    const zh = buildAdPlanPrompt({ url: "https://x.example", pageText: "t", language: "zh", copyStyle: "affiliate" });
    expect(zh.system).toContain("Simplified Chinese");
    const en = buildAdPlanPrompt({ url: "https://x.example", pageText: "t", language: "en", copyStyle: "affiliate" });
    expect(en.system).toContain("English");
  });

  it("official style uses Official Site structure, affiliate style forbids it", () => {
    const official = buildAdPlanPrompt({ url: "https://x.example", pageText: "t", language: "en", copyStyle: "official" });
    expect(official.system).toContain("Official Site");
    const affiliate = buildAdPlanPrompt({ url: "https://x.example", pageText: "t", language: "en", copyStyle: "affiliate" });
    expect(affiliate.system).toContain("NEVER claim to be the official site");
  });

  it("normalizeCopyStyle falls back to affiliate", () => {
    expect(normalizeCopyStyle("official")).toBe("official");
    expect(normalizeCopyStyle("affiliate")).toBe("affiliate");
    expect(normalizeCopyStyle("bogus")).toBe("affiliate");
    expect(normalizeCopyStyle(undefined)).toBe("affiliate");
  });
});

describe("validateAdPlanUrlDraft", () => {
  it("accepts a valid draft", () => {
    const draft = validateAdPlanUrlDraft(validDraft());
    expect(draft.headlines).toHaveLength(15);
    expect(draft.descriptions).toHaveLength(4);
    expect(draft.bidding.strategy).toBe("MANUAL_CPC");
  });

  it("rejects wrong headline count", () => {
    expect(() =>
      validateAdPlanUrlDraft(validDraft({ headlines: headlines(14) }))
    ).toThrow(AiError);
  });

  it("rejects wrong description count", () => {
    expect(() =>
      validateAdPlanUrlDraft(validDraft({ descriptions: descriptions(3) }))
    ).toThrow(AiError);
  });

  it("truncates over-long headlines at a word boundary instead of rejecting", () => {
    const bad = headlines(15);
    bad[0] = "Max and Lily Twin Over Twin Bunk Bed"; // 35 chars
    const draft = validateAdPlanUrlDraft(validDraft({ headlines: bad }));
    expect(draft.headlines[0].length).toBeLessThanOrEqual(30);
    expect(draft.headlines[0]).toBe("Max and Lily Twin Over Twin");
    // 无空格长词硬截
    const hard = headlines(15);
    hard[0] = "x".repeat(31);
    const draft2 = validateAdPlanUrlDraft(validDraft({ headlines: hard }));
    expect(draft2.headlines[0]).toBe("x".repeat(30));
  });

  it("truncates over-long descriptions instead of rejecting", () => {
    const long = `Solid pine bunk bed with a timeless design that fits any kids room and lasts for years.`;
    const draft = validateAdPlanUrlDraft(
      validDraft({ descriptions: [long, "d2", "d3", "d4"] })
    );
    expect(draft.descriptions[0].length).toBeLessThanOrEqual(90);
  });

  it("rejects unknown match type", () => {
    expect(() =>
      validateAdPlanUrlDraft(
        validDraft({
          keywords: [{ text: "kw", matchType: "WILD" as never }],
        })
      )
    ).toThrow(AiError);
  });

  it("rejects invalid geo codes", () => {
    expect(() =>
      validateAdPlanUrlDraft(validDraft({ geoTargets: ["USA"] }))
    ).toThrow(AiError);
  });

  it("normalizes enum casing leniently", () => {
    const draft = validateAdPlanUrlDraft(
      validDraft({
        keywords: [{ text: "kw", matchType: "exact" as never }],
        bidding: { strategy: "manual_cpc" as never, maxCpc: 2 },
      })
    );
    expect(draft.keywords[0]!.matchType).toBe("EXACT");
    expect(draft.bidding.strategy).toBe("MANUAL_CPC");
  });
});

describe("finalizeAdPlan", () => {
  it("builds brand-check negatives deterministically (复用 brand-check)", () => {
    const plan = finalizeAdPlan([validDraft()], finalizeCtx());
    const group = plan.adGroups[0]!.group;
    // "acme running shoes sale" contains brand term "acme" → removed from
    // positives and turned into exact + phrase negatives.
    expect(group.keywords.map((k) => k.text)).not.toContain(
      "acme running shoes sale"
    );
    const negatives = group.negativeKeywords;
    const texts = negatives.map((n) => `${n.matchType}:${n.text}`);
    expect(texts).toContain("EXACT:acme running shoes sale");
    expect(texts).toContain("PHRASE:acme running shoes sale");
    // Suggested negatives are added as PHRASE.
    expect(texts).toContain("PHRASE:free");
    expect(texts).toContain("PHRASE:jobs");
    // Never negates a remaining positive keyword.
    for (const n of negatives) {
      expect(group.keywords.some((k) => k.text === n.text)).toBe(false);
    }
  });

  it("official 口吻保留品牌关键词，不转否词", () => {
    const plan = finalizeAdPlan(
      [validDraft()],
      finalizeCtx({ copyStyle: "official" })
    );
    const group = plan.adGroups[0]!.group;
    expect(group.keywords.map((k) => k.text)).toContain("acme running shoes sale");
    const texts = group.negativeKeywords.map((n) => `${n.matchType}:${n.text}`);
    expect(texts).not.toContain("EXACT:acme running shoes sale");
    expect(texts).not.toContain("PHRASE:acme running shoes sale");
    // AI 建议的非品牌否词仍保留
    expect(texts).toContain("PHRASE:free");
  });

  it("clamps absurd budgets into the safe range", () => {
    const low = finalizeAdPlan(
      [validDraft({ dailyBudget: { amount: 0.5, currency: "USD" } })],
      finalizeCtx()
    );
    expect(low.campaign.dailyBudget.amount).toBe(MIN_DAILY_BUDGET);
    const high = finalizeAdPlan(
      [validDraft({ dailyBudget: { amount: 100000, currency: "USD" } })],
      finalizeCtx()
    );
    expect(high.campaign.dailyBudget.amount).toBe(MAX_DAILY_BUDGET);
  });

  it("marks every AI-generated number/copy as PREDICTED and creates PAUSED", () => {
    const plan = finalizeAdPlan([validDraft()], finalizeCtx());
    expect(plan.dataQuality).toBe("PREDICTED");
    expect(plan.campaign.dataQuality).toBe("PREDICTED");
    expect(plan.campaign.dailyBudget.dataQuality).toBe("PREDICTED");
    expect(plan.campaign.status).toBe("PAUSED");
    const g = plan.adGroups[0]!.group;
    expect(g.dataQuality).toBe("PREDICTED");
    expect(g.keywords[0]!.dataQuality).toBe("PREDICTED");
    expect(g.negativeKeywords[0]!.dataQuality).toBe("PREDICTED");
    expect(plan.adGroups[0]!.rsa.dataQuality).toBe("PREDICTED");
  });

  it("creates one ad group per URL sharing the campaign", () => {
    const plan = finalizeAdPlan(
      [validDraft({ adGroupName: "Group A" }), validDraft({ adGroupName: "Group B" })],
      finalizeCtx({
        finalUrls: ["https://m.example/a", "https://m.example/b"],
      })
    );
    expect(plan.adGroups).toHaveLength(2);
    expect(plan.adGroups[0]!.group.name).toBe("Group A");
    expect(plan.adGroups[1]!.group.name).toBe("Group B");
    expect(plan.adGroups[0]!.rsa.finalUrl).toBe("https://m.example/a");
    expect(plan.adGroups[1]!.rsa.finalUrl).toBe("https://m.example/b");
    expect(plan.campaign.name).toBe("Test Campaign");
  });

  it("keeps MAXIMIZE_CLICKS bidding without maxCpc", () => {
    const plan = finalizeAdPlan(
      [validDraft({ bidding: { strategy: "MAXIMIZE_CLICKS", maxCpc: null } })],
      finalizeCtx()
    );
    expect(plan.campaign.bidding.strategy).toBe("MAXIMIZE_CLICKS");
    expect(plan.campaign.bidding.maxCpc).toBeNull();
  });
});

describe("buildCopyPack", () => {
  function samplePlan(): AdPlan {
    return finalizeAdPlan([validDraft()], finalizeCtx());
  }

  it("is explicitly marked for Amazon/manual placement", () => {
    const text = buildCopyPack(samplePlan());
    expect(text).toContain("Amazon/手动投放用，需手动创建");
  });

  it("contains keywords with match-type syntax, negatives, 15 headlines, 4 descriptions", () => {
    const text = buildCopyPack(samplePlan());
    expect(text).toContain("[buy running shoes]");
    expect(text).toContain('"best running shoes 2026"');
    expect(text).toContain("否词");
    expect(text).toContain("[RSA 标题 × 15]");
    expect(text).toContain("[RSA 描述 × 4]");
    expect(text).toContain("预算: 30 USD/天");
    expect(text).toContain("PREDICTED");
  });
});

describe("createPlanStore", () => {
  it("returns stored plans and drops expired ones", async () => {
    const store = createPlanStore(30, 10);
    const plan = finalizeAdPlan([validDraft()], finalizeCtx());
    store.put(plan);
    expect(store.get(plan.planId)?.plan.planId).toBe(plan.planId);
    expect(store.get("nope")).toBeNull();
    await new Promise((r) => setTimeout(r, 40));
    expect(store.get(plan.planId)).toBeNull();
  });

  it("evicts the oldest entry when full", () => {
    const store = createPlanStore(60_000, 2);
    const mk = (id: string) =>
      finalizeAdPlan([validDraft()], finalizeCtx({ planId: id }));
    store.put(mk("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    store.put(mk("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    store.put(mk("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
    expect(store.size()).toBe(2);
    expect(store.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();
    expect(store.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).not.toBeNull();
  });
});

describe("AI_GENERATED_QUALITY", () => {
  it("is PREDICTED", () => {
    expect(AI_GENERATED_QUALITY).toBe("PREDICTED");
  });
});
