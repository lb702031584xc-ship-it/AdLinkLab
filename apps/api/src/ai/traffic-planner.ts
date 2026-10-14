/**
 * 投流决策 AI 分析：prompt 构建器。
 *
 * 2×2 四种组合（投流方式 × 品牌词政策），每种有独立的转化率假设、
 * 关键词策略、出价公式。EPC 优先判断：有 EPC 走 EPC 路线，
 * 无 EPC 才走 CPC÷佣金估算路线。
 */

export type TrafficMode = "landing" | "direct";
export type BrandPolicy = "allowed" | "forbidden";

export interface KeywordRow {
  keyword: string;
  volume?: number; // 月搜索量
  cpc?: number; // SEMRUSH CPC（美元）
  plannerLow?: number; // Keyword Planner 首页出价低位
  plannerHigh?: number; // Keyword Planner 首页出价高位
  competition?: string; // Low/Medium/High
  density?: number; // SEMRUSH 竞争密度 0~1
  intent?: string; // 交易/商业/信息/导航
}

export interface TrafficPlanInput {
  mode: TrafficMode;
  brandPolicy: BrandPolicy;
  language: "zh" | "en";
  // Offer 基础
  offerName: string;
  payout?: number; // 佣金（美元）
  network?: string;
  cookieDays?: number;
  // 联盟网络后台数据
  epc?: number; // 每次点击收益（美元）
  networkCvr?: number; // 网络平均转化率（%）
  refundRate?: number; // 退款率（%）
  // Offervault 横向对比
  bestPayout?: number; // 其他网络最高佣金
  bestPayoutNetwork?: string;
  // 竞争对手情报
  competitorAds?: string; // Transparency Center 观察：对手广告文案/投放时长
  spyfuKeywords?: string; // SpyFu 对手关键词摘要
  spyfuBudgetTrend?: string; // 对手预算趋势：涨/跌/稳
  similarwebNotes?: string; // SimilarWeb 流量结构观察
  // 电商产品数据（插件抓 Amazon/Keepa/Shopping 实查）
  ecommerceNotes?: string;
  // 关键词数据
  keywords: KeywordRow[];
  negativeKeywords: string[];
  targetProfitMargin?: number; // 目标利润率，默认 0.5
  notes?: string;
}

export interface ComboProfile {
  key: string;
  cvrLow: number; // 转化率下限（%）
  cvrHigh: number; // 转化率上限（%）
  cvrMid: number; // 测算用中值（%）
  label: string;
  keywordStrategy: string;
  negativeStrategy: string;
  bidGuidance: string;
  riskNotes: string;
}

export const COMBO_PROFILES: Record<string, ComboProfile> = {
  "landing_allowed": {
    key: "landing_allowed",
    cvrLow: 8, cvrHigh: 15, cvrMid: 10,
    label: "落地页 + 可投品牌词",
    keywordStrategy:
      "品牌词是核心资产：[品牌]+review、[品牌]+discount、[品牌]+coupon、[品牌]+vs竞品。配合高意图长尾词（best X for Y）。品牌词 CPC 通常便宜，优先抢首位。",
    negativeStrategy:
      "标准否定：售后类（维修/保修/说明书/客服/退货）、白嫖类（免费/破解）、求职类、二手类、纯信息类。品牌词本身不否定。",
    bidGuidance:
      "品牌词可积极出价（低位区间上限）；通用词按目标 CPA×转化率封顶。起始出价为 Planner 低位的 70~80%。",
    riskNotes:
      "即使允许品牌词，广告文案不得冒充官方；监控品牌方投诉。新手最推荐的组合。",
  },
  "landing_forbidden": {
    key: "landing_forbidden",
    cvrLow: 3, cvrHigh: 8, cvrMid: 5,
    label: "落地页 + 不可投品牌词",
    keywordStrategy:
      "打长尾包围战：best X for Y、X review、X alternative、X vs Y。避开一切品牌词及变体。用内容页（how to choose）养质量得分，间接拉低投放词 CPC。",
    negativeStrategy:
      "落地页+可投品牌词的全部否定，外加品牌词大扫除：品牌名、拼写错误变体、品牌+官网、品牌+客服。一个漏网品牌词可能被联盟封号。",
    bidGuidance:
      "通用词 CPC 高，严格按 目标CPA×5%转化率 封顶。起始出价为 Planner 低位的 50~60%，抢第 2~4 位便宜流量。",
    riskNotes:
      "品牌词误投是最大风险，否定清单必须全。对比评测类落地页转化最好。",
  },
  "direct_allowed": {
    key: "direct_allowed",
    cvrLow: 5, cvrHigh: 10, cvrMid: 7,
    label: "直链 + 可投品牌词",
    keywordStrategy:
      "品牌词直链是最简单的模式：只投临门一脚的词（buy、discount、coupon、promo code）。搜 review/对比类词的人还在犹豫，直链承接不住，谨慎投放。",
    negativeStrategy:
      "比落地页组合更激进：review、vs、alternative 类对比词建议否定或单独低价测试组。售后/白嫖/求职类照常否定。",
    bidGuidance:
      "对页面无控制，出价保守：最高出价 = 目标CPA×7%转化率。品牌词 CPC 便宜是唯一甜点，通用词基本买不起。",
    riskNotes:
      "转化率完全看商家页面。先小预算测试商家页质量：花 1 倍佣金无转化就停，换 offer。",
  },
  "direct_forbidden": {
    key: "direct_forbidden",
    cvrLow: 1, cvrHigh: 3, cvrMid: 2,
    label: "直链 + 不可投品牌词",
    keywordStrategy:
      "地狱模式：只能打最高意图长尾词（cheap、discount、buy 修饰词）。best 类词都嫌泛。没有品牌词红利，全靠 CPC 足够便宜。",
    negativeStrategy:
      "最激进的否定：不可投品牌词组合的全部，外加意图过滤——信息类、对比类一律否定，只留交易意图词。",
    bidGuidance:
      "盈亏门槛：CPC ÷ 佣金 ≤ 1.5% 才考虑。最高出价 = 目标CPA×2%转化率，极低。多数 offer 算出来都是亏。",
    riskNotes:
      "新手劝退组合。80% 的 offer 在此组合下测算为亏。优先建议换组合（加落地页或换可投品牌词的 offer）。",
  },
};

