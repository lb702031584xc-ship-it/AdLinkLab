/**
 * P0-6 — AI 成本记账：模型价格表。
 *
 * 价格为公开价折算的**近似价、可配**：按 USD/1M tokens 计，实际账单以服务商
 * 为准（DeepSeek 还有高峰/低谷价、缓存命中折扣等，这里不建模）。
 * 如需精确账单，请以服务商控制台为准；改价只需改下面这张表。
 * 未知模型按 DeepSeek Chat 的价格兜底（不阻塞记账）。
 *
 * 参考（2025 年公开价，USD/1M tokens）：
 * - deepseek-chat: input 0.27 / output 1.10（高峰价；低谷约半价）
 * - deepseek-reasoner: input 0.55 / output 2.19
 * - gpt-4o-mini: input 0.15 / output 0.60
 * - gpt-4o: input 2.50 / output 10.00
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillionUsd: number;
  /** USD per 1M output tokens. */
  outputPerMillionUsd: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-chat": { inputPerMillionUsd: 0.27, outputPerMillionUsd: 1.1 },
  "deepseek-reasoner": { inputPerMillionUsd: 0.55, outputPerMillionUsd: 2.19 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
};

/** 未知模型的兜底价（DeepSeek Chat 价格）。 */
export const FALLBACK_PRICING: ModelPricing = MODEL_PRICING["deepseek-chat"];

export function pricingForModel(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

/**
 * 按价格表估算一次调用的成本（美分，整数）。
 * LLM 没返回 usage 时调用方传 0，成本即为 0——绝不编造 tokens。
 */
export function estimateCostCents(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const safeIn = Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0;
  const safeOut = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
  if (safeIn === 0 && safeOut === 0) return 0;
  const p = pricingForModel(model);
  const usd =
    (safeIn * p.inputPerMillionUsd + safeOut * p.outputPerMillionUsd) / 1_000_000;
  return Math.round(usd * 100);
}
