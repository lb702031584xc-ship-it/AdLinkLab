/**
 * 商品级测试优先分（建 Offer 之前按"值不值得测"给商品排名）：
 * Offer 页的测试优先分（offer-priority.computeTestPriority）必须先有 Offer
 * 才算得出，用户要在建 Offer 之前就能从上往下挑商品建。本服务是同构的
 * 商品侧入口——公式不另写一份，直接复用 computeTestPriority 单点实现，
 * 保证两处算出的分严格同数值、可比；改公式只改 offer-priority 一处。
 *
 * 与 Offer 侧的输入差异（都在本文件内归一）：
 * - 初筛腿：商品的一键筛选结论 screenVerdict 取值 pass/review/kill
 *   （one-click-screen 写入，无记录 = null），映射到 Offer 侧语义值
 *   go/caution/stop 再计分（30/18/0），无记录 → 未筛 5。商品侧没有与
 *   Offer "unknown"（8 分）对应的 screenVerdict 值——review 本身就含
 *   "有未知标记转复核"的语义，按 caution 计。
 * - 广告腿：商品自身就是数据源（hasProductLink 恒 true），adCount /
 *   adCountLongtail / lastAdCount 直接取商品的品牌组现算字段，分档与
 *   趋势修正（长尾地板、疑似停投封顶、new/active 加分）都在
 *   computeTestPriority 内，与 Offer 侧逐字一致。
 * - 佣金腿：商品单笔佣金走 shared estimateCommissionFigure（金额优先，
 *   否则 价格×费率÷100，都无 → 未知），再进 computeTestPriority 的
 *   同一分档（≥50→30 / ≥25→24 / ≥8→16 / >0→8 / 未知→8 中性）。
 */
import { estimateCommissionFigure } from "@adlinklab/shared";
import {
  computeTestPriority,
  type TestPriority,
} from "./offer-priority.js";

export type { TestPriority };

/** 商品行算分所需字段（数值已归一为 number | null 的形态）。 */
export interface CatalogPriorityInput {
  screenVerdict?: string | null;
  price?: number | null;
  commissionAmount?: number | null;
  commissionRate?: number | null;
  adCount?: number | null;
  adCountLongtail?: number | null;
  tcAdvertisersCount?: number | null;
  lastAdCount?: number | null;
}

/**
 * 商品 screenVerdict → Offer 初筛语义值：
 * pass → go（30）；review → caution（18）；kill → stop（0）；
 * null / 未知值 → null（computeTestPriority 按"未做初筛"计 5）。
 */
export function catalogScreenVerdictToPrescreen(
  verdict: string | null | undefined
): string | null {
  switch ((verdict ?? "").trim()) {
    case "pass":
      return "go";
    case "review":
      return "caution";
    case "kill":
      return "stop";
    default:
      return null;
  }
}

/** Decimal / 字符串 / number 统一转有限数；转不出 → null（与 offer-priority 同款防御）。 */
function toFiniteNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n =
    typeof v === "number"
      ? v
      : Number(
          (v as { toNumber?: () => number }).toNumber
            ? (v as { toNumber: () => number }).toNumber()
            : v
        );
  return Number.isFinite(n) ? n : null;
}

/**
 * 从原始商品行（DB 行 / fake 行，字段可能是 Decimal）提取算分入参。
 * 路由的 serialize 与 priority 排序两条路径共用，保证口径只有一个源头。
 */
export function catalogPriorityInputFromRow(r: {
  screenVerdict?: unknown;
  price?: unknown;
  commissionAmount?: unknown;
  commissionRate?: unknown;
  adCount?: unknown;
  adCountLongtail?: unknown;
  tcAdvertisersCount?: unknown;
  lastAdCount?: unknown;
}): CatalogPriorityInput {
  return {
    screenVerdict:
      typeof r.screenVerdict === "string" ? r.screenVerdict : null,
    price: toFiniteNumberOrNull(r.price),
    commissionAmount: toFiniteNumberOrNull(r.commissionAmount),
    commissionRate: toFiniteNumberOrNull(r.commissionRate),
    adCount: toFiniteNumberOrNull(r.adCount),
    adCountLongtail: toFiniteNumberOrNull(r.adCountLongtail),
    tcAdvertisersCount: toFiniteNumberOrNull(r.tcAdvertisersCount),
    lastAdCount: toFiniteNumberOrNull(r.lastAdCount),
  };
}

/** 商品级测试优先分：与 Offer 侧 computeTestPriority 同构同数值。 */
export function computeCatalogTestPriority(
  input: CatalogPriorityInput
): TestPriority {
  const { figure } = estimateCommissionFigure({
    amount: input.commissionAmount ?? undefined,
    ratePct: input.commissionRate ?? undefined,
    price: input.price ?? undefined,
  });
  return computeTestPriority({
    prescreenVerdict: catalogScreenVerdictToPrescreen(input.screenVerdict),
    commissionPerSaleUsd: figure,
    adCount: input.adCount ?? null,
    adCountLongtail: input.adCountLongtail ?? null,
    tcAdvertisersCount: input.tcAdvertisersCount ?? null,
    lastAdCount: input.lastAdCount ?? null,
    // 商品自身即广告数据源：未计算时走"广告数未计算"中性 12（同 Offer 关联口径）。
    hasProductLink: true,
  });
}
