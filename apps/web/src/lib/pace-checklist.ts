/**
 * P1-5：测试节奏清单（纯函数；P2-9 每日预警复用同一份规则源，不另立口径）。
 *
 * 输入是档案/监控行摘要，输出建议列表。只做展示建议，绝不自动执行
 * （不停投、不改出价、不删广告——执行永远由人确认）。
 * 每条建议都标注来源：教学视频讲师经验，非平台官方标准；请以实测数据为准。
 */

import { stopLossMultiplierForFlow } from "./arb-coach-verdict";

export const PACE_SOURCE =
  "来源：教学视频讲师经验，非平台官方标准；请以你的实测数据为准";

/** 金额型止损的来源标注：与讲师经验口径分开，这是本站风控硬规则。 */
export const PACE_STOP_LOSS_SOURCE =
  "来源：本站风控硬规则（金额型止损），非讲师经验；请以你的实测数据为准";

/** 金额型止损线：累计花费达到 payout 的该倍数且仍 0 转化 → 建议立即暂停。 */
export const STOP_LOSS_PAYOUT_MULTIPLE = 2.5;

/**
 * 补强 #20/#9：金额型止损倍数按转化流深度取 — 单一口径源是分析组
 * arb-coach-verdict.ts 的 stopLossMultiplierForFlow（浅层 soi_simple /
 * one_click 2.5、深层 cc_submit / ftd 4、其余已知流含 pin_submit 3、
 * 未知 2.5）。此处 re-export 供 pace/daily-alerts 引用，避免两份数值漂移。
 */
export { stopLossMultiplierForFlow };

// ---------------------------------------------------------------------------
// 补强 #20：ROI / 转化率统一口径（周报 weekly-report-service.ts 同口径实现）
// - 转化率 = 联盟有效唯一订单数 ÷ 广告总点击（不用 Ads 后台转化率冒充）。
// - 有效唯一订单：同一订单下单 + 退货先按 orderId 合并净值，净值 > 0 才计 1 单。
// - ROI 比值 = 收入 ÷ 花费（投 1 产出 X 的 X）；判定门槛：点击 < 100 不给判定。
// - ROI < 1 亏损（红）、≥ 2 盈利（绿）、中间中性。
// ---------------------------------------------------------------------------

/** ROI 给判定所需的最小样本点击数。 */
export const ROI_MIN_CLICKS = 100;

export type RoiStatus = "insufficient" | "loss" | "neutral" | "profitable";

export const ROI_STATUS_LABELS: Record<RoiStatus, string> = {
  insufficient: "样本不足（点击 < 100 或缺花费/收入），不判定",
  loss: "亏损（ROI < 1）",
  neutral: "中性（1 ≤ ROI < 2）",
  profitable: "盈利（ROI ≥ 2）",
};

/** ROI 展示颜色口径：loss 红、profitable 绿、其余中性。 */
export const ROI_STATUS_TONES: Record<RoiStatus, "red" | "green" | "neutral"> = {
  insufficient: "neutral",
  loss: "red",
  neutral: "neutral",
  profitable: "green",
};

/** 收入 ÷ 花费；花费缺失/为 0 或收入缺失 → null（不编造）。 */
export function roiRatioOf(
  revenue: number | null | undefined,
  spend: number | null | undefined,
): number | null {
  if (revenue == null || spend == null) return null;
  if (!Number.isFinite(revenue) || !Number.isFinite(spend) || spend <= 0) {
    return null;
  }
  return revenue / spend;
}

/** ROI 状态判定：样本点击 ≥ 100 才给判定。 */
export function roiStatusFor(
  clicks: number | null | undefined,
  roiRatio: number | null | undefined,
): RoiStatus {
  if (clicks == null || !Number.isFinite(clicks) || clicks < ROI_MIN_CLICKS) {
    return "insufficient";
  }
  if (roiRatio == null || !Number.isFinite(roiRatio)) return "insufficient";
  if (roiRatio < 1) return "loss";
  if (roiRatio >= 2) return "profitable";
  return "neutral";
}

export interface OrderLike {
  orderId?: string | null;
  value?: number | null;
  status?: string | null;
}

