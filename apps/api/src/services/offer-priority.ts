/**
 * Offer 测试优先分（把握性排序）：Offer 太多不可能同时测，按"把握最大"
 * 给每个 Offer 算一个确定性分数（0–100），全部来自真实已存信号，不编造：
 *
 * - 初筛分 0–30：prescreenVerdict（go/caution/unknown/stop/未筛）
 * - 广告分 0–40：关联商品的品牌广告数分档 + 趋势（brand-ad-count 的
 *   adBandOf/deriveAdTrend 现算）；无关联商品或未计算 → 中性 12
 *   （与全站 unknown 不重罚口径一致）；疑似停投封顶 4
 * - 佣金分 0–30：单笔佣金金额分档；未知 → 8（中性偏低，不判死）
 *
 * reasons 是与分数来源一一对应的中文短标签（按贡献从大到小，最多 4 条），
 * 保证每个分数都可解释。广告数据经 idempotencyKey `catalog:<networkId>:
 * <externalId>` 精确关联回 NetworkProduct（商品库建的 Offer 才有此键）。
 */
import type { PrismaClient } from "@adlinklab/database";
import { adBandOf, deriveAdTrend } from "./brand-ad-count.js";

export interface TestPriorityInput {
  prescreenVerdict: string | null;
  commissionPerSaleUsd: number | null;
  adCount: number | null;
  lastAdCount: number | null;
  hasProductLink: boolean;
}

export interface TestPriority {
  score: number;
  reasons: string[];
}

interface ReasonEntry {
  /** 贡献分（用于排序；扣分/中性项分低，自然排后）。 */
  weight: number;
  text: string;
}

export function computeTestPriority(input: TestPriorityInput): TestPriority {
  const entries: ReasonEntry[] = [];

  /* ── 初筛分 0–30 ── */
  let prescreenScore: number;
  switch (input.prescreenVerdict) {
    case "go":
      prescreenScore = 30;
      entries.push({ weight: 30, text: "初筛通过" });
      break;
    case "caution":
      prescreenScore = 18;
      entries.push({ weight: 18, text: "初筛谨慎" });
      break;
    case "unknown":
      prescreenScore = 8;
      entries.push({ weight: 8, text: "初筛待确认" });
      break;
    case "stop":
      prescreenScore = 0;
      entries.push({ weight: 0, text: "初筛不建议投放" });
      break;
    default:
      // null / 未知值 = 未做初筛：轻微扣分，不重罚。
      prescreenScore = 5;
      entries.push({ weight: 5, text: "未做初筛" });
      break;
  }

  /* ── 广告分 0–40 ── */
  let adScore: number;
  if (!input.hasProductLink || input.adCount == null) {
    adScore = 12;
    entries.push({
      weight: 12,
      text: input.hasProductLink ? "广告数未计算" : "未关联商品，广告数中性",
    });
  } else {
    const band = adBandOf(input.adCount);
    switch (band) {
      case "sweet":
        adScore = 40;
        entries.push({ weight: 40, text: "广告稳定投放（甜蜜点）" });
        break;
      case "small":
        adScore = 30;
        entries.push({ weight: 30, text: "有广告在投" });
        break;
      case "hot":
        adScore = 28;
        entries.push({ weight: 28, text: "竞争较热" });
        break;
      case "redocean":
        adScore = 14;
        entries.push({ weight: 14, text: "广告竞争红海" });
        break;
      default:
        // band "none"（adCount = 0）
        adScore = 4;
        entries.push({ weight: 4, text: "暂无广告在投" });
        break;
    }
    const trend = deriveAdTrend(input.adCount, input.lastAdCount);
    if (trend === "stopped") {
      // 疑似停投是最强负面广告信号：封顶并替换分档标签（同为 0 条，
      // "停投"比"暂无"信息量大）；权重按封顶后的分计。
      adScore = Math.min(adScore, 4);
      const bandEntry = entries[entries.length - 1];
      if (bandEntry) {
        bandEntry.weight = adScore;
        bandEntry.text = "疑似停投";
      }
    } else if (trend === "new") {
      adScore += 3;
      entries.push({ weight: 3, text: "广告新投放" });
    } else if (trend === "active") {
      adScore += 2;
      entries.push({ weight: 2, text: "广告持续在投" });
    }
    adScore = Math.max(0, Math.min(40, adScore));
  }

  /* ── 佣金分 0–30 ── */
  let commissionScore: number;
  const commission = input.commissionPerSaleUsd;
  if (commission == null || !Number.isFinite(commission)) {
    commissionScore = 8;
    entries.push({ weight: 8, text: "佣金未知" });
  } else {
    if (commission >= 50) commissionScore = 30;
    else if (commission >= 25) commissionScore = 24;
    else if (commission >= 8) commissionScore = 16;
    else if (commission > 0) commissionScore = 8;
    else commissionScore = 0;
    entries.push({
      weight: commissionScore,
      text: `单笔佣金 $${commission.toFixed(2)}`,
    });
  }

  const reasons = entries
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((e) => e.text);

  return {
    score: prescreenScore + adScore + commissionScore,
    reasons,
  };
}

