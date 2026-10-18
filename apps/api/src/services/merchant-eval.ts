/**
 * 商家自动评估（2026-10-18）：不付钱 / 扣量嫌疑 / 跑不正 → 自动进黑名单。
 *
 * requireSession 即可，不要求 B6——这是分析租户自有数据（订单/转化/花费），
 * 不涉及外部采集。每次自动进黑名单写 adminGrantAudit
 * （action MERCHANT_BLACKLIST_AUTO_ADDED）。
 *
 * 数据现实（已验证代码）：
 * - ConversionStatus 没有 CONFIRMED（只有 PENDING/ATTRIBUTED/UPLOADED/FAILED/ARCHIVED）；
 *   "自有转化"取 ATTRIBUTED/UPLOADED（归因到我们自己 click 的转化）。
 * - Order 写入链路（services/conversion-order.ts + POST /api/v1/orders）都强制要求
 *   clickId，当前没有"网络侧同步订单"（clickId/conversionId 为 null）的写入来源；
 *   因此 networkOrders 恒为 0 → 扣量检查记 insufficient_data，不做判定（按需求）。
 *   若将来接入网络订单同步（写入 clickId=null 的 Order），本逻辑自动生效。
 * - adSpend 取 LaunchArchive.spend（Float?）按 offer→merchant 归因求和；
 *   无花费数据 → insufficient_data，不判。
 *
 * 归因链：Order.clickId → Click.offerId → Offer.merchantId；
 *         Conversion.clickId → Click.offerId → Offer.merchantId。
 * 查不到归因的订单/转化跳过并记数（证据里注明 unattributed）。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  addToBlacklist,
  isBlacklisted,
  networkKindToChannel,
  type CatalogChannel,
} from "./catalog-blacklist.js";

export const DEFAULT_MERCHANT_POLICY = {
  shaveThresholdPct: 30,
  shavePeriodDays: 7,
  shavePeriods: 3,
  roasDays: 14,
  roasThreshold: 0.9,
  nonPaymentDays: 45,
  observationDays: 30,
} as const;

/** CANCELLED/REFUNDED 占比触发阈值（启发式：≥50% 且订单数≥3；非普适真理）。 */
const CANCEL_REFUND_RATIO_THRESHOLD = 0.5;
const CANCEL_REFUND_MIN_ORDERS = 3;

const DAY_MS = 86400 * 1000;

interface MerchantPolicy {
  shaveThresholdPct: number;
  shavePeriodDays: number;
  shavePeriods: number;
  roasDays: number;
  roasThreshold: number;
  nonPaymentDays: number;
  observationDays: number;
}