/**
 * 联盟有效唯一订单数：按 orderId 分组，先合并净值再计数。
 * 退货/取消行（status REFUNDED / CANCELLED / RETURNED 且金额为正）按负值合并；
 * 净值 > 0 的订单计 1。无 orderId 的行各自独立成单（无法合并时不臆测合并）。
 */
export function netValidOrderCount(orders: readonly OrderLike[]): number {
  const net = new Map<string, number>();
  orders.forEach((o, i) => {
    const key = o.orderId ?? `__row_${i}`;
    const raw = o.value != null && Number.isFinite(o.value) ? o.value : 0;
    const st = (o.status ?? "").trim().toUpperCase();
    const signed =
      (st === "REFUNDED" || st === "CANCELLED" || st === "RETURNED") &&
      raw > 0
        ? -raw
        : raw;
    net.set(key, (net.get(key) ?? 0) + signed);
  });
  let count = 0;
  for (const v of net.values()) {
    if (v > 1e-9) count += 1;
  }
  return count;
}

/** 转化率 = 有效唯一订单数 ÷ 广告总点击；点击为 0/未知 → null。 */
export function affiliateConversionRate(
  validOrders: number | null | undefined,
  clicks: number | null | undefined,
): number | null {
  if (validOrders == null || clicks == null) return null;
  if (!Number.isFinite(validOrders) || !Number.isFinite(clicks) || clicks <= 0) {
    return null;
  }
  return validOrders / clicks;
}

export interface PaceInput {
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  spend: number | null;
  revenue: number | null;
  /** 单次转化佣金（LaunchArchive.payout）；未知时不触发金额型止损（不编基准）。 */
  payout?: number | null;
  /**
   * 补强 #20/#9：offer 转化流（Offer.conversionFlow）；有值时金额型止损倍数
   * 按 stopLossMultiplierForFlow 取，拿不到则维持默认 2.5。
   */
  conversionFlow?: string | null;
  /** 自投放开始的天数（launchedAt/createdAt 换算；未知时 null = 不出时间相关建议）。 */
  daysActive: number | null;
}

export interface PaceSuggestion {
  /** info = 观察提示；warn = 需要关注；action = 建议采取动作（仍需人工确认）。 */
  level: "info" | "warn" | "action";
  text: string;
  source: string;
}

const num = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : v);

/**
 * 测试节奏建议（规则与视频教学一致）：
 * - 2–3 天无展示/无点击 → CPC +10%~20%，再观察 2 天
 * - 4–5 天有点击无转化 → 再观察 2 天，仍无转化建议停止
 * - 3 天无点击数据 → 建议删除/重新发布
 * - 满 1 周有数据 → 盈利保持、亏损削减/停止；扩量 = 上新系列、预算不变
 * - 品牌词首日有点击通常当天转化（观察提示）
 * 金额型止损（本站风控硬规则，不依赖天数）：
 * - payout 已知且花费 ≥ 2.5 倍 payout、0 转化、0 收入 → 建议立即暂停止损
 */
