/**
 * 补强 #22 — CPA 诊断（纯函数）。
 *
 * 口径：
 * - CPA = CPC ÷ 转化率（转化率为小数，如 0.02 = 2%）。
 *   输入也可直接给 CPA，此时转化率由 CPC ÷ CPA 反推。
 * - 双期对比用对数分解（精确可加）：
 *     ln(CPA₂ / CPA₁) = ln(CPC₂ / CPC₁) − ln(CVR₂ / CVR₁)
 *   其中 ln(CPC₂/CPC₁) 是「CPC 变化贡献」，−ln(CVR₂/CVR₁) 是「转化率变化贡献」，
 *   两者之和恰好等于 CPA 的对数变化。份额 = 各贡献 ÷ 总对数变化。
 * - 结论三类：cpc_driven（点击变贵：查竞价/质量分）、
 *   cvr_driven（转化率驱动：查落地页/流量质量）、both（两者共同）。
 *   判定：驱动 CPA 变化的那一项贡献份额 ≥ 70% → 单驱动；否则两者共同。
 *   两项作用相反时，以绝对贡献较大的一项为驱动（其份额会 > 100% 或另一项为负）。
 * - 数据不足（任一期缺 CPC/转化率/CPA，或数值 ≤ 0）→ status=insufficient，
 *   不下结论（组件显示空状态说明）。
 */

export interface CpaPeriodInput {
  /** 平均 CPC（> 0）。 */
  cpc?: number | null;
  /** 转化率（小数，0–1，如 0.02 = 2%）。与 cpa 二选一，优先 conversionRate。 */
  conversionRate?: number | null;
  /** 已知 CPA 时可直接给；转化率由 cpc ÷ cpa 反推。 */
  cpa?: number | null;
}

export type CpaDriver = "cpc_driven" | "cvr_driven" | "both";

export interface CpaDiagnosisResult {
  status: "ok" | "insufficient";
  /** 上一期 CPA（status=ok 时非 null）。 */
  cpaPrev: number | null;
  /** 本期 CPA。 */
  cpaCurr: number | null;
  /** CPA 变化率（小数，如 0.25 = +25%）。 */
  cpaChangePct: number | null;
  /** CPC 变化的对数贡献 ln(CPC₂/CPC₁)。 */
  cpcContribution: number | null;
  /** 转化率变化的对数贡献 −ln(CVR₂/CVR₁)。 */
  cvrContribution: number | null;
  /** CPC 贡献份额（贡献 ÷ 总对数变化）；总变化为 0 时 null。 */
  cpcShare: number | null;
  /** 转化率贡献份额。 */
  cvrShare: number | null;
  driver: CpaDriver | null;
}

const INSUFFICIENT: CpaDiagnosisResult = {
  status: "insufficient",
  cpaPrev: null,
  cpaCurr: null,
  cpaChangePct: null,
  cpcContribution: null,
  cvrContribution: null,
  cpcShare: null,
  cvrShare: null,
  driver: null,
};

function positive(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** 解析一期的 CPA 与转化率；任一关键数值缺失/非法 → null。 */
function resolvePeriod(
  p: CpaPeriodInput | null | undefined,
): { cpa: number; cvr: number; cpc: number } | null {
  if (!p) return null;
  const cpc = positive(p.cpc);
  if (cpc == null) return null;
  const cvrDirect = positive(p.conversionRate);
  if (cvrDirect != null) {
    if (cvrDirect > 1) return null; // 转化率必须是小数值（0–1）
    return { cpc, cvr: cvrDirect, cpa: cpc / cvrDirect };
  }
  const cpa = positive(p.cpa);
  if (cpa == null) return null;
  return { cpc, cpa, cvr: cpc / cpa };
}

/** 单驱动判定的份额门槛。 */
export const CPA_DRIVER_SHARE_THRESHOLD = 0.7;

export function diagnoseCpaChange(
  prev: CpaPeriodInput | null | undefined,
  curr: CpaPeriodInput | null | undefined,
): CpaDiagnosisResult {
  const a = resolvePeriod(prev);
  const b = resolvePeriod(curr);
  if (!a || !b) return { ...INSUFFICIENT };

  const cpcContribution = Math.log(b.cpc / a.cpc);
  const cvrContribution = -Math.log(b.cvr / a.cvr);
  const total = cpcContribution + cvrContribution; // = ln(CPA₂/CPA₁)

  let cpcShare: number | null = null;
  let cvrShare: number | null = null;
  let driver: CpaDriver = "both";
  if (Math.abs(total) < 1e-12) {
    // CPA 基本没变：无驱动可言，按两者共同（无变化）处理，份额不可分。
    driver = "both";
  } else {
    cpcShare = cpcContribution / total;
    cvrShare = cvrContribution / total;
    // 同向时份额在 0–1 间；反向时驱动项份额 > 1。用「与总变化同号且份额 ≥ 70%」判单驱动。
    if (cpcShare >= CPA_DRIVER_SHARE_THRESHOLD) driver = "cpc_driven";
    else if (cvrShare >= CPA_DRIVER_SHARE_THRESHOLD) driver = "cvr_driven";
    else driver = "both";
  }

  return {
    status: "ok",
    cpaPrev: a.cpa,
    cpaCurr: b.cpa,
    cpaChangePct: b.cpa / a.cpa - 1,
    cpcContribution,
    cvrContribution,
    cpcShare,
    cvrShare,
    driver,
  };
}

export const CPA_DRIVER_LABELS: Record<CpaDriver, { zh: string; en: string }> = {
  cpc_driven: {
    zh: "CPC 驱动：点击变贵是 CPA 变化的主因 — 查竞价竞争与质量分。",
    en: "CPC-driven: pricier clicks are the main cause — check auction competition and Quality Score.",
  },
  cvr_driven: {
    zh: "转化率驱动：转化率变化是 CPA 变化的主因 — 查落地页与流量质量。",
    en: "Conversion-rate-driven: CVR change is the main cause — check the landing page and traffic quality.",
  },
  both: {
    zh: "两者共同：CPC 与转化率都在推高/拉低 CPA — 两边都要查。",
    en: "Both: CPC and conversion rate both moved CPA — investigate both sides.",
  },
};

export const CPA_INSUFFICIENT_TEXT = {
  zh: "需要两个周期的 CPC 与转化率数据才能诊断",
  en: "CPA diagnosis needs CPC and conversion-rate data from two periods",
} as const;
