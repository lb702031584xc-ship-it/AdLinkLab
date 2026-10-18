/**
 * Amazon 自动选品服务。
 *
 * 流程：
 * 1. 用户配置选品条件（关键词、价格区间、最低评分、最低评论数、站点）
 * 2. 定时任务（每天）调用 PA-API SearchItems 抓取产品
 * 3. 按评分算法打分排序，过滤不达标产品
 * 4. 结果存入 amazon_discoveries，前端展示推荐列表
 * 5. 用户一键导入为 Offer（进入正常投放流程）
 *
 * 前置条件：用户需有 Amazon Associates 账号 + PA-API 凭证。
 * 凭证存在 AiSetting 加密字段或环境变量，不落地明文。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  parseAmazonCredentials,
  searchAmazonProducts,
  scoreAmazonProduct,
  type AmazonProduct,
} from "../networks/amazon-adapter.js";
import { evaluateTrafficGate } from "../traffic/gate.js";
import { getTrafficThresholds } from "../traffic/thresholds.js";
import type {
  TrafficGateResult,
  TrafficThresholds,
} from "../traffic/types.js";

export interface DiscoveryCriteria {
  keywords: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minRating?: number | null;
  minReviews?: number | null;
  region?: string;
  maxResults?: number;
  /** 本次发现使用的流量门阈值（历史追溯用，runDiscovery 开头从 AiSetting 取出） */
  trafficThresholds?: TrafficThresholds;
  /** 机会品模式（第八批）：reviews ≥ opportunityMinReviews 且 opportunityMinRating ≤ rating < opportunityMaxRating */
  opportunityMode?: boolean;
  opportunityMinReviews?: number | null;
  opportunityMinRating?: number | null;
  opportunityMaxRating?: number | null;
}

export interface ScoredProduct extends AmazonProduct {
  score: number;
  /** 预估佣金（按 4% 中位数估算） */
  estimatedCommission: number | null;
  reasons: string[];
  /** 流量需求门评估结果（仅 top N 产品有值，历史记录反序列化时为 undefined） */
  trafficGate?: TrafficGateResult | null;
  /** 机会品（第八批）：机会品模式下检出，pipeline 指数 +10 */
  opportunity?: boolean;
}

export interface DiscoveryResult {
  runId: string;
  criteria: DiscoveryCriteria;
  products: ScoredProduct[];
  totalFound: number;
  totalKept: number;
  errors: string[];
}

/** 默认选品条件 */
export const DEFAULT_CRITERIA: DiscoveryCriteria = {
  keywords: [],
  minPrice: 50,
  maxPrice: 200,
  minRating: 4.3,
  minReviews: 500,
  region: "US",
  maxResults: 30,
};

/** 验证选品条件 */
export function validateCriteria(input: unknown): DiscoveryCriteria {
  const o = (input ?? {}) as Record<string, unknown>;
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 10)
    : [];
  if (keywords.length === 0) {
    throw new Error("至少需要 1 个关键词");
  }
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const minRating = num(o.minRating);
  if (minRating !== null && (minRating < 1 || minRating > 5)) {
    throw new Error("minRating 必须在 1-5 之间");
  }
  const opportunityMode = o.opportunityMode === true;
  const oppMinReviews = num(o.opportunityMinReviews) ?? 2000;
  const oppMinRating = num(o.opportunityMinRating) ?? 3.0;
  const oppMaxRating = num(o.opportunityMaxRating) ?? 4.0;
  if (oppMinRating < 1 || oppMinRating > 5 || oppMaxRating < 1 || oppMaxRating > 5) {
    throw new Error("机会品评分区间必须在 1-5 之间");
  }
  if (oppMaxRating <= oppMinRating) {
    throw new Error("机会品评分上限必须大于下限");
  }
  return {
    keywords,
    minPrice: num(o.minPrice),
    maxPrice: num(o.maxPrice),
    minRating,
    minReviews: num(o.minReviews),
    region:
      typeof o.region === "string" && o.region.trim()
        ? o.region.trim().toUpperCase()
        : "US",
    maxResults: Math.min(Math.max(num(o.maxResults) ?? 30, 5), 100),
    opportunityMode,
    opportunityMinReviews: oppMinReviews,
    opportunityMinRating: oppMinRating,
    opportunityMaxRating: oppMaxRating,
  };
}

