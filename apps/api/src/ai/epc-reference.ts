/**
 * AI 量级参考：后台拿不到 EPC / 转化率时，给一个“量级”参考区间（非实测）。
 *
 * 数据来源：基准转化率是联网查证后写进代码的行业公开数据（附来源与年份），
 * 不是实时搜索的结果——基准变化慢，写死比每次现搜更可靠、更省钱。
 * AI 在运行时只做一件事：按 offer 品类选最接近的基准行 + 写一句依据；
 * 区间数字由代码按 基准 CVR × payout 算出，不经过 LLM 算术，不许编造该 offer 的真实数。
 *
 * 硬隔离：返回的参考值只做展示，调用方绝不许把它写进 EPC / 转化率输入框，
 * 出价公式永远只用实测 EPC。
 */
import { chatJson } from "./llm.js";

/** 行业基准（联盟客 paid-search 场景的保守 CVR 区间，%）。 */
export interface CvrBenchmark {
  key: string;
  /** 中文名 */
  label: string;
  /** 保守区间下限（%） */
  low: number;
  /** 保守区间上限（%） */
  high: number;
  /** 来源（公开报告） */
  source: string;
}

export const CVR_BENCHMARKS: CvrBenchmark[] = [
  {
    key: "general",
    label: "通用",
    low: 0.5,
    high: 2,
    // GoAffPro 2026：affiliate CVR 行业平均 1–2%；OpenSend 2025：电商 affiliate 链接 0.5–1%
    source: "GoAffPro 2026 / OpenSend 2025",
  },
  {
    key: "ecommerce",
    label: "电商",
    low: 0.5,
    high: 2,
    // OpenSend 2025：0.5–1%；HamsterGarage：电商 1–3%；取保守交集
    source: "OpenSend 2025 / HamsterGarage",
  },
  {
    key: "saas",
    label: "SaaS",
    low: 1,
    high: 3,
    // HamsterGarage：SaaS 试用 3–7%，付费购买取保守 1–3%
    source: "HamsterGarage（试用基准折保守）",
  },
  {
    key: "finance",
    label: "金融",
    low: 1,
    high: 3,
    // HamsterGarage：金融 leads 约 4.2%，销售转化取保守 1–3%
    source: "HamsterGarage（leads 基准折保守）",
  },
  {
    key: "health_beauty",
    label: "健康美容",
    low: 1,
    high: 3,
    // 行业平均 1–2% 上浮一档，取保守 1–3%
    source: "GoAffPro 2026（行业平均上浮）",
  },
];

export function benchmarkFor(key: string): CvrBenchmark {
  return CVR_BENCHMARKS.find((b) => b.key === key) ?? CVR_BENCHMARKS[0]!;
}

export interface EpcReferenceInput {
  offerName: string;
  /** 每次转化的 payout（美元） */
  payout: number;
  /** 平均订单金额（美元，可空） */
  avgPrice: number | null;
  /** 佣金率（%，可空） */
  commissionRate: number | null;
  network: string;
}

export interface EpcReference {
  /** 选用的基准行 key */
  vertical: string;
  verticalLabel: string;
  /** CVR 参考区间（%） */
  cvrLow: number;
  cvrHigh: number;
  /** EPC 参考区间（美元/点击）= payout × CVR，代码算出 */
  epcLow: number;
  epcHigh: number;
  sources: string[];
  /** 1-2 句话：为什么选这个基准 */
  reasoning: string;
  confidence: number;
}

export type AnalysisLanguage = "zh" | "en";

