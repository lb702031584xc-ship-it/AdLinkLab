/**
 * 清单 #1 — 成本账：风控从"门禁"改成"成本账"。
 *
 * 一条操作（直链 / 品牌词 / 其他）不再被"放行 / 拦截"二值判定，
 * 而是算一笔账：沉没成本 × 封号概率 = 预期损失，再与预期利润比较。
 *
 * - 封号概率：本租户 RiskParam 表（网络 × 操作类型）有覆盖值时优先
 *   用覆盖值，否则用下面的代码默认值。
 * - 直链、品牌词的风险档统一记为 "high-reward-high-risk"（高收益高
 *   风险）：只算成本、不作定性、不拦截任何操作。
 * - 本文件不读、不写任何凭证类字段；RiskParam 只存概率数字。
 */

export type CostLedgerOperationType = "DIRECT_LINK" | "BRAND_KEYWORD" | "OTHER";

export type BanProbabilitySource = "override" | "default";

/** 直链 / 品牌词统一档位；其他操作走标准档。 */
export type CostLedgerRiskTier = "high-reward-high-risk" | "standard";

/** 封号概率代码默认值（按网络×操作类型可配；见 RiskParam 覆盖）。 */
export const DEFAULT_BAN_PROBABILITY: Record<CostLedgerOperationType, number> = {
  DIRECT_LINK: 0.15,
  BRAND_KEYWORD: 0.25,
  OTHER: 0.1,
};

/**
 * 操作类型归一化：只认 DIRECT_LINK / BRAND_KEYWORD 两个显式档，
 * 其余一切（含缺失、未知字符串）归入 OTHER——覆盖值与默认值都按
 * 归一化后的键查找，保证同一操作在读、写两端命中同一条覆盖。
 */
export function normalizeOperationType(value: unknown): CostLedgerOperationType {
  const s = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (s === "DIRECT_LINK") return "DIRECT_LINK";
  if (s === "BRAND_KEYWORD") return "BRAND_KEYWORD";
  return "OTHER";
}

/** 直链、品牌词统一为高收益高风险档；其他操作为标准档。 */
export function riskTierForOperationType(
  operationType: CostLedgerOperationType
): CostLedgerRiskTier {
  return operationType === "DIRECT_LINK" ||
    operationType === "BRAND_KEYWORD"
    ? "high-reward-high-risk"
    : "standard";
}

export interface RiskParamRow {
  network: string;
  operationType: string;
  banProbability: number;
}

/**
 * RiskParam 数据委托的最小结构。注意：仓库 schema 已有 RiskParam
 * 模型，但本地生成的 Prisma client 可能尚未重新生成（无 riskParam
 * 委托）——路由层以结构类型访问，缺委托时读路径退回默认值、
 * 写路径明确报错，绝不静默丢写。
 */
export interface RiskParamStore {
  findUnique(args: {
    where: {
      tenantId_network_operationType: {
        tenantId: string;
        network: string;
        operationType: string;
      };
    };
  }): Promise<{ banProbability: unknown } | null>;
  findMany(args: {
    where: { tenantId: string };
    orderBy?: Record<string, "asc" | "desc">;
  }): Promise<RiskParamRow[]>;
  upsert(args: {
    where: {
      tenantId_network_operationType: {
        tenantId: string;
        network: string;
        operationType: string;
      };
    };
    create: {
      id: string;
      tenantId: string;
      network: string;
      operationType: string;
      banProbability: number;
    };
    update: { banProbability: number };
  }): Promise<RiskParamRow>;
}

function isProbability(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1
  );
}

/**
 * 解析本租户某网络×操作的封号概率：覆盖值优先，缺覆盖时用默认值。
 * 覆盖值本身非法（非 0–1 数字）时视为无覆盖，退回默认值。
 */
export async function resolveBanProbability(
  store: RiskParamStore | null | undefined,
  tenantId: string,
  network: string,
  operationType: CostLedgerOperationType
): Promise<{ banProbability: number; source: BanProbabilitySource }> {
  const fallback = DEFAULT_BAN_PROBABILITY[operationType];
  if (!store) return { banProbability: fallback, source: "default" };
  const row = await store.findUnique({
    where: {
      tenantId_network_operationType: { tenantId, network, operationType },
    },
  });
  if (row && isProbability(row.banProbability)) {
    return { banProbability: row.banProbability, source: "override" };
  }
  return { banProbability: fallback, source: "default" };
}

/** 展示用四舍五入（4 位小数），避免 0.15×150 之类浮点尾巴进 JSON。 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export interface CostLedgerEvaluation {
  /** 沉没成本 = 账户余额 + 待结佣金。 */
  sunkCost: number;
  /** 预期损失 = 封号概率 × 沉没成本。 */
  expectedLossUsd: number;
  /**
   * 预期损失 / 预期利润；预期利润未知、缺失或 ≤0 时为 null
   *（不是 0、不是无穷大：分母无效时比值无意义）。
   */
  lossToProfitRatio: number | null;
}

