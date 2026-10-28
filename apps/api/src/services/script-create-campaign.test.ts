/**
 * 功能2 — 自动化广告：create-campaign Script 模板测试。
 * 重点验证安全铁律：只创建计划结构、不修改已有实体、预算取自计划。
 */
import { describe, expect, it } from "vitest";
import {
  buildCreateCampaignScript,
  validateCreateCampaignPlan,
} from "./script-create-campaign.js";
import { assertScriptSourceSafe } from "./script-generator-source.js";
import {
  finalizeAdPlan,
  type AdPlan,
  type AdPlanUrlDraft,
} from "../ai/ad-generator.js";

function draftHeadlines(): string[] {
  return Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`);
}

function draftDescriptions(): string[] {
  return Array.from({ length: 4 }, (_, i) => `Description ${i + 1} copy text here.`);
}

function samplePlan(
  finalUrls: string[] = ["https://merchant.example/offer"]
): AdPlan {
  const draft: AdPlanUrlDraft = {
    campaignName: "Auto Test Campaign",
    dailyBudget: { amount: 42.5, currency: "USD" },
    geoTargets: ["US"],
    bidding: { strategy: "MANUAL_CPC", maxCpc: 1.25 },
    brandTerms: ["acme"],
    adGroupName: "Auto Test Group",
    keywords: [{ text: "buy widgets", matchType: "EXACT" }],
    suggestedNegatives: ["free"],
    headlines: draftHeadlines(),
    descriptions: draftDescriptions(),
    path1: null,
    path2: null,
  };
  return finalizeAdPlan([draft], {
    planId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    language: "en",
    offerId: null,
    googleAccountId: null,
    finalUrls,
  });
}

/** 从生成的脚本源码里把嵌入的计划 JSON 解析出来（双重转义，需 parse 两次）。 */
function embeddedPlan(src: string): AdPlan {
  const m = src.match(/plan: JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
  if (!m) throw new Error("embedded plan not found in script source");
  return JSON.parse(JSON.parse(m[1]!)) as AdPlan;
}

describe("validateCreateCampaignPlan", () => {
  it("accepts a finalized plan", () => {
    expect(validateCreateCampaignPlan(samplePlan())).toEqual([]);
  });

  it("rejects non-positive budgets (no absurd defaults allowed)", () => {
    const plan = samplePlan();
    plan.campaign.dailyBudget.amount = 0;
    const problems = validateCreateCampaignPlan(plan);
    expect(problems.some((p) => p.includes("dailyBudget"))).toBe(true);
  });

  it("rejects plans without ad groups or RSA copy", () => {
    const plan = samplePlan();
    plan.adGroups = [];
    expect(validateCreateCampaignPlan(plan).length).toBeGreaterThan(0);
    const plan2 = samplePlan();
    plan2.adGroups[0]!.rsa.headlines = ["only", "two"];
    expect(
      validateCreateCampaignPlan(plan2).some((p) => p.includes("headlines"))
    ).toBe(true);
  });

  it("rejects RSA display paths over 15 chars (Google limit)", () => {
    // 2026-10-28 Qrevo Edge 3 Pro：path2 超长直到 Google 拒登才暴露。
    const plan = samplePlan();
    plan.adGroups[0]!.rsa.path2 = "qrevo-edge-3-pro"; // 16 chars
    expect(
      validateCreateCampaignPlan(plan).some((p) => p.includes("path2"))
    ).toBe(true);
    expect(() => buildCreateCampaignScript(plan)).toThrow(/path2/);
  });

  it("template aborts before creating anything when a path is over 15 chars", () => {
    const src = buildCreateCampaignScript(samplePlan());
    expect(src).toContain("exceeds 15 chars");
  });
});

describe("buildCreateCampaignScript", () => {
  it("embeds the plan and uses its budget verbatim", () => {
    const src = buildCreateCampaignScript(samplePlan());
    expect(src).toContain("Auto Test Campaign");
    expect(src).toContain("Auto Test Group");
    // Budget flows from the plan into the campaign-budget mutate; the
    // script aborts when it is not positive. No hardcoded budget anywhere.
    expect(src).toContain("campaignBudgetOperation");
    expect(src).toContain("dailyBudget.amount");
    expect(src).toContain("must be a positive number");
    expect(src).not.toContain("withBudget(50)");
    expect(src).not.toContain("withBudget(100)");
    expect(src).not.toContain("amountMicros: \"50000000\"");
  });

  it("creates everything PAUSED and never touches existing entities", () => {
    const src = buildCreateCampaignScript(samplePlan());
    expect(src).toContain('status: "PAUSED"');
    // Existence check by exact name → skip whole run (idempotent).
    expect(src).toContain("campaignExists_");
    expect(src).toContain("already exists");
    // Safety iron rules: no destructive / mutating calls on existing entities.
    expect(src).not.toMatch(/\.remove\s*\(/);
    expect(src).not.toMatch(/\.pause\s*\(/);
    expect(src).not.toContain('setStatus("ENABLED")');
    expect(src).not.toContain("setStatus('ENABLED')");
    expect(src).not.toContain("enable()");
  });

  it("creates via AdsApp.mutate — no newCampaignBuilder (does not exist)", () => {
    const src = buildCreateCampaignScript(samplePlan());
    expect(src).toContain("AdsApp.mutate");
    expect(src).not.toContain("newCampaignBuilder");
    expect(src).not.toContain("newKeywordBuilder");
    expect(src).not.toContain("newNegativeKeywordBuilder");
    expect(src).not.toContain("responsiveSearchAdBuilder");
    // Budget first, then campaign, then ad group / criteria / RSA.
    expect(src).toContain("campaignBudgetOperation");
    expect(src).toContain("campaignOperation");
    // containsEuPoliticalAdvertising is REQUIRED by the Google Ads API on
    // campaign create — and it is an ENUM, not a boolean (false is
    // rejected with "Invalid enum value").
    expect(src).toContain(
      'containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"'
    );
    expect(src).toContain("adGroupOperation");
    expect(src).toContain("adGroupCriterionOperation");
    expect(src).toContain("adGroupAdOperation");
    expect(src).toContain("responsiveSearchAd");
  });

  it("reuses an orphaned same-name budget instead of failing on re-run", () => {
    const src = buildCreateCampaignScript(samplePlan());
    // Earlier runs really created the budget, so a re-run must not fail
    // with "A campaign budget with this name already exists".
    expect(src).toContain("AdsApp.budgets()");
    expect(src).toContain("campaign_budget.name");
    expect(src).toContain("Reusing orphaned budget");
    expect(src).toContain("setAmount");
    // A budget another campaign uses is never touched — fallback name.
    expect(src).toContain("is in use by another campaign");
  });

  it("surfaces real Google errors via getErrorMessages (no silent failures)", () => {
    const src = buildCreateCampaignScript(samplePlan());
    // mutate() returns a failed MutateResult instead of throwing — the
    // script must read getErrorMessages() or the log hides the real cause.
    expect(src).toContain("isSuccessful()");
    expect(src).toContain("getErrorMessages()");
    expect(src).toContain("mutate failed: ");
  });

  it("creates keywords with match-type enum and negatives", () => {
    const src = buildCreateCampaignScript(samplePlan());
    expect(src).toContain("matchType");
    expect(src).toContain("negative: true");
    expect(src).toContain("headlines");
    expect(src).toContain("descriptions");
  });

  it("rounds ad-group bids to the billable unit (Google rejects 1.2709-style bids)", () => {
    const src = buildCreateCampaignScript(samplePlan());
    // Regression 2026-10-22: cpcBidMicros "1270900" was rejected with
    // "Value must be a multiple of billable unit" — bids must go through
    // bidMicros_ (nearest 10000 micros), never raw micros_.
    expect(src).toContain("function bidMicros_");
    expect(src).toContain("create.cpcBidMicros = bidMicros_(g.maxCpc.amount)");
    expect(src).not.toContain("create.cpcBidMicros = micros_");
  });

  it("passes the static security audit", () => {
    const src = buildCreateCampaignScript(samplePlan());
    expect(assertScriptSourceSafe(src)).toEqual([]);
  });

  it("refuses to build when the plan is invalid", () => {
    const plan = samplePlan();
    plan.campaign.dailyBudget.amount = -5;
    expect(() => buildCreateCampaignScript(plan)).toThrow(/dailyBudget/);
  });

  it("P1-25: writes ad schedules when the plan has them", () => {
    const plan = samplePlan();
    plan.adSchedules = [
      { dayOfWeek: "MONDAY", startHour: 9, startMinute: 0, endHour: 21, endMinute: 0 },
    ];
    const src = buildCreateCampaignScript(plan);
    expect(src).toContain("applyAdSchedules_");
    expect(src).toContain("adSchedule");
    expect(src).toContain("campaignCriterionOperation");
  });

  it("P1-25: refuses to build with an invalid schedule", () => {
    const plan = samplePlan();
    plan.adSchedules = [
      { dayOfWeek: "MONDAY", startHour: 21, startMinute: 0, endHour: 9, endMinute: 0 },
    ];
    expect(() => buildCreateCampaignScript(plan)).toThrow(/adSchedules/);
  });

  it("embeds split finalUrl + finalUrlSuffix for URLs with a query", () => {
    const plan = samplePlan([
      "https://www.amazon.com/dp/B0D25WCVYD?lv=shuf&tag=maas",
    ]);
    const embedded = embeddedPlan(buildCreateCampaignScript(plan));
    expect(embedded.adGroups[0]!.rsa.finalUrl).toBe(
      "https://www.amazon.com/dp/B0D25WCVYD"
    );
    expect(embedded.adGroups[0]!.rsa.finalUrlSuffix).toBe("lv=shuf&tag=maas");
  });

  it("embeds null finalUrlSuffix for URLs without a query", () => {
    const embedded = embeddedPlan(buildCreateCampaignScript(samplePlan()));
    expect(embedded.adGroups[0]!.rsa.finalUrl).toBe(
      "https://merchant.example/offer"
    );
    expect(embedded.adGroups[0]!.rsa.finalUrlSuffix).toBeNull();
  });

  it("template splits at runtime for old plans without finalUrlSuffix", () => {
    // 旧计划只有完整 finalUrl 时，模板在运行时现切，参数不会丢。
    const src = buildCreateCampaignScript(samplePlan());
    expect(src).toContain('indexOf("?")');
    expect(src).toContain("adObj.finalUrlSuffix = finalUrlSuffix");
    expect(src).toContain("finalUrls: [finalUrlRaw]");
  });
});