/** 对单个产品打分并生成推荐理由 */
export function scoreAndExplain(
  p: AmazonProduct,
  opportunityMode = false
): ScoredProduct {
  const score = scoreAmazonProduct(p);
  const estimatedCommission =
    p.price !== null && p.price > 0 ? Math.round(p.price * 0.04 * 100) / 100 : null;
  const reasons: string[] = [];
  if (p.rating !== null && p.rating >= 4.3) {
    reasons.push(`评分 ${p.rating}（高口碑）`);
  }
  if (p.reviewCount !== null && p.reviewCount >= 1000) {
    reasons.push(`${p.reviewCount} 条评论（市场验证）`);
  }
  if (p.price !== null && p.price >= 50 && p.price <= 200) {
    reasons.push(`$${p.price} 价格带（佣金绝对值可观）`);
  }
  if (p.isPrime) reasons.push("Prime 配送（转化率高）");
  if (p.availability && /in stock/i.test(p.availability)) {
    reasons.push("有现货");
  }
  if (estimatedCommission !== null) {
    reasons.push(`预估佣金 $${estimatedCommission}`);
  }
  // 第八批：机会品标注（基于评分分布的推断，非评论原文解读）
  const opportunity = opportunityMode;
  if (opportunity) {
    reasons.push(
      "高需求 + 低满意度：评论数大但评分偏低（基于评分分布的推断，非评论原文解读），适合推高口碑替代品"
    );
  }
  return { ...p, score, estimatedCommission, reasons, opportunity };
}

/** 过滤不达标产品 */
export function filterProducts(
  products: AmazonProduct[],
  criteria: DiscoveryCriteria
): AmazonProduct[] {
  return products.filter((p) => {
    if (!p.asin || !p.title) return false;
    if (criteria.opportunityMode) {
      // 第八批：机会品模式 — 高评论数 + 评分偏低（阈值可调）
      const minR = criteria.opportunityMinReviews ?? 2000;
      const lo = criteria.opportunityMinRating ?? 3.0;
      const hi = criteria.opportunityMaxRating ?? 4.0;
      if (p.reviewCount === null || p.reviewCount < minR) return false;
      if (p.rating === null || p.rating < lo || p.rating >= hi) return false;
    } else {
      if (criteria.minRating !== null && criteria.minRating !== undefined) {
        if (p.rating === null || p.rating < criteria.minRating) return false;
      }
      if (criteria.minReviews !== null && criteria.minReviews !== undefined) {
        if (p.reviewCount === null || p.reviewCount < criteria.minReviews) return false;
      }
    }
    if (criteria.minPrice !== null && criteria.minPrice !== undefined) {
      if (p.price === null || p.price < criteria.minPrice) return false;
    }
    if (criteria.maxPrice !== null && criteria.maxPrice !== undefined) {
      if (p.price === null || p.price > criteria.maxPrice) return false;
    }
    // 必须有现货
    if (p.availability && /out of stock|unavailable/i.test(p.availability)) {
      return false;
    }
    return true;
  });
}

/** 流量门评估只跑打分最高的 N 个产品，避免一次 discovery 打几十个外部请求 */
export const TRAFFIC_GATE_TOP_N = 10;
/** 流量门评估并发上限（手写 semaphore，不引新依赖） */
const TRAFFIC_GATE_CONCURRENCY = 3;

/**
 * 对 top N 产品并行跑流量需求门评估（并发上限 3）。
 * 单个产品评估异常只污染该产品自身（passed=null），绝不让整个 discovery 失败。
 * evaluateTrafficGate 按契约内部永不抛错，这里的 try/catch 是双保险。
 */
async function attachTrafficGates(
  scored: ScoredProduct[],
  criteria: DiscoveryCriteria,
  thresholds: TrafficThresholds,
  prisma: PrismaClient
): Promise<void> {
  const top = scored.slice(0, TRAFFIC_GATE_TOP_N);
  if (top.length === 0) return;
  const keywords = criteria.keywords.slice(0, 2);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < top.length) {
      const i = cursor++;
      const p = top[i];
      const brand = p.brand ?? null;
      try {
        p.trafficGate = await evaluateTrafficGate({
          brand,
          title: p.title,
          keywords,
          thresholds,
          prisma,
        });
      } catch (e) {
        p.trafficGate = {
          passed: null,
          reason:
            "流量门评估异常：" + (e instanceof Error ? e.message : String(e)),
          officialSite: null,
          signals: [],
          caution: null,
        };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(TRAFFIC_GATE_CONCURRENCY, top.length) },
      () => worker()
    )
  );
}

