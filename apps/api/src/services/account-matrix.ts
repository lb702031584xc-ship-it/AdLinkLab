/**
 * 账号矩阵（清单 #4）纯业务逻辑：不碰 Fastify、不碰 Prisma，
 * 只做可单测的计算与校验，供 routes/account-matrix.ts 调用。
 *
 * 硬线（schema 注释同款，代码层面同样遵守）：
 * - accountLabel 只是自由文本标签，绝不存任何账号凭证。
 * - 这里不实现补点击、买号冒用、规避检测的多账号分散、
 *   规避检测的 IP/UA/指纹轮换、批量起号绕过封禁。
 *   本模块只管理用户合法持有的账号组合的台账与预算口径。
 */

export const SLOT_STATUSES = ["EMPTY", "ACTIVE", "PAUSED", "BANNED"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const OPERATION_TYPES = [
  "DIRECT_LINK",
  "BRAND_KEYWORD",
  "OTHER",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/** 起手模板槽位数。 */
export const TEMPLATE_SLOT_COUNT = 10;

/** 接近提现线的阈值：余额 + 待结 >= 该值即提醒（提现线本身为 $200）。 */
export const WITHDRAW_ALERT_THRESHOLD_USD = 180;
/** 提现线（美元）。withdrawAlerts 的 excessOverPayoutLineUsd 以此为基准。 */
export const PAYOUT_LINE_USD = 200;

export function isSlotStatus(v: unknown): v is SlotStatus {
  return (
    typeof v === "string" &&
    (SLOT_STATUSES as readonly string[]).includes(v)
  );
}

export function isOperationType(v: unknown): v is OperationType {
  return (
    typeof v === "string" &&
    (OPERATION_TYPES as readonly string[]).includes(v)
  );
}

/**
 * Prisma Decimal / 数字 / 数字字符串统一转 number。
 * Decimal 实例自带 toNumber()；Number() 对 Decimal.js 同款对象同样可用，
 * 这里优先 toNumber，兜底 Number()，非法值返回 NaN 由调用方校验。
 */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  if (v !== null && typeof v === "object") {
    const maybe = v as { toNumber?: unknown };
    if (typeof maybe.toNumber === "function") {
      return (maybe.toNumber as () => number)();
    }
  }
  return Number(v);
}

/** 模板标签：`${labelPrefix}-01` … `${labelPrefix}-10`。 */
export function buildTemplateLabels(labelPrefix: string): string[] {
  return Array.from(
    { length: TEMPLATE_SLOT_COUNT },
    (_, i) => `${labelPrefix}-${String(i + 1).padStart(2, "0")}`
  );
}

export interface SlotLike {
  id: string;
  slotIndex: number;
  accountLabel: string;
  network: string;
  offerId: string | null;
  status: string;
  balanceUsd: unknown;
  pendingUsd: unknown;
  investedUsd: unknown;
  earnedUsd: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  offer?: { id: string; name: string } | null;
}

export function serializeSlot(row: SlotLike): Record<string, unknown> {
  return {
    id: row.id,
    slotIndex: row.slotIndex,
    accountLabel: row.accountLabel,
    network: row.network,
    offerId: row.offerId,
    status: row.status,
    balanceUsd: toNumber(row.balanceUsd),
    pendingUsd: toNumber(row.pendingUsd),
    investedUsd: toNumber(row.investedUsd),
    earnedUsd: toNumber(row.earnedUsd),
    offer: row.offer ? { id: row.offer.id, name: row.offer.name } : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 1 号 1 offer 校验（警告不拦截）：
 * - 若本租户另一 ACTIVE 槽位已挂同一 offerId → 冲突警告；
 * - 若本槽位已有其他 offerId 且状态 ACTIVE → 覆盖警告。
 * 两种情况可同时出现，warnings 全部返回，由调用方如实透传给前端。
 */
export function buildAssignWarnings(
  slot: SlotLike,
  allTenantSlots: SlotLike[],
  offerId: string
): string[] {
  const warnings: string[] = [];
  const clash = allTenantSlots.find(
    (s) => s.id !== slot.id && s.status === "ACTIVE" && s.offerId === offerId
  );
  if (clash) {
    warnings.push(
      `Offer ${offerId} is already assigned to another ACTIVE slot ` +
        `(${clash.accountLabel}, slot ${clash.slotIndex}); ` +
        `one offer on multiple live slots splits attribution and ` +
        `raises the ban blast radius — proceed only deliberately.`
    );
  }
  if (
    slot.status === "ACTIVE" &&
    slot.offerId !== null &&
    slot.offerId !== offerId
  ) {
    warnings.push(
      `Slot ${slot.accountLabel} (slot ${slot.slotIndex}) is ACTIVE with a ` +
        `different offer (${slot.offerId}); assigning ${offerId} replaces it.`
    );
  }
  return warnings;
}

export interface WithdrawAlert {
  slotId: string;
  slotIndex: number;
  accountLabel: string;
  network: string;
  amountUsd: number;
  /** 超出 $200 提现线的金额；180–200 区间为负数，表示“距提现线还差多少”。 */
  excessOverPayoutLineUsd: number;
}

/**
 * 余额 + 待结 >= $180 的槽位（接近 $200 提现线，需及时提现防封号没收）。
 * BANNED 槽位排除：其资金已被没收，无法再提现，报警无行动意义。
 */
export function computeWithdrawAlerts(slots: SlotLike[]): WithdrawAlert[] {
  return slots
    .filter((s) => s.status !== "BANNED")
    .map((s) => {
      const amountUsd = toNumber(s.balanceUsd) + toNumber(s.pendingUsd);
      return {
        slotId: s.id,
        slotIndex: s.slotIndex,
        accountLabel: s.accountLabel,
        network: s.network,
        amountUsd,
        excessOverPayoutLineUsd: amountUsd - PAYOUT_LINE_USD,
      };
    })
    .filter((a) => a.amountUsd >= WITHDRAW_ALERT_THRESHOLD_USD);
}

export interface PortfolioInput {
  /** 预期存活槽位数（默认 2）。 */
  expectedSurvivors: number;
  /** 单槽位佣金（美元，可选；缺省则预算上限为 null）。 */
  perSlotCommissionUsd: number | null;
}

export interface PortfolioView {
  totalInvested: number;
  totalEarned: number;
  liveSlots: number;
  bannedSlots: number;
  totalAtRisk: number;
  withdrawAlerts: WithdrawAlert[];
  portfolioRoi: number | null;
  expectedSurvivors: number;
  perSlotCommissionUsd: number | null;
  totalBudgetCap: number | null;
  perSlotBudget: number | null;
}

/**
 * 组合视图。
 *
 * 组合预算公式（注释即口径）：
 *   总投入 ≤ 存活数 × 单号佣金
 *   totalBudgetCap = expectedSurvivors × perSlotCommissionUsd
 *   perSlotBudget  = totalBudgetCap / 10
 * 其中分母 10 = 起手模板槽位数（TEMPLATE_SLOT_COUNT）：预算按 10 槽位
 * 摊薄，单槽位预算 = 总上限 / 10。缺 perSlotCommissionUsd 时两项均为 null
 * （不是 0——0 会被误读为“不许花钱”）。
 */
export function computePortfolio(
  slots: SlotLike[],
  input: PortfolioInput
): PortfolioView {
  let totalInvested = 0;
  let totalEarned = 0;
  let liveSlots = 0;
  let bannedSlots = 0;
  let totalAtRisk = 0;
  for (const s of slots) {
    totalInvested += toNumber(s.investedUsd);
    totalEarned += toNumber(s.earnedUsd);
    if (s.status === "ACTIVE") liveSlots += 1;
    if (s.status === "BANNED") bannedSlots += 1;
    if (s.status === "ACTIVE") {
      totalAtRisk += toNumber(s.balanceUsd) + toNumber(s.pendingUsd);
    }
  }
  const totalBudgetCap =
    input.perSlotCommissionUsd === null
      ? null
      : input.expectedSurvivors * input.perSlotCommissionUsd;
  return {
    totalInvested,
    totalEarned,
    liveSlots,
    bannedSlots,
    totalAtRisk,
    withdrawAlerts: computeWithdrawAlerts(slots),
    portfolioRoi:
      totalInvested > 0 ? (totalEarned - totalInvested) / totalInvested : null,
    expectedSurvivors: input.expectedSurvivors,
    perSlotCommissionUsd: input.perSlotCommissionUsd,
    totalBudgetCap,
    perSlotBudget: totalBudgetCap === null ? null : totalBudgetCap / 10,
  };
}
