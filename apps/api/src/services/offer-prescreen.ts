/**
 * Offer 一键初筛：对 Offer 跑与商品库一键筛选同一条阶梯，结论以徽标字段
 * 写回 Offer（prescreenVerdict / prescreenReason / prescreenedAt）。
 * 判停（stop）只标注、绝不删除 Offer（与工作表初筛同口径）。
 *
 * 阶梯（与 one-click-screen 同序、同规则实现口径）：
 * 1. 黑名单（merchant / offer 实体，channel 按 Offer.source 映射）
 * 2. $8 佣金门槛（FIXED 用 commissionValue；PERCENT 用 值 × 均价估算；
 *    未知 → 不判死，转 unknown 标记）
 * 3. 已保存预设（evaluateProduct；Offers 无评论数维度，reviewCount=null
 *    按预设既有口径参与；佣金未知时金额维度置 0 不判死）
 * 4. 广告数（品牌级，经付费数据网关）：以同租户同品牌商品的 adCount 为据；
 *    未知时经网关增量计算；网关拒绝 → 整层跳过（skippedPaidLayer）；
 *    已知全为 0 → stop；仍未知 → unknown 标记
 * 5. 流量门免费档（evaluateTrafficGate）：false → stop；null → unknown 标记
 *
 * 合成：任一 stop → "stop"；无 stop 但有 unknown 标记 → "unknown"；
 * 全过 → "go"（caution 档保留给工作表四腿合成，本阶梯无 caution 来源）。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  belowMinCommission,
  estimateCommissionFigure,
  minCommissionStopReason,
} from "@adlinklab/shared";
import { getMinCommissionUsd } from "../ai/commission-gate.js";
import {
  evaluateTrafficGate,
  extractCoreKeywords,
  type EvaluateTrafficGateInput,
} from "../traffic/gate.js";
import { getTrafficThresholds } from "../traffic/thresholds.js";
import type { TrafficGateResult } from "../traffic/types.js";
import { writeCatalogAudit } from "./catalog-blacklist.js";
import {
  calcBrandAdCounts,
  type BrandAdCountResult,
} from "./brand-ad-count.js";
import {
  DEFAULT_PRESET,
  evaluateProduct,
  type ScreeningPreset,
} from "./catalog-screening.js";
import {
  recordPaidDataUsage,
  resolvePaidDataAccess,
} from "./paid-data-gateway.js";

export type OfferPrescreenVerdict = "go" | "unknown" | "stop";

export interface OfferPrescreenOutcome {
  offerId: string;
  verdict: OfferPrescreenVerdict;
  reason: string;
}

export interface OfferPrescreenDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  gateEvaluator?: (
    input: EvaluateTrafficGateInput
  ) => Promise<TrafficGateResult>;
  adCountCalc?: (
    prisma: PrismaClient,
    tenantId: string,
    productIds?: string[],
    deps?: {
      fetchImpl?: typeof fetch;
      credentials?: { login: string; password: string } | null;
    }
  ) => Promise<BrandAdCountResult>;
  gatewayResolve?: typeof resolvePaidDataAccess;
}

interface OfferRow {
  id: string;
  name: string;
  network: string;
  source: string;
  destinationUrl: string;
  merchantId: string | null;
  brandName: string | null;
  commissionValue: unknown;
  commissionType: string | null;
  avgPrice: unknown;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;

function offerChannel(source: string): string {
  const s = source.trim().toLowerCase();
  if (s === "amazon" || s === "cashback") return s;
  return "affiliate";
}

async function loadPreset(
  prisma: PrismaClient,
  tenantId: string
): Promise<ScreeningPreset> {
  const row = (await prisma.catalogScreeningPreset.findUnique({
    where: { tenantId },
  })) as {
    minReviews: number | null;
    minCommissionAmount: unknown;
    minCommissionRate: unknown;
    minPrice: unknown;
    maxPrice: unknown;
    minScore: number | null;
  } | null;
  if (!row) return { ...DEFAULT_PRESET };
  return {
    minReviews: row.minReviews,
    minCommissionAmount: num(row.minCommissionAmount),
    minCommissionRate: num(row.minCommissionRate),
    minPrice: num(row.minPrice),
    maxPrice: num(row.maxPrice),
    minScore: row.minScore,
  };
}

export async function prescreenOffers(
  deps: OfferPrescreenDeps,
  input: {
    tenantId: string;
    actorId: string;
    userRole: string;
    offers: OfferRow[];
  }
): Promise<{
  outcomes: OfferPrescreenOutcome[];
  skippedPaidLayer: boolean;
  counts: { go: number; unknown: number; stop: number; notFound: number };
}> {
  const { prisma } = deps;
  const { tenantId, offers } = input;
  const gateEvaluator = deps.gateEvaluator ?? evaluateTrafficGate;
  const adCountCalc = deps.adCountCalc ?? calcBrandAdCounts;
  const gatewayResolve = deps.gatewayResolve ?? resolvePaidDataAccess;

  const [blacklistRows, preset, thresholdUsd, thresholds] = await Promise.all([
    prisma.catalogBlacklist.findMany({
      where: { tenantId, status: "active" },
      select: { channel: true, entityType: true, entityId: true, reason: true },
    }) as Promise<
      Array<{ channel: string; entityType: string; entityId: string; reason: string }>
    >,
    loadPreset(prisma, tenantId),
    getMinCommissionUsd(prisma),
    getTrafficThresholds(prisma),
  ]);

  interface Work {
    o: OfferRow;
    stopReason?: string;
    flags: string[];
    needsAdData: boolean;
  }
  const works: Work[] = offers.map((o) => ({ o, flags: [], needsAdData: false }));

  /* ── 1) 黑名单 → 2) $8 → 3) 预设 ── */
  for (const w of works) {
    const o = w.o;
    const channel = offerChannel(o.source);
    const bl = blacklistRows.find(
      (e) =>
        e.channel === channel &&
        ((e.entityType === "offer" && e.entityId === o.id) ||
          (e.entityType === "merchant" &&
            o.merchantId &&
            e.entityId === o.merchantId))
    );
    if (bl) {
      w.stopReason = `黑名单（${bl.entityType}）：${bl.reason}`;
      continue;
    }
    const commissionValue = num(o.commissionValue);
    const avgPrice = num(o.avgPrice);
    const isFixed = (o.commissionType ?? "").toUpperCase() === "FIXED";
    const isPercent = (o.commissionType ?? "").toUpperCase() === "PERCENT";
    const fig = estimateCommissionFigure({
      amount: isFixed ? commissionValue : null,
      ratePct: isPercent ? commissionValue : null,
      price: avgPrice,
    });
    if (fig.figure !== null && belowMinCommission(fig.figure, thresholdUsd)) {
      w.stopReason = minCommissionStopReason(
        fig.figure,
        "USD",
        thresholdUsd,
        "zh"
      );
      continue;
    }
    if (fig.figure === null) w.flags.push("佣金未知，待人工复核");
    // 未知维度不判死：佣金算不出 → 金额维度置 0；非 PERCENT 型（无佣金率）
    // → 比例维度置 0。其余维度照常判（与商品库一键筛选同口径）。
    const rateForEval = isPercent ? commissionValue : null;
    const effectivePreset = {
      ...preset,
      ...(fig.figure === null ? { minCommissionAmount: 0 } : {}),
      ...(rateForEval === null ? { minCommissionRate: 0 } : {}),
    };
    const ev = evaluateProduct(
      {
        price: avgPrice,
        commissionAmount: isFixed ? commissionValue : null,
        commissionRate: rateForEval,
        reviewCount: null,
      },
      effectivePreset
    );
    if (!ev.recommended) {
      w.stopReason = `未达筛选预设（质量分 ${ev.score}）`;
      continue;
    }
    w.needsAdData = true;
  }

  /* ── 4) 广告数（品牌级，付费层经网关） ── */
  let skippedPaidLayer = false;
  const adCandidates = works.filter((w) => !w.stopReason && w.needsAdData);
  if (adCandidates.length > 0) {
    const access = await gatewayResolve(prisma, {
      tenantId,
      userId: input.actorId,
      userRole: input.userRole,
      feature: "catalog-ad-count",
    });
    if (!access.allowed) {
      skippedPaidLayer = true;
    } else {
      // 同品牌商品（品牌名归一化后精确匹配）的广告数即品牌级广告数。
      const allProducts = (await prisma.networkProduct.findMany({
        where: { tenantId },
        select: { id: true, brand: true, adCount: true },
      })) as Array<{ id: string; brand: string | null; adCount: number | null }>;
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      const byBrand = new Map<string, Array<{ id: string; adCount: number | null }>>();
      for (const p of allProducts) {
        const key = norm(p.brand);
        if (!key) continue;
        const arr = byBrand.get(key) ?? [];
        arr.push({ id: p.id, adCount: p.adCount });
        byBrand.set(key, arr);
      }
      // 先给「品牌有商品但广告数全未知」的品牌做一次增量计算。
      const calcIds: string[] = [];
      for (const w of adCandidates) {
        const rows = byBrand.get(norm(w.o.brandName)) ?? [];
        if (rows.length > 0 && rows.every((r) => r.adCount === null)) {
          calcIds.push(...rows.map((r) => r.id));
        }
      }
      if (calcIds.length > 0) {
        const result = await adCountCalc(prisma, tenantId, [...new Set(calcIds)], {
          fetchImpl: deps.fetchImpl,
          credentials: access.credentials ?? undefined,
        });
        if (result.groupsQueried > 0) {
          await recordPaidDataUsage(prisma, {
            tenantId,
            actorId: input.actorId,
            feature: "catalog-ad-count",
            keySource: access.keySource,
            calls: result.groupsQueried,
            grantId: access.grantId,
          });
          const refreshed = (await prisma.networkProduct.findMany({
            where: { tenantId, id: { in: [...new Set(calcIds)] } },
            select: { id: true, brand: true, adCount: true },
          })) as Array<{ id: string; brand: string | null; adCount: number | null }>;
          for (const p of refreshed) {
            const key = norm(p.brand);
            const arr = byBrand.get(key) ?? [];
            const hit = arr.find((r) => r.id === p.id);
            if (hit) hit.adCount = p.adCount;
          }
        }
      }
      for (const w of adCandidates) {
        const rows = byBrand.get(norm(w.o.brandName)) ?? [];
        const known = rows
          .map((r) => r.adCount)
          .filter((v): v is number => v !== null);
        if (known.length === 0) {
          w.flags.push("品牌广告数无数据，待人工复核");
        } else if (known.every((v) => v === 0)) {
          w.stopReason = "广告数为 0：该品牌暂无人在投放";
        }
      }
    }
  }

  /* ── 5) 流量门免费档 + 落账 ── */
  const outcomes: OfferPrescreenOutcome[] = [];
  const counts = { go: 0, unknown: 0, stop: 0, notFound: 0 };
  const now = new Date();
  for (const w of works) {
    const o = w.o;
    if (!w.stopReason) {
      const gate = await gateEvaluator({
        brand: o.brandName,
        title: o.name,
        keywords: extractCoreKeywords(o.name, o.brandName ? [o.brandName] : []),
        thresholds,
        prisma,
        fetchImpl: deps.fetchImpl,
      });
      if (gate.passed === false) {
        w.stopReason = `流量门未通过：${gate.reason}`;
      } else if (gate.passed === null) {
        w.flags.push("流量门数据不足（unknown），待人工复核");
      }
    }
    const verdict: OfferPrescreenVerdict = w.stopReason
      ? "stop"
      : w.flags.length > 0
        ? "unknown"
        : "go";
    const reason = w.stopReason ?? w.flags.join("；") ?? "";
    counts[verdict] += 1;
    outcomes.push({ offerId: o.id, verdict, reason });
    await prisma.offer.update({
      where: { id: o.id },
      data: {
        prescreenVerdict: verdict,
        prescreenReason: reason || null,
        prescreenedAt: now,
      },
    });
  }

  await writeCatalogAudit(prisma, {
    tenantId,
    actorId: input.actorId,
    action: "OFFER_PRESCREEN_BATCH",
    detail: {
      requested: offers.length,
      go: counts.go,
      unknown: counts.unknown,
      stop: counts.stop,
      skippedPaidLayer,
    },
  });

  return { outcomes, skippedPaidLayer, counts };
}
