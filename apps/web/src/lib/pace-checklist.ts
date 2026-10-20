/**
 * P1-5：测试节奏清单（纯函数；P2-9 每日预警复用同一份规则源，不另立口径）。
 *
 * 输入是档案/监控行摘要，输出建议列表。只做展示建议，绝不自动执行
 * （不停投、不改出价、不删广告——执行永远由人确认）。
 * 每条建议都标注来源：教学视频讲师经验，非平台官方标准；请以实测数据为准。
 */

export const PACE_SOURCE =
  "来源：教学视频讲师经验，非平台官方标准；请以你的实测数据为准";

/** 金额型止损的来源标注：与讲师经验口径分开，这是本站风控硬规则。 */
export const PACE_STOP_LOSS_SOURCE =
  "来源：本站风控硬规则（金额型止损），非讲师经验；请以你的实测数据为准";

/** 金额型止损线：累计花费达到 payout 的该倍数且仍 0 转化 → 建议立即暂停。 */
export const STOP_LOSS_PAYOUT_MULTIPLE = 2.5;

export interface PaceInput {
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  spend: number | null;
  revenue: number | null;
  /** 单次转化佣金（LaunchArchive.payout）；未知时不触发金额型止损（不编基准）。 */
  payout?: number | null;
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
  const payout =
    input.payout != null && Number.isFinite(input.payout) ? input.payout : null;
  const spend = num(input.spend);
  const revenueAmt = num(input.revenue);
  if (
    payout != null &&
    payout > 0 &&
    conversions === 0 &&
    revenueAmt === 0 &&
    spend >= STOP_LOSS_PAYOUT_MULTIPLE * payout
  ) {
    out.push({
      level: "action",
      text: `已花费 $${spend.toFixed(2)}（约 ${(spend / payout).toFixed(1)} 倍 payout $${payout.toFixed(2)}）仍 0 转化，建议立即暂停止损。`,
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
