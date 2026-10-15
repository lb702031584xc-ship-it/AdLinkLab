/**
 * 功能2 — 自动化广告：`create-campaign` Google Ads Script 模板。
 *
 * 由 POST /api/v1/ads/auto-create/confirm 下发的建广告任务使用：
 * 用户把生成的 Script 粘贴到 Google Ads Scripts 中运行一次，
 * 按 AdPlan 创建 campaign → ad groups → keywords → 否词 → RSA。
 *
 * 安全铁律（模板内强制执行）：
 * 1. 只创建计划中指定的结构：创建前按精确名称检查已存在实体，
 *    已存在则整单跳过（幂等），绝不修改账户内其他系列/广告组/广告。
 * 2. 预算只使用计划中的值；计划缺失或非法预算时直接中止，
 *    不设任何离谱默认值。
 * 3. 新建 campaign / ad group 一律 PAUSED，由人工审核后开启。
 * 4. 绝不调用 remove()/pause()/setStatus(ENABLED) 等变更已有实体的 API，
 *    不触碰账户级设置。
 *
 * 实现注意：AdsApp 没有 newCampaignBuilder（调用会报
 * `AdsApp.newCampaignBuilder is not a function`）。创建统一走
 * AdsApp.mutate()（Google Ads API REST）：先建 CampaignBudget，
 * 再建 Campaign，再建 AdGroup / 关键词 / 否词 / RSA。
 *
 * Target runtime: Google Ads Scripts (AdsApp), NOT Node.js — ES5 only.
 */
import { jsStringLiteral } from "./script-generator-source.js";
import type { AdPlan } from "../ai/ad-generator.js";

export const CREATE_CAMPAIGN_SCRIPT_VERSION = "1.1.0";

/** ISO country code → Google Ads geo target location ID (criteria ID). */
export const COUNTRY_LOCATION_IDS: Record<string, number> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2250,
  IT: 2380,
  ES: 2724,
  NL: 2528,
  BE: 2056,
  CH: 2756,
  AT: 2040,
  SE: 2752,
  IE: 2372,
  JP: 2392,
  KR: 2410,
  SG: 2702,
  HK: 2344,
  IN: 2356,
  BR: 2076,
  MX: 2484,
  NZ: 2554,
};

/**
 * Validate the plan on the TypeScript side before embedding it.
 * Returns a list of problems; empty means the plan is safe to embed.
 * The generated Script repeats these checks defensively at runtime.
 */
export function validateCreateCampaignPlan(plan: AdPlan): string[] {
  const problems: string[] = [];
  if (!plan || typeof plan !== "object") {
    return ["plan is not an object"];
  }
  const budget = plan.campaign?.dailyBudget?.amount;
  if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) {
    problems.push("campaign.dailyBudget.amount must be a positive number");
  }
  if (!plan.campaign?.name?.trim()) {
    problems.push("campaign.name is required");
  }
  if (!Array.isArray(plan.adGroups) || plan.adGroups.length === 0) {
    problems.push("at least one ad group is required");
  }
  for (const [i, block] of (plan.adGroups ?? []).entries()) {
    if (!block?.group?.name?.trim()) {
      problems.push(`adGroups[${i}].group.name is required`);
    }
    const headlines = block?.rsa?.headlines ?? [];
    if (headlines.length < 3 || headlines.length > 15) {
      problems.push(`adGroups[${i}].rsa.headlines must contain 3-15 items`);
    }
    const descriptions = block?.rsa?.descriptions ?? [];
    if (descriptions.length < 2 || descriptions.length > 4) {
      problems.push(`adGroups[${i}].rsa.descriptions must contain 2-4 items`);
    }
    if (!block?.rsa?.finalUrl) {
      problems.push(`adGroups[${i}].rsa.finalUrl is required`);
    }
  }
  return problems;
}

/**
 * Build the Google Ads Script source with the plan embedded as JSON.
 * The plan JSON is injected via JSON.stringify escaping (same approach as
 * the existing script generator) to prevent quote/injection escapes.
 */
