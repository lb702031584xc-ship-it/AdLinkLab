/**
 * 单次转化佣金门槛（USD）：低于此值的 offer / 商品判定为"不值得测试"。
 *
 * 三处共用同一常量 + 同一 AI 设置覆盖项（ai_settings.minCommissionUsd）：
 * 1. 一键推演综合决策（apps/api/src/ai/blueprint.ts §7）→ verdict stop（经济性原因）
 * 2. 工作表盈利腿（apps/api/src/ai/pipeline.ts synthesizeDecision）→ 最弱档 DO_NOT_RUN（经济性原因）
 * 3. 商品库同步入库过滤（apps/api/src/services/catalog-sync.ts）→ 不入库，只计数
 *
 * 口径：阈值按 USD 比较；调用方传入的 payout 应为 USD（联盟佣金实务上即 USD 口径）。
 * 确定性规则，只走代码，不走 LLM。
 */

/** 默认门槛：单次转化佣金低于 $8 → 不值得测试（保本 CPC 没有操作空间）。 */
export const MIN_COMMISSION_USD = 8;

/** 佣金数字的数据来源。 */
export type CommissionFigureSource = "reported" | "estimated" | "unknown";

export interface CommissionFigure {
  /** 单次转化佣金（USD 口径）；算不出时为 null（未知）。 */
  figure: number | null;
  /**
   * reported = 联盟实报的固定佣金金额；
   * estimated = 百分比佣金 × 价格估算；
   * unknown = 算不出（不拦截，只拦"明确低于"的）。
   */
  source: CommissionFigureSource;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toPositiveNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : null;
}

/**
 * 从固定佣金 / 百分比佣金+价格推导单次转化佣金数字与来源。
 * - amount（固定佣金，如 23.4）优先 → reported
 * - 否则 ratePct（百分比，如 13 表示 13%）× price → estimated
 * - 都算不出 → { figure: null, source: "unknown" }
 */
export function estimateCommissionFigure(args: {
  amount?: unknown;
  ratePct?: unknown;
  price?: unknown;
}): CommissionFigure {
  const amount = toPositiveNum(args.amount);
  if (amount != null) return { figure: round2(amount), source: "reported" };
  const rate = toPositiveNum(args.ratePct);
  const price = toPositiveNum(args.price);
  // 佣金率 >100% 是脏数据（正常佣金不可能超过售价）→ 按未知处理，不估算。
  if (rate != null && price != null && rate <= 100) {
    return { figure: round2((price * rate) / 100), source: "estimated" };
  }
  return { figure: null, source: "unknown" };
}

/**
 * 佣金是否"明确低于"门槛。未知（null/undefined/NaN）不拦——
 * 只拦能算出数字且低于门槛的。
 */
export function belowMinCommission(
  payout: number | null | undefined,
  thresholdUsd: number = MIN_COMMISSION_USD
): boolean {
  return (
    typeof payout === "number" && Number.isFinite(payout) && payout < thresholdUsd
  );
}

/**
 * 经济性 stop 的 reason（中英双语）。
 * 明确写"经济性判定"，绝不写成政策禁止（与条款 stop 区分）。
 */
export function minCommissionStopReason(
  payout: number,
  currency: string,
  thresholdUsd: number,
  language: "zh" | "en"
): string {
  const cur = (currency || "USD").trim() || "USD";
  const t = `$${thresholdUsd}`;
  return language === "zh"
    ? `单次转化佣金 ${cur} ${payout} 低于 ${t}——佣金太低，保本 CPC 没有操作空间，不值得测试（经济性判定，非政策禁止）。`
    : `Per-conversion commission ${cur} ${payout} is below ${t} — too thin to leave room for a workable break-even CPC; not worth testing (economic judgment, not a policy block).`;
}
