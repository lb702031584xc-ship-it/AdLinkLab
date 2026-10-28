/**
 * 投放复盘校准（2026-10-28，纯函数）。
 *
 * 解决的问题：初筛用的 EPC 是假设值，投完有了实测值，但两者从不对比，
 * 于是每一批都从同一个假设出发，系统永远学不会。
 *
 * 数据源：LaunchArchive 天然同时带着「计划时的 EPC」和「实际点击/收入」。
 *   - plannedEpcUsd ← archive.epc（计划稿估算）
 *   - actualEpcUsd  ← archive.revenue / archive.clicks（联盟确认后）
 *
 * k = median(计划 EPC ÷ 实测 EPC)
 *   k = 2.0 表示你一贯把 EPC 高估一倍。下一批的假设值应当除以 k。
 *
 * 纪律：
 *   - 点击样本不足的归档不进统计（噪声）；
 *   - 实测 EPC 为 0 或收入为空的不算比值（除零）；
 *   - 样本太少时 k 仍然给出，但 confidence 标 insufficient，前端必须显示。
 */
export interface CalibrationSourceRow {
  offerId: string | null;
  offerName?: string | null;
  plannedEpcUsd: number | null;
  clicks: number | null;
  revenueUsd: number | null;
  spendUsd: number | null;
}

export interface CalibrationOffender {
  offerId: string;
  name: string | null;
  /** 计划 EPC ÷ 实测 EPC */
  ratio: number;
  plannedEpcUsd: number;
  actualEpcUsd: number;
}

export type CalibrationConfidence = "insufficient" | "weak" | "ok";

export interface CalibrationResult {
  /** 参与统计的归档条数。 */
  samples: number;
  /** 高估倍数中位数；无样本为 null。 */
  k: number | null;
  /** (k − 1) × 100，正数表示高估。 */
  biasPct: number | null;
  /** 计划 EPC 高于实测的占比。 */
  overestimateRate: number | null;
  /** 实际亏损（花费 > 收入）的占比。 */
  lossRate: number | null;
  totalSpendUsd: number;
  totalRevenueUsd: number;
  confidence: CalibrationConfidence;
  /** 高估最严重的几条，供人工复核。 */
  worst: CalibrationOffender[];
  notes: string[];
}

const MIN_CLICKS_DEFAULT = 50;
const MIN_SAMPLES_WEAK = 5;
const MIN_SAMPLES_OK = 10;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function calibrateFromArchives(
  rows: CalibrationSourceRow[],
  opts: { minClicks?: number; worstLimit?: number } = {}
): CalibrationResult {
  const minClicks = opts.minClicks ?? MIN_CLICKS_DEFAULT;
  const worstLimit = opts.worstLimit ?? 5;
  const notes: string[] = [];

  const usable: Array<{
    offerId: string;
    name: string | null;
    planned: number;
    actual: number;
    ratio: number;
    spend: number;
    revenue: number;
  }> = [];

  for (const r of rows) {
    const clicks = num(r.clicks) ?? 0;
    if (clicks < minClicks) continue;
    const planned = num(r.plannedEpcUsd);
    const revenue = num(r.revenueUsd);
    if (planned == null || planned <= 0) continue;
    if (revenue == null || revenue <= 0) continue;
    const actual = revenue / clicks;
    if (!(actual > 0)) continue;
    usable.push({
      offerId: r.offerId ?? "unknown",
      name: r.offerName ?? null,
      planned,
      actual,
      ratio: planned / actual,
      spend: num(r.spendUsd) ?? 0,
      revenue,
    });
  }

  const samples = usable.length;
  let k: number | null = null;
  let biasPct: number | null = null;
  let overestimateRate: number | null = null;
  let lossRate: number | null = null;
  let totalSpendUsd = 0;
  let totalRevenueUsd = 0;
  let confidence: CalibrationConfidence = "insufficient";

  if (samples > 0) {
    k = median(usable.map((u) => u.ratio));
    if (k != null) biasPct = (k - 1) * 100;
    overestimateRate = usable.filter((u) => u.ratio > 1).length / samples;
    totalSpendUsd = usable.reduce((s, u) => s + u.spend, 0);
    totalRevenueUsd = usable.reduce((s, u) => s + u.revenue, 0);
    lossRate = usable.filter((u) => u.spend > u.revenue).length / samples;
    confidence =
      samples >= MIN_SAMPLES_OK
        ? "ok"
        : samples >= MIN_SAMPLES_WEAK
          ? "weak"
          : "insufficient";
  }

  if (samples === 0) {
    notes.push(
      `没有可用的复盘样本：需要投放归档同时具备「计划 EPC」和「收入/点击」，且点击 ≥ ${minClicks}`
    );
  } else if (confidence === "insufficient") {
    notes.push(`样本仅 ${samples} 条，k 不可信，仅供参考`);
  } else if (confidence === "weak") {
    notes.push(`样本 ${samples} 条，偏少，建议积累到 ${MIN_SAMPLES_OK} 条以上`);
  }

  if (k != null && k > 1.3) {
    notes.push(
      `系统性高估 ${biasPct!.toFixed(0)}%：下一批的假设 EPC 建议除以 ${k.toFixed(2)} 再用`
    );
  } else if (k != null && k < 0.77) {
    notes.push(
      `系统性低估 ${Math.abs(biasPct!).toFixed(0)}%：假设值偏保守，可适度上调，但仍建议保守`
    );
  }

  const worst: CalibrationOffender[] = [...usable]
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, worstLimit)
    .map((u) => ({
      offerId: u.offerId,
      name: u.name,
      ratio: Math.round(u.ratio * 1000) / 1000,
      plannedEpcUsd: Math.round(u.planned * 10000) / 10000,
      actualEpcUsd: Math.round(u.actual * 10000) / 10000,
    }));

  return {
    samples,
    k: k == null ? null : Math.round(k * 1000) / 1000,
    biasPct: biasPct == null ? null : Math.round(biasPct * 10) / 10,
    overestimateRate,
    lossRate,
    totalSpendUsd: Math.round(totalSpendUsd * 100) / 100,
    totalRevenueUsd: Math.round(totalRevenueUsd * 100) / 100,
    confidence,
    worst,
    notes,
  };
}