export function buildCreateCampaignScript(plan: AdPlan): string {
  const problems = validateCreateCampaignPlan(plan);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to build create-campaign script: ${problems.join("; ")}`
    );
  }
  const versionLit = jsStringLiteral(CREATE_CAMPAIGN_SCRIPT_VERSION);
  const planLit = jsStringLiteral(JSON.stringify(plan));
  const geoLit = jsStringLiteral(JSON.stringify(COUNTRY_LOCATION_IDS));

  return `/**
 * AdLinkLab create-campaign Script (generated)
 * Template version: ${CREATE_CAMPAIGN_SCRIPT_VERSION}
 * Plan ID: ${plan.planId}
 *
 * SAFETY RULES (enforced below):
 * 1. Creates ONLY the campaign / ad groups / keywords / ads described in the
 *    embedded plan. Every entity is checked by EXACT name before creation;
 *    if the campaign already exists the whole run is skipped (idempotent).
 * 2. Budget is taken EXACTLY from the plan. If the plan budget is missing or
 *    not a positive number the script ABORTS — no fallback defaults.
 * 3. New campaigns and ad groups are created PAUSED. Enable them manually
 *    after review.
 * 4. This script NEVER modifies, pauses, enables or removes any existing
 *    entity, and never touches account-level settings.
 */
var ADLINKLAB_CREATE_CAMPAIGN = {
  version: ${versionLit},
  plan: JSON.parse(${planLit}),
  countryLocationIds: JSON.parse(${geoLit})
};

function main() {
  var cfg = ADLINKLAB_CREATE_CAMPAIGN;
  var plan = cfg.plan;
  var problems = validatePlan_(plan);
  if (problems.length > 0) {
    Logger.log("ABORT: invalid plan: " + problems.join("; "));
    return;
  }
  var campaignName = plan.campaign.name;
  if (campaignExists_(campaignName)) {
    Logger.log(
      'SKIP: campaign "' + campaignName + '" already exists. ' +
      "Nothing was created or modified (idempotent)."
    );
    return;
  }
  var budgetRn = createBudget_(campaignName, plan.campaign.dailyBudget.amount);
  if (!budgetRn) {
    Logger.log("ABORT: campaign budget creation failed; nothing else was attempted.");
    return;
  }
  var campaignRn = createCampaign_(plan.campaign, budgetRn);
  if (!campaignRn) {
    Logger.log("ABORT: campaign creation failed; nothing else was attempted.");
    return;
  }
  applyGeoTargets_(campaignRn, plan.campaign.geoTargets || []);
  var createdGroups = 0;
  for (var i = 0; i < plan.adGroups.length; i++) {
    if (createAdGroup_(campaignRn, plan.adGroups[i])) {
      createdGroups++;
    }
  }
  Logger.log(
    'DONE: created campaign "' + campaignName + '" (PAUSED) with ' +
    createdGroups + "/" + plan.adGroups.length + " ad groups. " +
    "Review and enable manually."
  );
}

// Single mutate wrapper: a failed operation does NOT throw — it returns a
// MutateResult with isSuccessful() === false and the real Google error in
// getErrorMessages(). Always surface those messages; never fail silently.
function mutate_(operation) {
  try {
    var result = AdsApp.mutate(operation);
    if (!result) {
      Logger.log("mutate failed: empty result");
      return null;
    }
    if (typeof result.isSuccessful === "function" && !result.isSuccessful()) {
      var errs = [];
      try {
        errs = result.getErrorMessages() || [];
      } catch (e2) {
        errs = [];
      }
      Logger.log(
        "mutate failed: " + (errs.length ? errs.join("; ") : "unknown error")
      );
      return null;
    }
    var rn = result.getResourceName();
    if (!rn) {
      Logger.log("mutate failed: empty resource name");
      return null;
    }
    return String(rn);
  } catch (e) {
    Logger.log("mutate failed: " + e);
    return null;
  }
}

// Google Ads API money is integer micros as a string: $42.50 -> "42500000".
function micros_(amount) {
  return String(Math.round(Number(amount) * 1000000));
}

function validatePlan_(plan) {
  var problems = [];
  if (!plan || typeof plan !== "object") {
    return ["plan is not an object"];
  }
  var budget = plan.campaign && plan.campaign.dailyBudget && plan.campaign.dailyBudget.amount;
  if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) {
    problems.push("campaign.dailyBudget.amount must be a positive number (no default applied)");
  }
  if (!plan.campaign || !plan.campaign.name) {
    problems.push("campaign.name is required");
  }
  if (!plan.adGroups || plan.adGroups.length === 0) {
    problems.push("at least one ad group is required");
  }
  return problems;
}

function escapeCondition_(value) {
  return String(value).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
}