/** Decimal / 字符串 / number 统一转有限数；转不出 → null。 */
function toFiniteNumber(v: unknown): number | null {
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 由 Offer 的 commissionValue/commissionType/avgPrice 推导单笔佣金（美元）。
 * 取值口径（实证，见各写入方）：
 * - "fixed"（表单/amazon-discovery 写入）：值即美元金额。
 * - "percent"（catalog-sync 写入的大写 PERCENT 归一后）：唯一写入方在存入前
 *   已把 价格×佣金率÷100 换算成美元金额（catalog-sync.ts
 *   createOfferFromProduct），值即金额——绝不能再乘一次均价。
 * - "percentage" / "%"（offer-form 口径，offers 页 derivedCommission 同）：
 *   值是百分比，需 × 均价；缺均价 → null。
 * - 其他/缺失类型：不猜 → null（未知按中性计分，不编造）。
 */
export function deriveCommissionPerSaleUsd(offer: {
  commissionValue?: unknown;
  commissionType?: string | null;
  avgPrice?: unknown;
}): number | null {
  const value = toFiniteNumber(offer.commissionValue);
  if (value == null) return null;
  const t = (offer.commissionType ?? "").trim().toLowerCase();
  if (t === "fixed" || t === "percent") {
    return round2(value);
  }
  if (t === "percentage" || t === "%") {
    const price = toFiniteNumber(offer.avgPrice);
    if (price == null) return null;
    return round2((price * value) / 100);
  }
  return null;
}

/**
 * 解析商品库幂等键 `catalog:<networkId>:<externalId>`。
 * externalId 本身可含冒号，故只切前两段；不合格式 → null。
 */
export function parseCatalogIdempotencyKey(
  key: string | null | undefined
): { networkId: string; externalId: string } | null {
  if (!key || !key.startsWith("catalog:")) return null;
  const rest = key.slice("catalog:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return {
    networkId: rest.slice(0, sep),
    externalId: rest.slice(sep + 1),
  };
}

/** attach 所需的 Offer 最小形状（路由序列化后的条目即可）。 */
export interface OfferForPriority {
  id: string;
  prescreenVerdict?: string | null;
  commissionValue?: unknown;
  commissionType?: string | null;
  avgPrice?: unknown;
  idempotencyKey?: string | null;
}

/**
 * 给一批 Offer 附带 testPriority。广告数据一次批量查（按租户 + 键对集合），
 * 无 N+1；prisma 缺失（如 memory 模式）时全部按无关联商品中性处理。
 */
export async function attachTestPriorities<T extends OfferForPriority>(
  prisma: PrismaClient | null | undefined,
  tenantId: string,
  offers: T[]
): Promise<Array<T & { testPriority: TestPriority }>> {
  const parsed = offers.map((o) => parseCatalogIdempotencyKey(o.idempotencyKey));
  const pairKeys = new Map<string, { networkId: string; externalId: string }>();
  for (const p of parsed) {
    if (p) pairKeys.set(`${p.networkId}:${p.externalId}`, p);
  }

  const productByKey = new Map<
    string,
    { adCount: number | null; lastAdCount: number | null }
  >();
  if (prisma && pairKeys.size > 0) {
    const rows = (await prisma.networkProduct.findMany({
      where: {
        tenantId,
        OR: [...pairKeys.values()].map((p) => ({
          networkId: p.networkId,
          externalId: p.externalId,
        })),
      },
      select: {
        networkId: true,
        externalId: true,
        adCount: true,
        lastAdCount: true,
      },
    })) as Array<{
      networkId: string;
      externalId: string;
      adCount: number | null;
      lastAdCount: number | null;
    }>;
    for (const r of rows) {
      productByKey.set(`${r.networkId}:${r.externalId}`, {
        adCount: r.adCount,
        lastAdCount: r.lastAdCount,
      });
    }
  }

  return offers.map((o, i) => {
    const p = parsed[i];
    const product = p
      ? productByKey.get(`${p.networkId}:${p.externalId}`)
      : undefined;
    const testPriority = computeTestPriority({
      prescreenVerdict: o.prescreenVerdict ?? null,
      commissionPerSaleUsd: deriveCommissionPerSaleUsd(o),
      adCount: product?.adCount ?? null,
      lastAdCount: product?.lastAdCount ?? null,
      hasProductLink: product !== undefined,
    });
    return { ...o, testPriority };
  });
}