/** LLM 只选 vertical + 写 reasoning；数字区间由调用方按基准表算。 */
export function buildEpcReferencePrompt(
  input: EpcReferenceInput,
  language: AnalysisLanguage
): { system: string; user: string } {
  const table = CVR_BENCHMARKS.map(
    (b) => `- ${b.key}（${b.label}）：CVR ${b.low}%–${b.high}%，来源 ${b.source}`
  ).join("\n");
  const offer = JSON.stringify(
    {
      offerName: input.offerName,
      payoutUSD: input.payout,
      avgPriceUSD: input.avgPrice,
      commissionRatePct: input.commissionRate,
      network: input.network,
    },
    null,
    2
  );
  if (language === "en") {
    return {
      system:
        "You are an affiliate marketing expert. Return JSON only. Never invent: you do NOT know this offer's real CVR or EPC. Only pick the closest benchmark row and explain why.",
      user: `An affiliate offer has no backend EPC / CVR data. Pick the closest industry benchmark row for a MAGNITUDE reference (not a real measurement).\n\nOffer:\n---\n${offer}\n---\n\nBenchmark table (affiliate paid-search, conservative CVR ranges):\n${table}\n\nRules:\n- vertical: the key of the closest row, or "general" when unsure. Never invent a new key.\n- reasoning: 1-2 sentences in English explaining why this row fits (cite the offer's category/price). Do NOT state any real CVR/EPC for this offer.\n- confidence: 0-100.\n- Return JSON only: {"vertical":"ecommerce","reasoning":"...","confidence":60}\n`,
    };
  }
  return {
    system:
      "你是一名联盟营销专家。只返回 JSON。绝不编造：你不知道这个 offer 的真实 CVR / EPC，只选最接近的基准行并解释原因。",
    user: `一个联盟 offer 没有后台 EPC / 转化率数据。请选最接近的行业基准行，给一个“量级”参考（不是实测）。\n\nOffer：\n---\n${offer}\n---\n\n基准表（联盟客 paid-search 场景，保守 CVR 区间）：\n${table}\n\n规则：\n- vertical：最接近的行的 key，不确定就填 "general"。不许自创 key。\n- reasoning：1-2 句话中文，解释为什么选这一行（结合 offer 品类/价格）。不许断言该 offer 的真实 CVR / EPC。\n- confidence：0-100。\n- 只返回 JSON：{"vertical":"ecommerce","reasoning":"……","confidence":60}\n`,
  };
}

export interface EpcReferenceLlmResult {
  vertical: string;
  reasoning: string;
  confidence: number;
}

/** 校验 LLM 返回（vertical 必须命中基准表，否则回退 general）。 */
export function normalizeEpcReferenceLlm(raw: unknown): EpcReferenceLlmResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const vertical =
    typeof obj.vertical === "string" &&
    CVR_BENCHMARKS.some((b) => b.key === obj.vertical)
      ? obj.vertical
      : "general";
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";
  if (!reasoning) throw new Error("empty reasoning");
  const cRaw = Number(obj.confidence);
  const confidence = Number.isFinite(cRaw)
    ? Math.max(0, Math.min(100, Math.round(cRaw)))
    : 50;
  return { vertical, reasoning: reasoning.slice(0, 300), confidence };
}

/**
 * 生成量级参考。EPC 区间由代码按 基准 CVR × payout 算（保留 3 位小数），
 * 不经过 LLM，保证数字与基准表一致。
 */
export async function judgeEpcReferenceWithAi(
  config: {
    baseUrl: string;
    model: string;
    apiKey: string;
    language: AnalysisLanguage;
  },
  input: EpcReferenceInput
): Promise<EpcReference> {
  const { system, user } = buildEpcReferencePrompt(input, config.language);
  const raw = await chatJson({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    system,
    user,
  });
  const llm = normalizeEpcReferenceLlm(raw);
  const bench = benchmarkFor(llm.vertical);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    vertical: bench.key,
    verticalLabel: bench.label,
    cvrLow: bench.low,
    cvrHigh: bench.high,
    epcLow: round3((input.payout * bench.low) / 100),
    epcHigh: round3((input.payout * bench.high) / 100),
    sources: [bench.source],
    reasoning: llm.reasoning,
    confidence: llm.confidence,
  };
}