/**
 * 执行一次选品发现。
 * apiKey: "AccessKey|SecretKey|PartnerTag|Region" 格式的解密后凭证。
 */
export async function runDiscovery(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  apiKey: string,
  criteriaInput: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<DiscoveryResult> {
  const criteria = validateCriteria(criteriaInput);
  const creds = parseAmazonCredentials(apiKey);
  if (criteria.region) creds.region = criteria.region;

  // 流量门阈值：一次取出，存入 criteria 便于历史追溯，同时传给 gate
  const trafficThresholds = await getTrafficThresholds(prisma);
  criteria.trafficThresholds = trafficThresholds;

  const runId = randomUUID();
  const allProducts: AmazonProduct[] = [];
  const errors: string[] = [];

  // 每个关键词搜一次（PA-API 每次最多 10 个）
  for (const kw of criteria.keywords) {
    try {
      const products = await searchAmazonProducts(
        creds,
        {
          keywords: kw,
          minPrice: criteria.minPrice ?? undefined,
          maxPrice: criteria.maxPrice ?? undefined,
          itemCount: 10,
        },
        fetchImpl
      );
      allProducts.push(...products);
    } catch (e) {
      errors.push(`关键词 "${kw}" 搜索失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    // PA-API 限流：每次请求间隔 1 秒
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 去重（按 ASIN）
  const seen = new Set<string>();
  const deduped = allProducts.filter((p) => {
    if (seen.has(p.asin)) return false;
    seen.add(p.asin);
    return true;
  });

  // 过滤 + 打分 + 排序
  const filtered = filterProducts(deduped, criteria);
  const scored = filtered
    .map((p) => scoreAndExplain(p, criteria.opportunityMode === true))
    .sort((a, b) => b.score - a.score)
    .slice(0, criteria.maxResults ?? 30);

  // 流量需求门：只评估 top N，并发上限 3，异常不影响主流程
  await attachTrafficGates(scored, criteria, trafficThresholds, prisma);

  // 持久化（用 raw SQL 存 JSON，避免大 schema 变更）
  await prisma.$executeRawUnsafe(
    `INSERT INTO amazon_discoveries (id, tenant_id, user_id, run_id, criteria, products, total_found, total_kept, errors, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb, NOW())`,
    randomUUID(),
    tenantId,
    userId,
    runId,
    JSON.stringify(criteria),
    JSON.stringify(scored),
    deduped.length,
    scored.length,
    JSON.stringify(errors)
  );

  return {
    runId,
    criteria,
    products: scored,
    totalFound: deduped.length,
    totalKept: scored.length,
    errors,
  };
}

/** 获取历史发现记录 */
export async function listDiscoveries(
  prisma: PrismaClient,
  tenantId: string,
  limit = 10
): Promise<Array<{ runId: string; createdAt: string; totalKept: number; criteria: DiscoveryCriteria }>> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ run_id: string; created_at: string; total_kept: number; criteria: string }>
  >(
    `SELECT run_id, created_at::text, total_kept, criteria::text
     FROM amazon_discoveries WHERE tenant_id = $1::uuid
     ORDER BY created_at DESC LIMIT $2`,
    tenantId,
    limit
  );
  return rows.map((r) => ({
    runId: r.run_id,
    createdAt: r.created_at,
    totalKept: r.total_kept,
    criteria: JSON.parse(r.criteria) as DiscoveryCriteria,
  }));
}

/** 获取某次发现的产品列表 */
export async function getDiscoveryProducts(
  prisma: PrismaClient,
  tenantId: string,
  runId: string
): Promise<ScoredProduct[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ products: string }>>(
    `SELECT products::text FROM amazon_discoveries
     WHERE tenant_id = $1::uuid AND run_id = $2::uuid`,
    tenantId,
    runId
  );
  if (rows.length === 0) return [];
  return JSON.parse(rows[0].products) as ScoredProduct[];
}