/**
 * 纯算术：sunkCost = balanceUsd + pendingUsd；
 * expectedLossUsd = banProbability × sunkCost；
 * lossToProfitRatio = expectedLossUsd / expectedProfitUsd（利润无效时 null）。
 * 非数字输入按 0 计（路由层已先做 ≥0 校验，这里只防 NaN 扩散）。
 */
export function evaluateCostLedger(input: {
  banProbability: number;
  balanceUsd?: number | null;
  pendingUsd?: number | null;
  expectedProfitUsd?: number | null;
}): CostLedgerEvaluation {
  const num = (v: number | null | undefined): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const sunkCost = round4(num(input.balanceUsd) + num(input.pendingUsd));
  const expectedLossUsd = round4(input.banProbability * sunkCost);
  const profit = input.expectedProfitUsd;
  const lossToProfitRatio =
    typeof profit === "number" && Number.isFinite(profit) && profit > 0
      ? round4(expectedLossUsd / profit)
      : null;
  return { sunkCost, expectedLossUsd, lossToProfitRatio };
}

/**
 * 联盟出价测算基准（用户 2026-10-24 实战口径）：别人跑联盟 CPC
 * 基本在 $0.20。缺覆盖时用此默认值；调用方可按 GEO / 格式传
 * cpcUsd 覆盖（覆盖值只影响本次测算，不写回任何参数表）。
 */
/** 默认联盟 CPC（美元 / 点击）。 */
export const DEFAULT_AFFILIATE_CPC_USD = 0.2;
/** pop 流量量级参考（约 $0.002 / 点击）：仅用于预算量级对比提示，不参与计算。 */
export const POP_REFERENCE_CPC_USD = 0.002;
/** 默认 ROI 目标（产出比 ≥2）。 */
export const DEFAULT_ROI_TARGET = 2;

export interface BidMathInput {
  /** 本次 CPC（美元 / 点击）；缺省用 DEFAULT_AFFILIATE_CPC_USD。 */
  cpcUsd?: number | null;
  /** ROI 目标；缺省用 DEFAULT_ROI_TARGET。 */
  roiTarget?: number | null;
  /** 单次转化佣金 payout（美元）；缺省时所需转化率为 null。 */
  payoutUsd?: number | null;
  /** 预算（美元）；缺省时可买点击数为 null。 */
  budgetUsd?: number | null;
}

export interface BidMathResult {
  cpcUsd: number;
  roiTarget: number;
  /**
   * 盈亏平衡 EPC = CPC × ROI 目标；默认口径（$0.20 CPC、ROI 2）
   * 下为 $0.40——EPC 低于此数，ROI 目标即不成立。
   */
  requiredEpcUsd: number;
  /**
   * 所需转化率 = CPC × ROI 目标 ÷ payout（小数，如 0.2 = 20%）；
   * 无 payout 或 payout ≤0 时为 null。
   * 例：$2 SOI 在 $0.20 CPC、ROI 2 下需 CR 20%；
   * $13.50 注册在同口径下需 CR 约 3%。
   */
  requiredCr: number | null;
  /** 预算可买点击数 = 预算 ÷ CPC；无预算时为 null。 */
  clicksForBudget: number | null;
  /**
   * 量级提示：$0.20 CPC 下 $100 只买 500 点击；pop 流量约
   * $0.002 / 点击是另一个量级，两类预算测算不要混用。
   */
  scaleNote: string;
}

/**
 * 纯算术出价测算：requiredEpcUsd = CPC × ROI 目标；
 * requiredCr = CPC × ROI 目标 ÷ payout；
 * clicksForBudget = 预算 ÷ CPC。
 * 非法输入（CPC ≤0、ROI 目标 ≤0）由路由层先拦，这里只防 NaN 扩散。
 */
export function calcBidMath(input: BidMathInput): BidMathResult {
  const num = (v: number | null | undefined, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  const cpcUsd = num(input.cpcUsd, DEFAULT_AFFILIATE_CPC_USD);
  const roiTarget = num(input.roiTarget, DEFAULT_ROI_TARGET);
  const requiredEpcUsd = round4(cpcUsd * roiTarget);
  const payout = input.payoutUsd;
  const requiredCr =
    typeof payout === "number" && Number.isFinite(payout) && payout > 0
      ? round4((cpcUsd * roiTarget) / payout)
      : null;
  const budget = input.budgetUsd;
  const clicksForBudget =
    typeof budget === "number" && Number.isFinite(budget) && budget >= 0
      ? Math.floor(budget / cpcUsd)
      : null;
  const scaleNote =
    `按 $${cpcUsd} CPC，$100 预算可买 ${Math.floor(100 / cpcUsd)} 点击；` +
    `pop 流量约 $${POP_REFERENCE_CPC_USD} / 点击是另一个量级，两类预算测算不要混用。`;
  return { cpcUsd, roiTarget, requiredEpcUsd, requiredCr, clicksForBudget, scaleNote };
}

/** RiskParam 行出站形态：只含网络、操作类型、概率三字段。 */
export function serializeRiskParam(row: RiskParamRow): RiskParamRow {
  return {
    network: row.network,
    operationType: row.operationType,
    banProbability: row.banProbability,
  };
}