export function getComboProfile(mode: TrafficMode, brandPolicy: BrandPolicy): ComboProfile {
  return COMBO_PROFILES[`${mode}_${brandPolicy}`];
}

/**
 * 测算：返回每关键词行的盈亏数据（代码算，不依赖 LLM）。
 */
export interface KeywordMath {
  keyword: string;
  refCpc: number | null; // 参考 CPC：优先 Planner 低位，其次 SEMRUSH CPC
  breakEvenCvrPct: number | null; // 盈亏平衡转化率（%）
  maxBid: number | null; // 最高出价
  affordable: boolean | null; // 是否买得起
  verdict: string;
}

export function computeKeywordMath(
  input: TrafficPlanInput,
  profile: ComboProfile
): { rows: KeywordMath[]; epcVerdict: string | null } {
  const margin = input.targetProfitMargin ?? 0.5;
  const cvrMid = profile.cvrMid / 100;

  let epcVerdict: string | null = null;
  if (input.epc != null && input.payout != null) {
    const targetCpc = input.epc * (1 - margin);
    epcVerdict =
      `EPC $${input.epc.toFixed(2)}，按 ${Math.round(margin * 100)}% 利润率，` +
      `可接受 CPC 上限 $${targetCpc.toFixed(2)}。`;
  }

  const rows: KeywordMath[] = input.keywords.map((k) => {
    const refCpc = k.plannerLow ?? k.cpc ?? null;
    if (refCpc == null || input.payout == null || input.payout <= 0) {
      return {
        keyword: k.keyword, refCpc,
        breakEvenCvrPct: null, maxBid: null,
        affordable: null, verdict: "数据不足",
      };
    }
    const breakEvenCvrPct = (refCpc / input.payout) * 100;
    const targetCpa = input.payout * (1 - margin);
    const maxBid = targetCpa * cvrMid;
    const affordable = refCpc <= maxBid;
    const verdict = affordable
      ? `买得起（需转化率≥${breakEvenCvrPct.toFixed(1)}%，本组合基准${profile.cvrLow}~${profile.cvrHigh}%）`
      : `买不起（需转化率≥${breakEvenCvrPct.toFixed(1)}%，超基准上限${profile.cvrHigh}%）`;
    return { keyword: k.keyword, refCpc, breakEvenCvrPct, maxBid, affordable, verdict };
  });

  return { rows, epcVerdict };
}

/** 通用否定词库（按类别），AI 自动生成的基础。 */
export const UNIVERSAL_NEGATIVES: Record<string, string[]> = {
  售后类: ["维修", "保修", "说明书", "客服", "电话", "地址", "退货", "换货", "repair", "warranty", "manual", "support", "refund"],
  白嫖类: ["免费", "破解", "torrent", "下载", "试用", "free", "crack", "download"],
  求职类: ["招聘", "兼职", "工资", "面试", "jobs", "hiring", "salary"],
  二手类: ["二手", "闲置", "转让", "回收", "used", "second hand"],
  纯信息类: ["是什么", "图片", "视频", "新闻", "what is", "pictures"],
  本地类: ["附近", "门店", "经销商", "near me", "store location"],
};

