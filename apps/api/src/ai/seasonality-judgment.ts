/**
 * 季节 AI 判断：给已算好的季节信号写一句建议（布局 / 观望 / 放弃）。
 *
 * 绝不编造：prompt 只传入实测信号（Trends 结论/方向/YoY、距峰值、DataForSEO 量 YoY、代码算的季节分），
 * 模型只能用这些数推理，不许编销量、CPC、CVR、payout；normalize 再校验 suggestion 枚举 + 置信度钳制。
 * 与“季节评分”分工：评分是代码按实测信号算的分（透明分项）；AI 判断是把信号翻成一句话行动建议。
 */
import { chatJson } from "./llm.js";

export interface SeasonalityJudgmentInput {
  keyword: string;
  /** 国家中文/英文名（如“美国”） */
  countryLabel: string;
  verdict: string;
  direction: string | null;
  yoyChangePct: number | null;
  daysToPeak: number | null;
  volume: number | null;
  volumeYoyPct: number | null;
  /** 代码算的季节分（0-100）；数据不足时 null */
  score: number | null;
}

export interface SeasonalityJudgment {
  /** go=布局 / watch=观望 / skip=放弃 */
  suggestion: "go" | "watch" | "skip";
  /** 1-2 句话，引用传入的实测数 */
  reason: string;
  /** 0-100 */
  confidence: number;
}

export type AnalysisLanguage = "zh" | "en";

export function buildSeasonalityJudgmentPrompt(
  input: SeasonalityJudgmentInput,
  language: AnalysisLanguage
): { system: string; user: string } {
  const data = JSON.stringify(
    {
      keyword: input.keyword,
      country: input.countryLabel,
      verdict: input.verdict,
      direction: input.direction,
      trendsYoyPct: input.yoyChangePct,
      daysToPeak: input.daysToPeak,
      monthlySearchVolume: input.volume,
      volumeYoyPct: input.volumeYoyPct,
      seasonalScore: input.score,
    },
    null,
    2
  );
  if (language === "en") {
    return {
      system:
        "You are an affiliate marketing expert. Return JSON only. Never invent: use ONLY the measured numbers given in the input. Do not invent sales, CPC, CVR, payout, or refund rate.",
      user: `Decide whether to prepare a paid-traffic campaign for this keyword in this country, based ONLY on the measured seasonal signals below.\n\nMeasured signals:\n---\n${data}\n---\n\nRules:\n- suggestion: "go" (prepare now) when the signal says approaching peak / rising with positive YoY; "watch" when upcoming/flat or signals are mixed; "skip" when past peak / falling / negative YoY.\n- reason: 1-2 sentences in English, citing the actual numbers given (e.g. days to peak, YoY). Never cite a number that is not in the input.\n- confidence: 0-100, higher when monthly search volume is present (complete data), lower when it is null.\n- Return JSON only: {"suggestion":"go","reason":"...","confidence":80}\n`,
    };
  }
  return {
    system:
      "你是一名联盟营销专家。只返回 JSON。绝不编造：只能用下面给出的实测数字推理，不许编销量、CPC、CVR、payout、退款率。",
    user: `只根据下面给出的实测季节信号，判断该关键词在该国家是否值得准备付费投流。\n\n实测信号：\n---\n${data}\n---\n\n规则：\n- suggestion：“go”（布局）= 信号显示即将进入热销季 / 热度上升且同比为正；“watch”（观望）= 距峰值还远 / 平稳 / 信号矛盾；“skip”（放弃）= 已过峰 / 下降 / 同比为负。\n- reason：1-2 句话中文，引用给出的实际数字（如距峰值天数、同比）。不许引用输入里没有的数字。\n- confidence：0-100，有月搜索量时更高（数据完整），无月搜索量时更低。\n- 只返回 JSON：{"suggestion":"go","reason":"……","confidence":80}\n`,
  };
}

/** 校验 + 清洗 AI 返回的判断（枚举 + 置信度钳制 + reason 截断；形状不对 → 抛错由路由转 502）。 */
export function normalizeSeasonalityJudgment(raw: unknown): SeasonalityJudgment {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const suggestion = obj.suggestion;
  if (suggestion !== "go" && suggestion !== "watch" && suggestion !== "skip") {
    throw new Error("invalid suggestion");
  }
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  if (!reason) throw new Error("empty reason");
  const confidenceRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 50;
  return { suggestion, reason: reason.slice(0, 300), confidence };
}

export async function judgeSeasonalityWithAi(
  config: {
    baseUrl: string;
    model: string;
    apiKey: string;
    language: AnalysisLanguage;
  },
  input: SeasonalityJudgmentInput
): Promise<SeasonalityJudgment> {
  const { system, user } = buildSeasonalityJudgmentPrompt(input, config.language);
  const raw = await chatJson({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    system,
    user,
  });
  return normalizeSeasonalityJudgment(raw);
}
