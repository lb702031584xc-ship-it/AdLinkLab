/**
 * 类目 CPC 基线与探针（2026-10-28，纯函数）。
 *
 * 问题：商品库挑选器要用「类目 CPC」判断"佣金够不够付点击"，但新品类
 * 没有历史投放数据，算不出来。
 *
 * 两个办法，本模块都实现：
 *   A. 降级取基线：精确类目 → 大类 → 全站 → 假定值，逐级退让并标明来源。
 *   B. 探针计划：实在没有基线时，先花小预算跑几天把 CPC 测出来再回填。
 *
 * 纪律：来源必须显式返回（exact/broad/global/assumed），
 * 让调用方知道这个数是实测的还是退让出来的；样本不足时 confidence 降级。
 */
export interface CpcSample {
  category: string | null;
  cpcUsd: number;
  /** 点击量：用于加权。缺省按 1 计。 */
  clicks?: number | null;
}

export type CpcBaselineSource = "exact" | "broad" | "global" | "assumed";
export type CpcConfidence = "high" | "medium" | "low";

export interface CpcBaselineResult {
  cpcUsd: number;
  source: CpcBaselineSource;
  /** 参与计算的样本条数。 */
  samples: number;
  confidence: CpcConfidence;
  note: string;
}

export interface ResolveCpcOptions {
  /** 目标类目（如 "chamber vacuum sealer"）。 */
  category?: string | null;
  /** 大类（如 "home appliance"）：精确类目样本不足时退到这里。 */
  broadCategory?: string | null;
  /** 连全站都没有时用这个假定值（美元/点击）。 */
  assumedCpcUsd?: number | null;
  /** 每组至少多少条样本才算可用。默认 3。 */
  minSamples?: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function weightedMedian(samples: CpcSample[]): number | null {
  const rows = samples
    .map((s) => {
      const cpc = num(s.cpcUsd);
      if (cpc == null || cpc <= 0) return null;
      return { cpc, w: Math.max(1, num(s.clicks) ?? 1) };
    })
    .filter((x): x is { cpc: number; w: number } => x !== null)
    .sort((a, b) => a.cpc - b.cpc);
  if (rows.length === 0) return null;
  const totalW = rows.reduce((s, r) => s + r.w, 0);
  let acc = 0;
  for (const r of rows) {
    acc += r.w;
    if (acc >= totalW / 2) return r.cpc;
  }
  return rows[rows.length - 1].cpc;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function resolveCpcBaseline(
  samples: CpcSample[],
  opts: ResolveCpcOptions = {}
): CpcBaselineResult {
  const minSamples = Math.max(1, Math.floor(opts.minSamples ?? 3));
  const category = norm(opts.category);
  const broad = norm(opts.broadCategory);

  const exactRows = category
    ? samples.filter((s) => norm(s.category) === category)
    : [];
  const broadRows = broad
    ? samples.filter((s) => norm(s.category) === broad)
    : [];

  if (exactRows.length >= minSamples) {
    const cpc = weightedMedian(exactRows)!;
    return {
      cpcUsd: Math.round(cpc * 10000) / 10000,
      source: "exact",
      samples: exactRows.length,
      confidence: exactRows.length >= 10 ? "high" : "medium",
      note: `取自该类目的 ${exactRows.length} 条历史投放（按点击加权中位数）`,
    };
  }

  if (broadRows.length >= minSamples) {
    const cpc = weightedMedian(broadRows)!;
    return {
      cpcUsd: Math.round(cpc * 10000) / 10000,
      source: "broad",
      samples: broadRows.length,
      confidence: "medium",
      note: `该类目样本不足，退用大类的 ${broadRows.length} 条历史投放`,
    };
  }

  if (samples.length >= minSamples) {
    const cpc = weightedMedian(samples)!;
    return {
      cpcUsd: Math.round(cpc * 10000) / 10000,
      source: "global",
      samples: samples.length,
      confidence: "low",
      note: `精确类目与大类都样本不足，退用全站 ${samples.length} 条——跨品类误差较大`,
    };
  }

  const assumed = num(opts.assumedCpcUsd);
  if (assumed != null && assumed > 0) {
    return {
      cpcUsd: Math.round(assumed * 10000) / 10000,
      source: "assumed",
      samples: 0,
      confidence: "low",
      note: "没有历史投放数据，使用假定值；建议先跑探针校准",
    };
  }

  return {
    cpcUsd: 0,
    source: "assumed",
    samples: 0,
    confidence: "low",
    note: "没有任何 CPC 依据：先跑一次探针，或手动填入预期 CPC",
  };
}

/* ───────────────────────── B. 探针计划 ───────────────────────── */

export interface CpcProbeInput {
  /** 假定 CPC（美元/点击）；用基线值即可。 */
  assumedCpcUsd: number;
  /** 目标点击量（默认 100）：够看出 CPC 区间与初步 CTR。 */
  targetClicks?: number;
  /** 投放天数（默认 3）：太短测不准，太长浪费钱。 */
  days?: number;
}

export interface CpcProbePlan {
  days: number;
  targetClicks: number;
  dailyBudgetUsd: number;
  totalBudgetUsd: number;
  note: string;
}

/**
 * 按类目 CPC 反推「最低单笔佣金」。
 *
 * 新手不该手填这个数：他既不知道类目 CPC，也不知道该留多少余量。
 * 反过来算只有一条公式——
 *   保本 CPC = 佣金 × (1−拒单) × (1−退款) × 目标CVR
 *   佣金门槛 = 类目 CPC ÷ 同样那组系数
 * 得出的正好是「在这个类目里打得平的最低佣金」。
 */
export function deriveMinCommissionAmount(input: {
  categoryCpcUsd: number;
  targetCvrPct?: number;
  rejectionRate?: number;
  refundRate?: number;
}): number {
  const cpc = Math.max(0, num(input.categoryCpcUsd) ?? 0);
  const cvr = Math.min(100, Math.max(0.1, input.targetCvrPct ?? 2.5));
  const rej = Math.min(1, Math.max(0, input.rejectionRate ?? 0.15));
  const refund = Math.min(1, Math.max(0, input.refundRate ?? 0.05));
  const keep = (1 - rej) * (1 - refund) * (cvr / 100);
  if (cpc <= 0 || keep <= 0) return 0;
  return Math.ceil((cpc / keep) * 100) / 100;
}

export function planCpcProbe(input: CpcProbeInput): CpcProbePlan {
  const cpc = Math.max(0.01, num(input.assumedCpcUsd) ?? 0.01);
  const targetClicks = Math.max(20, Math.floor(input.targetClicks ?? 100));
  const days = Math.max(1, Math.floor(input.days ?? 3));
  const total = cpc * targetClicks;
  const daily = total / days;
  return {
    days,
    targetClicks,
    dailyBudgetUsd: Math.round(daily * 100) / 100,
    totalBudgetUsd: Math.round(total * 100) / 100,
    note: `用约 $${(Math.round(daily * 100) / 100).toFixed(2)}/天跑 ${days} 天拿到 ${targetClicks} 次点击，再把实测 CPC 回填成类目基线`,
  };
}