export function buildTrafficPlanPrompt(input: TrafficPlanInput): { system: string; user: string } {
  const profile = getComboProfile(input.mode, input.brandPolicy);
  const { rows, epcVerdict } = computeKeywordMath(input, profile);
  const zh = input.language === "zh";

  const system = zh
    ? `你是拥有20年经验的联盟营销投流专家，擅长 Google Ads 付费流量。你说话直接、务实，用小白能听懂的大白话。你的判断必须基于数据做数学题，不凭感觉。`
    : `You are an affiliate marketing paid-traffic expert with 20 years of Google Ads experience. Be direct, practical, and explain in plain language a beginner can follow. Every judgment must be backed by math, not gut feeling.`;

  const kwTable = rows
    .map(
      (r) =>
        `- ${r.keyword}：参考CPC ${r.refCpc != null ? "$" + r.refCpc.toFixed(2) : "未知"}，` +
        `盈亏平衡转化率 ${r.breakEvenCvrPct != null ? r.breakEvenCvrPct.toFixed(1) + "%" : "未知"}，` +
        `最高出价 ${r.maxBid != null ? "$" + r.maxBid.toFixed(2) : "未知"} → ${r.verdict}`
    )
    .join("\n");

  const user = `
## 投流组合
${profile.label}（转化率基准 ${profile.cvrLow}~${profile.cvrHigh}%，测算用 ${profile.cvrMid}%）

## Offer 信息
- 名称：${input.offerName}
- 佣金：${input.payout != null ? "$" + input.payout : "未知"}
- 联盟网络：${input.network || "未知"}
- Cookie 有效期：${input.cookieDays != null ? input.cookieDays + " 天" : "未知"}
${input.bestPayout != null ? `- Offervault 横向对比：${input.bestPayoutNetwork || "其他网络"}给 $${input.bestPayout}（当前 $${input.payout}）` : ""}

## 联盟网络后台数据（真实转化数据，优先级最高）
${input.epc != null ? `- EPC：$${input.epc}` : "- EPC：未提供"}
${input.networkCvr != null ? `- 网络平均转化率：${input.networkCvr}%` : "- 网络平均转化率：未提供"}
${input.refundRate != null ? `- 退款率：${input.refundRate}%` : "- 退款率：未提供"}
${epcVerdict ? `- 代码测算：${epcVerdict}` : ""}

## 关键词测算（代码已算好，直接引用结论）
${kwTable || "（未提供关键词数据）"}

## 竞争对手情报
${input.competitorAds ? `- 广告透明度中心观察：${input.competitorAds}` : "- 广告透明度中心：未提供"}
${input.spyfuKeywords ? `- SpyFu 对手关键词：${input.spyfuKeywords}` : "- SpyFu：未提供"}
${input.spyfuBudgetTrend ? `- 对手预算趋势：${input.spyfuBudgetTrend}` : ""}
${input.similarwebNotes ? `- SimilarWeb 流量结构：${input.similarwebNotes}` : "- SimilarWeb：未提供"}
${input.ecommerceNotes ? `- 电商产品数据：${input.ecommerceNotes}` : "- 电商产品数据：未提供"}

## 否定关键词（用户已准备）
${input.negativeKeywords.length ? input.negativeKeywords.join("、") : "（未提供，用通用否定词库补）"}

## 本组合的专家策略（必须遵守）
- 关键词策略：${profile.keywordStrategy}
- 否定策略：${profile.negativeStrategy}
- 出价指导：${profile.bidGuidance}
- 风险提示：${profile.riskNotes}
${input.notes ? `\n## 用户备注\n${input.notes}` : ""}

## 输出要求（严格按此结构，用${zh ? "中文" : "English"}）
1. **一句话结论**：🟢跑 / 🟡小预算试 / 🔴别碰 + 一句话原因。有 EPC 时 EPC 判断优先于一切估算。
2. **算账表**：引用上面的代码测算，说明赚还是亏、空间多大。
3. **出价建议**：给出最高出价、起始出价、目标 CPA 三个具体数字。
4. **关键词分组**：投放组（列出词和匹配方式建议）、否定组（在用户否定的基础上补充你建议加的）、内容组（仅落地页模式）。
5. **新手三步走**：第一步建什么系列、第二步每天看什么数据、第三步什么情况关停（给出具体数字，如"花掉 2 倍佣金无转化就停"）。
`.trim();

  return { system, user };
}
