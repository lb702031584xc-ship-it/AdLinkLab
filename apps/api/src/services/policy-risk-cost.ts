/**
 * 政策风险成本栏（riskCost）共享实现（2026-10-25，清单 #7 松绑口径）。
 *
 * 唯一来源：OfferPolicy.rules（Record<规则名, ALLOWED|FORBIDDEN|REQUIRED|UNKNOWN>）。
 * 只取 FORBIDDEN 的三项，其余规则（ALLOWED / UNKNOWN / REQUIRED / 未知规则名）
 * 一律不进本栏位。映射与 Offer 一键初筛上线时的内联实现一字一致，
 * Offer 侧与商品库列表侧共用本函数，绝不另写副本。
 *
 * 映射：
 * - PPC 或 SEARCH_ADS 为 FORBIDDEN →「禁付费搜索（SEM）」（二者任一即一条，不重复）；
 * - BRAND_BIDDING 为 FORBIDDEN →「禁品牌词竞价」；
 * - DIRECT_LINK 为 FORBIDDEN →「禁直链」。
 *
 * 本栏位只展示、不参与任何 verdict / recommended 判定、不排除。
 * 商品库列表侧挂接的是商家级证据（该商家各 Offer 的最新政策快照），
 * 不是商品级条款——调用方须在注释与字段说明里写明这一点，绝不写成商品级断言。
 */
export function riskCostFromPolicyRules(rules: unknown): string[] {
  const r = (rules ?? {}) as Record<string, unknown>;
  const cost: string[] = [];
  if (r.PPC === "FORBIDDEN" || r.SEARCH_ADS === "FORBIDDEN")
    cost.push("禁付费搜索（SEM）");
  if (r.BRAND_BIDDING === "FORBIDDEN") cost.push("禁品牌词竞价");
  if (r.DIRECT_LINK === "FORBIDDEN") cost.push("禁直链");
  return cost;
}