export function paceChecklist(input: PaceInput): PaceSuggestion[] {
  const out: PaceSuggestion[] = [];
  const impressions = num(input.impressions);
  const clicks = num(input.clicks);
  const conversions = num(input.conversions);
  const profit =
    input.spend != null && input.revenue != null ? input.revenue - input.spend : null;
  const days = input.daysActive;

  // 金额型止损（硬规则，放在时间规则之外：不依赖天数，payout 未知不触发）。
  // 倍数按 conversionFlow 取（拿不到 flow 时 helper 返回默认 2.5，与旧口径一致）。
  const payout =
    input.payout != null && Number.isFinite(input.payout) ? input.payout : null;
  const spend = num(input.spend);
  const revenueAmt = num(input.revenue);
  const stopLossMultiple = stopLossMultiplierForFlow(input.conversionFlow);
  if (
    payout != null &&
    payout > 0 &&
    conversions === 0 &&
    revenueAmt === 0 &&
    spend >= stopLossMultiple * payout
  ) {
    out.push({
      level: "action",
      text: `已花费 $${spend.toFixed(2)}（约 ${(spend / payout).toFixed(1)} 倍 payout $${payout.toFixed(2)}，止损线 ${stopLossMultiple.toFixed(1)} 倍）仍 0 转化，建议立即暂停止损。`,
      source: PACE_STOP_LOSS_SOURCE,
    });
  }

  // 补强 #20：ROI 状态（统一口径；点击 ≥ 100 且花费/收入齐全才给判定）。
  const roiRatio = roiRatioOf(input.revenue, input.spend);
  const roiStatus = roiStatusFor(clicks, roiRatio);
  if (roiStatus === "loss" && roiRatio != null) {
    out.push({
      level: "warn",
      text: `ROI ${roiRatio.toFixed(2)} < 1（亏损）：收入不及花费，建议削减预算或停止，先复核落地页与 Offer 转化。`,
      source: PACE_STOP_LOSS_SOURCE,
    });
  } else if (roiStatus === "profitable" && roiRatio != null) {
    out.push({
      level: "info",
      text: `ROI ${roiRatio.toFixed(2)} ≥ 2（盈利）：样本点击 ≥ ${ROI_MIN_CLICKS}，可保持并评估扩量。`,
      source: PACE_STOP_LOSS_SOURCE,
    });
  } else if (roiStatus === "neutral" && roiRatio != null) {
    out.push({
      level: "info",
      text: `ROI ${roiRatio.toFixed(2)}（1–2 之间，中性）：样本点击 ≥ ${ROI_MIN_CLICKS}，继续观察转化稳定性。`,
      source: PACE_STOP_LOSS_SOURCE,
    });
  }

  if (days != null) {
    // 2–3 天无展示/无点击 → CPC +10%~20%，再观察 2 天。
    if (days >= 2 && days <= 3 && impressions === 0 && clicks === 0) {
      out.push({
        level: "action",
        text: "已跑 2–3 天仍无展示/点击：可考虑出价 CPC +10%~20%，再观察 2 天。",
        source: PACE_SOURCE,
      });
    }
    // 超过 3 天仍无展示 → 检查审核/关键词/出价（比单纯加价更进一步）。
    if (days > 3 && impressions === 0) {
      out.push({
        level: "warn",
        text: "超过 3 天仍无展示：检查广告审核状态、关键词与出价是否过低。",
        source: PACE_SOURCE,
      });
    }
    // 3 天无点击数据 → 建议删除/重新发布。
    if (days >= 3 && impressions > 0 && clicks === 0) {
      out.push({
        level: "action",
        text: "已跑 3 天有展示但无点击数据：建议删除/重新发布（先检查关键词与出价）。",
        source: PACE_SOURCE,
      });
    }
    // 4–5 天有点击无转化 → 再观察 2 天，仍无转化建议停止。
    if (days >= 4 && days <= 5 && clicks > 0 && conversions === 0) {
      out.push({
        level: "warn",
        text: "有点击无转化已 4–5 天：再观察 2 天，仍无转化建议停止。",
        source: PACE_SOURCE,
      });
    }
    // 满 1 周有数据 → 盈利保持 / 亏损削减。
    if (days >= 7 && profit != null) {
      if (profit > 0) {
        out.push({
          level: "info",
          text: "已跑满 1 周且盈利：可保持；如需扩量请上新广告系列、预算不变、上到新/不同 ADS。",
          source: PACE_SOURCE,
        });
      } else if (profit < 0) {
        out.push({
          level: "action",
          text: "已跑满 1 周仍亏损：建议削减预算或停止，先复核落地页与 Offer 转化。",
          source: PACE_SOURCE,
        });
      }
    }
    // 品牌词首日有点击通常当天转化（观察提示，非判定）。
    if (days <= 1 && clicks > 0) {
      out.push({
        level: "info",
        text: "品牌词首日有点击通常当天转化（观察提示）：首日无转化先观察，不必立即停投。",
        source: PACE_SOURCE,
      });
    }
  }
  return out;
}

/** 由 launchedAt/createdAt ISO 字符串换算已跑天数（不足 1 天计 1 天；无效 → null）。 */
export function daysActiveSince(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(1, Math.ceil((nowMs - t) / 86_400_000));
}