async function loadPolicy(
  prisma: PrismaClient,
  tenantId: string
): Promise<MerchantPolicy> {
  const row = await prisma.catalogMerchantPolicy.findUnique({
    where: { tenantId },
  });
  if (!row) return { ...DEFAULT_MERCHANT_POLICY };
  const r = row as Record<string, unknown>;
  const num = (v: unknown, d: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? v
      : v !== null && v !== undefined
        ? Number(v)
        : d;
  return {
    shaveThresholdPct: num(r.shaveThresholdPct, DEFAULT_MERCHANT_POLICY.shaveThresholdPct),
    shavePeriodDays: Math.max(
      1,
      Math.round(num(r.shavePeriodDays, DEFAULT_MERCHANT_POLICY.shavePeriodDays))
    ),
    shavePeriods: Math.max(
      1,
      Math.round(num(r.shavePeriods, DEFAULT_MERCHANT_POLICY.shavePeriods))
    ),
    roasDays: Math.max(
      1,
      Math.round(num(r.roasDays, DEFAULT_MERCHANT_POLICY.roasDays))
    ),
    roasThreshold: num(r.roasThreshold, DEFAULT_MERCHANT_POLICY.roasThreshold),
    nonPaymentDays: Math.max(
      1,
      Math.round(num(r.nonPaymentDays, DEFAULT_MERCHANT_POLICY.nonPaymentDays))
    ),
    observationDays: Math.max(
      1,
      Math.round(num(r.observationDays, DEFAULT_MERCHANT_POLICY.observationDays))
    ),
  };
}

interface MerchantRow {
  id: string;
  tenantId: string;
  name: string;
  networkId: string | null;
  networkKind?: string | null;
}

/** 商家渠道：经 networkId → kind 映射；无网络归属 → affiliate。 */
function merchantChannel(m: MerchantRow): CatalogChannel {
  if (m.networkKind) return networkKindToChannel(m.networkKind);
  return "affiliate";
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface MerchantEvalResult {
  evaluated: number;
  blacklisted: Array<{ merchantId: string; channel: CatalogChannel; reason: string }>;
  skipped: Array<{ merchantId: string; reason: string }>;
  signalsWritten: number;
}

/**
 * 评估租户下（可选 channel 过滤）的商家。三项检查任一触发 → 自动进黑名单。
 * 扣量检查只做"嫌疑"标记 + 证据展示（两边数字并列存 signal），连续达标才进。
 */
export async function evaluateMerchants(
  deps: { prisma: PrismaClient },
  input: { tenantId: string; channel?: CatalogChannel }
): Promise<MerchantEvalResult> {
  const { prisma } = deps;
  const { tenantId } = input;
  const policy = await loadPolicy(prisma, tenantId);
  const now = new Date();

  // 商家 + 其网络 kind（用于渠道映射）。
  const merchants = (await prisma.merchant.findMany({
    where: { tenantId, deletedAt: null },
    include: { network: { select: { kind: true } } },
  })) as Array<MerchantRow & { network?: { kind: string } | null }>;
  const inScope = merchants
    .map((m) => ({
      ...m,
      networkKind: m.network?.kind ?? null,
      channel: merchantChannel({ ...m, networkKind: m.network?.kind ?? null }),
    }))
    .filter((m) => !input.channel || m.channel === input.channel);

  const result: MerchantEvalResult = {
    evaluated: 0,
    blacklisted: [],
    skipped: [],
    signalsWritten: 0,
  };

  for (const m of inScope) {
    // 已在黑名单 → 跳过（不再浪费评估）。
    if (await isBlacklisted(prisma, tenantId, m.channel, "merchant", m.id)) {
      result.skipped.push({ merchantId: m.id, reason: "already_blacklisted" });
      continue;
    }
    result.evaluated += 1;

    // 该商家的 offer / click 集合（归因基础）。
    const offers = (await prisma.offer.findMany({
      where: { tenantId, merchantId: m.id, deletedAt: null },
      select: { id: true },
    })) as Array<{ id: string }>;
    const offerIds = offers.map((o) => o.id);
    const clicks = (
      offerIds.length
        ? await prisma.click.findMany({
            where: { tenantId, offerId: { in: offerIds } },
            select: { id: true },
          })
        : []
    ) as Array<{ id: string }>;
    const clickIds = clicks.map((c) => c.id);
    const clickSet = new Set(clickIds);

    /* ── 1. 不付钱 ── */
    const orders = (
      clickIds.length
        ? await prisma.order.findMany({ where: { tenantId, clickId: { in: clickIds } } })
        : []
    ) as Array<{
      id: string;
      status: string;
      value: unknown;
      createdAt: Date;
      clickId: string | null;
    }>;
    const attributable = orders.filter((o) => o.clickId && clickSet.has(o.clickId));
    const unattributed = orders.length - attributable.length;
    const overdueCutoff = new Date(now.getTime() - policy.nonPaymentDays * DAY_MS);
    const overduePending = attributable.filter(
      (o) => o.status === "PENDING" && new Date(o.createdAt) < overdueCutoff
    );
    const oldestPendingDays =
      overduePending.length > 0
        ? Math.max(
            ...overduePending.map((o) =>
              Math.floor((now.getTime() - new Date(o.createdAt).getTime()) / DAY_MS)
            )
          )
        : null;
    const badCount = attributable.filter(
      (o) => o.status === "CANCELLED" || o.status === "REFUNDED"
    ).length;
    const badRatio =
      attributable.length >= CANCEL_REFUND_MIN_ORDERS
        ? badCount / attributable.length
        : 0;
    const nonPaymentHit =
      overduePending.length > 0 || badRatio >= CANCEL_REFUND_RATIO_THRESHOLD;

    /* ── 2. 扣量嫌疑（周期信号 + 证据展示） ── */
    const periodMs = policy.shavePeriodDays * DAY_MS;
    type PeriodRow = {
      periodStart: Date;
      own: number;
      network: number;
      shavePct: number | null;
      note: string | null;
    };
    const periods: PeriodRow[] = [];
    for (let i = 0; i < policy.shavePeriods; i += 1) {
      const periodStart = new Date(now.getTime() - (i + 1) * periodMs);
      const periodEnd = new Date(now.getTime() - i * periodMs);
      const conversions = (
        clickIds.length
          ? await prisma.conversion.findMany({
              where: {
                tenantId,
                clickId: { in: clickIds },
                status: { in: ["ATTRIBUTED", "UPLOADED"] },
                conversionTime: { gte: periodStart, lt: periodEnd },
              },
              select: { id: true },
            })
          : []
      ) as Array<{ id: string }>;
      const own = conversions.length;
      // 网络侧同步订单：clickId/conversionId 为 null 的 Order。
      // 已验证：当前无写入链路产生此类订单 → networkOrders 恒为 0 → insufficient_data，不判。
      const networkOrders = (await prisma.order.count({
        where: {
          tenantId,
          clickId: null,
          conversionId: null,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      })) as number;
      let shavePct: number | null = null;
      let note: string | null = null;
      if (own === 0) {
        note = "insufficient_data: 本周期无自有转化，跳过扣量判定";
      } else if (networkOrders === 0) {
        // 无网络订单数据（当前无写入链路）→ 不判，只记证据。
        note =
          "insufficient_data: 无网络侧同步订单数据（Order 写入链路均要求 clickId），不做扣量判定";
      } else {
        shavePct = ((own - networkOrders) / own) * 100;
      }
      periods.push({ periodStart, own, network: networkOrders, shavePct, note });
      await prisma.catalogMerchantSignal.upsert({
        where: {
          tenantId_merchantId_channel_periodStart: {
            tenantId,
            merchantId: m.id,
            channel: m.channel,
            periodStart,
          },
        },
        create: {
          id: randomUUID(),
          tenantId,
          merchantId: m.id,
          channel: m.channel,
          periodStart,
          periodDays: policy.shavePeriodDays,
          ownConversions: own,
          networkOrders,
          shavePct,
          note,
        },
        update: {
          ownConversions: own,
          networkOrders,
          shavePct,
          note,
        },
      });
      result.signalsWritten += 1;
    }
    // 连续 shavePeriods 个周期超阈值 → 嫌疑成立。单次波动不进。
    const history = (await prisma.catalogMerchantSignal.findMany({
      where: { tenantId, merchantId: m.id, channel: m.channel },
      orderBy: { periodStart: "desc" },
      take: policy.shavePeriods,
    })) as Array<{ shavePct: unknown; periodStart: Date; ownConversions: number; networkOrders: number }>;
    const shaveHit =
      history.length >= policy.shavePeriods &&
      history.every((s) => {
        const pct = toNum(s.shavePct);
        return s.shavePct !== null && s.shavePct !== undefined && pct > policy.shaveThresholdPct;
      });

    /* ── 3. 跑不正（ROAS） ── */
    const roasStart = new Date(now.getTime() - policy.roasDays * DAY_MS);
    const archives = (
      offerIds.length
        ? await prisma.launchArchive.findMany({
            where: { tenantId, offerId: { in: offerIds }, createdAt: { gte: roasStart } },
            select: { spend: true },
          })
        : []
    ) as Array<{ spend: number | null }>;
    const adSpend = archives.reduce((s, a) => s + (a.spend ?? 0), 0);
    const confirmedOrders = attributable.filter(
      (o) => o.status === "CONFIRMED" && new Date(o.createdAt) >= roasStart
    );
    const commission = confirmedOrders.reduce((s, o) => s + toNum(o.value), 0);
    const roas = adSpend > 0 ? commission / adSpend : null;
    const roasHit = roas !== null && roas < policy.roasThreshold;
    const roasNote =
      adSpend === 0
        ? "insufficient_data: 窗口内无广告花费数据（LaunchArchive.spend），不做 ROAS 判定"
        : null;

    // 当前周期 signal 补写支付/ROAS 证据（最新周期行）。
    const latestPeriod = periods[0];
    if (latestPeriod) {
      await prisma.catalogMerchantSignal.update({
        where: {
          tenantId_merchantId_channel_periodStart: {
            tenantId,
            merchantId: m.id,
            channel: m.channel,
            periodStart: latestPeriod.periodStart,
          },
        },
        data: {
          adSpend: adSpend > 0 ? adSpend : null,
          commission: adSpend > 0 ? commission : null,
          roas,
          pendingOrders: overduePending.length,
          oldestPendingDays,
          note:
            roasNote ??
            (latestPeriod.note && latestPeriod.note.startsWith("insufficient_data")
              ? latestPeriod.note
              : null),
        },
      });
    }

    /* ── 判定 → 黑名单 ── */
    const doBlacklist = async (reason: string, evidence: Record<string, unknown>) => {
      await addToBlacklist(prisma, {
        tenantId,
        channel: m.channel,
        entityType: "merchant",
        entityId: m.id,
        networkKind: m.networkKind,
        reason,
        source: "auto",
        auditAction: "MERCHANT_BLACKLIST_AUTO_ADDED",
        evidence,
      });
      result.blacklisted.push({ merchantId: m.id, channel: m.channel, reason });
    };

    if (nonPaymentHit) {
      await doBlacklist("non_payment", {
        pendingCount: overduePending.length,
        oldestPendingDays,
        cancelledRefunded: badCount,
        badRatio: Number(badRatio.toFixed(4)),
        totalOrders: attributable.length,
        unattributedOrders: unattributed,
        nonPaymentDays: policy.nonPaymentDays,
      });
      continue;
    }
    if (shaveHit) {
      await doBlacklist("shave_suspected", {
        periods: history.map((s) => ({
          periodStart: new Date(s.periodStart).toISOString(),
          ownConversions: s.ownConversions,
          networkOrders: s.networkOrders,
          shavePct: Number(toNum(s.shavePct).toFixed(2)),
        })),
        thresholdPct: policy.shaveThresholdPct,
        consecutivePeriods: policy.shavePeriods,
        note: "嫌疑标记：两边数字并列为证据，未做实锤判定",
      });
      continue;
    }
    if (roasHit) {
      await doBlacklist("unprofitable_roas", {
        spend: Number(adSpend.toFixed(2)),
        commission: Number(commission.toFixed(2)),
        roas: Number((roas as number).toFixed(4)),
        days: policy.roasDays,
        threshold: policy.roasThreshold,
      });
    }
  }

  return result;
}