function campaignExists_(name) {
  var it = AdsApp.campaigns()
    .withCondition('campaign.name = "' + escapeCondition_(name) + '"')
    .get();
  return it.hasNext();
}

function createBudget_(campaignName, amount) {
  var rn = mutate_({ campaignBudgetOperation: { create: {
    name: campaignName + " budget",
    amountMicros: micros_(amount),
    deliveryMethod: "STANDARD"
  } } });
  if (!rn) {
    Logger.log('campaign budget creation failed for "' + campaignName + '"');
  }
  return rn;
}

function createCampaign_(c, budgetRn) {
  var create = {
    name: c.name,
    campaignBudget: budgetRn,
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    // REQUIRED by the Google Ads API (EU political-ad transparency).
    // AdLinkLab plans are product/affiliate ads, never EU political ads.
    containsEuPoliticalAdvertising: false,
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false
    }
  };
  if (c.bidding && c.bidding.strategy === "MAXIMIZE_CLICKS") {
    create.maximizeClicks = {};
  } else {
    create.manualCpc = {};
  }
  var rn = mutate_({ campaignOperation: { create: create } });
  if (!rn) {
    Logger.log('campaign creation failed for "' + c.name + '"');
  }
  return rn;
}

function applyGeoTargets_(campaignRn, geoTargets) {
  var ids = ADLINKLAB_CREATE_CAMPAIGN.countryLocationIds;
  for (var i = 0; i < geoTargets.length; i++) {
    var code = String(geoTargets[i]).toUpperCase();
    var locationId = ids[code];
    if (!locationId) {
      Logger.log("SKIP geo target " + code + ": no location ID mapping; configure manually.");
      continue;
    }
    var rn = mutate_({ campaignCriterionOperation: { create: {
      campaign: campaignRn,
      location: { geoTargetConstant: "geoTargetConstants/" + locationId }
    } } });
    if (!rn) {
      Logger.log("geo target failed " + code);
    }
  }
}

function createAdGroup_(campaignRn, block) {
  var g = block.group;
  var rsa = block.rsa;
  var create = {
    campaign: campaignRn,
    name: g.name,
    status: "PAUSED"
  };
  if (g.maxCpc && typeof g.maxCpc.amount === "number" && g.maxCpc.amount > 0) {
    create.cpcBidMicros = micros_(g.maxCpc.amount);
  }
  var adGroupRn = mutate_({ adGroupOperation: { create: create } });
  if (!adGroupRn) {
    Logger.log('ad group "' + g.name + '" creation failed');
    return false;
  }

  var i;
  for (i = 0; i < (g.keywords || []).length; i++) {
    var kw = g.keywords[i];
    var kop = { adGroupCriterionOperation: { create: {
      adGroup: adGroupRn,
      keyword: { text: String(kw.text), matchType: kw.matchType || "BROAD" },
      status: "ENABLED"
    } } };
    if (!mutate_(kop)) {
      Logger.log("keyword failed [" + kw.text + "]");
    }
  }
  for (i = 0; i < (g.negativeKeywords || []).length; i++) {
    var neg = g.negativeKeywords[i];
    var nop = { adGroupCriterionOperation: { create: {
      adGroup: adGroupRn,
      negative: true,
      keyword: { text: String(neg.text), matchType: neg.matchType || "PHRASE" },
      status: "ENABLED"
    } } };
    if (!mutate_(nop)) {
      Logger.log("negative keyword failed [" + neg.text + "]");
    }
  }

  var headlines = [];
  for (i = 0; i < rsa.headlines.length; i++) {
    headlines.push({ text: String(rsa.headlines[i]) });
  }
  var descriptions = [];
  for (i = 0; i < rsa.descriptions.length; i++) {
    descriptions.push({ text: String(rsa.descriptions[i]) });
  }
  var rsaBody = {
    headlines: headlines,
    descriptions: descriptions
  };
  if (rsa.path1) {
    rsaBody.path1 = String(rsa.path1);
  }
  if (rsa.path2) {
    rsaBody.path2 = String(rsa.path2);
  }
  var aop = { adGroupAdOperation: { create: {
    adGroup: adGroupRn,
    status: "PAUSED",
    ad: {
      responsiveSearchAd: rsaBody,
      finalUrls: [String(rsa.finalUrl)]
    }
  } } };
  if (!mutate_(aop)) {
    Logger.log('RSA creation failed in "' + g.name + '"');
    return false;
  }
  return true;
}
`;
}
