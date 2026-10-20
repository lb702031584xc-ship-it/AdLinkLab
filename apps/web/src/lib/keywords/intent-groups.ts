/**
 * 关键词意图分组（#13，纯前端启发式，纯函数可测）。
 *
 * 只按关键词文本规则判断，不调 AI、不改现有 AI 相关性检查：
 * 品牌（命中所选 offer 品牌名）> 型号（字母+数字型号 token / 命中产品型号）>
 * 对比（vs / compare / alternative）> 评测（review / rating）>
 * 攻略（how / guide / best way）> 场景（for + 场景词 / 场景名词）> 泛需求（兜底）。
 *
 * 分组只是建议：UI 允许人工改组。每组给出承接页类型提示——
 * 判断法：看自然搜索第一名是什么页面，就用什么页面承接。
 */
export type KeywordIntentGroup =
  | "brand"
  | "model"
  | "compare"
  | "review"
  | "guide"
  | "scenario"
  | "generic";

export interface IntentGroupMeta {
  key: KeywordIntentGroup;
  nameZh: string;
  nameEn: string;
  /** 承接页类型提示 */
  landingZh: string;
  landingEn: string;
}

export const INTENT_GROUP_META: Record<KeywordIntentGroup, IntentGroupMeta> = {
  brand: {
    key: "brand",
    nameZh: "品牌",
    nameEn: "Brand",
    landingZh: "官网首页",
    landingEn: "Official homepage",
  },
  model: {
    key: "model",
    nameZh: "型号",
    nameEn: "Model",
    landingZh: "产品页",
    landingEn: "Product page",
  },
  compare: {
    key: "compare",
    nameZh: "对比",
    nameEn: "Compare",
    landingZh: "对比页",
    landingEn: "Comparison page",
  },
  review: {
    key: "review",
    nameZh: "评测",
    nameEn: "Review",
    landingZh: "评测页",
    landingEn: "Review page",
  },
  guide: {
    key: "guide",
    nameZh: "攻略",
    nameEn: "Guide",
    landingZh: "攻略/内容页",
    landingEn: "Guide / content page",
  },
  scenario: {
    key: "scenario",
    nameZh: "场景",
    nameEn: "Scenario",
    landingZh: "引导页或产品页",
    landingEn: "Landing or product page",
  },
  generic: {
    key: "generic",
    nameZh: "泛需求",
    nameEn: "Generic need",
    landingZh: "引导页或产品页",
    landingEn: "Landing or product page",
  },
};

export const INTENT_GROUP_ORDER: KeywordIntentGroup[] = [
  "brand",
  "model",
  "compare",
  "review",
  "guide",
  "scenario",
  "generic",
];

const COMPARE_RE = /\b(vs|versus|compare|compared|comparison|alternative|alternatives)\b|对比|还是/;
const REVIEW_RE = /\b(review|reviews|rating|ratings|rated)\b|评测|测评|评价/;
const GUIDE_RE = /\b(how|guide|tutorial|tips|troubleshooting)\b|best way to|攻略|教程|怎么|如何/;
/** 场景词：使用地点 / 人群 / 用途（中英） */
const SCENARIO_RE =
  /\bfor\s+(home|office|travel|kids|pets|students|seniors|gaming|work|school|car|outdoor|camping|apartment|dorm|bedroom|kitchen|bathroom|garden|small\s+spaces)\b|\b(bedroom|kitchen|bathroom|office|apartment|dorm|outdoor|camping|travel|portable)\b|家用|卧室|厨房|办公室|宿舍|户外|旅行|儿童|宠物/;

/** 型号 token：同一 token 内同时含字母与数字，如 s8、10r、a17pro、x100、q7-max 的分段。 */
function hasModelToken(keyword: string): boolean {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((tok) => tok.length >= 2 && /[a-z]/.test(tok) && /\d/.test(tok));
}

export function classifyKeywordIntent(
  keyword: string,
  opts?: { brand?: string | null; models?: string[] }
): KeywordIntentGroup {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return "generic";

  const brand = (opts?.brand ?? "").trim().toLowerCase();
  if (brand && kw.includes(brand)) return "brand";

  const models = (opts?.models ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean);
  if (models.some((m) => kw.includes(m))) return "model";
  if (hasModelToken(kw)) return "model";

  if (COMPARE_RE.test(kw)) return "compare";
  if (REVIEW_RE.test(kw)) return "review";
  if (GUIDE_RE.test(kw)) return "guide";
  if (SCENARIO_RE.test(kw)) return "scenario";
  return "generic";
}

export interface IntentGroupedKeywords {
  group: KeywordIntentGroup;
  keywords: string[];
}

/** 按组聚合（保持组内原顺序，空组不返回）；重复词（大小写不敏感）只保留首次。 */
export function groupKeywordsByIntent(
  keywords: string[],
  opts?: { brand?: string | null; models?: string[] }
): IntentGroupedKeywords[] {
  const byGroup = new Map<KeywordIntentGroup, string[]>();
  const seen = new Set<string>();
  for (const raw of keywords) {
    const kw = raw.trim();
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const g = classifyKeywordIntent(kw, opts);
    const arr = byGroup.get(g) ?? [];
    arr.push(kw);
    byGroup.set(g, arr);
  }
  return INTENT_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
    group: g,
    keywords: byGroup.get(g) ?? [],
  }));
}
