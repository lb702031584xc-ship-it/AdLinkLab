/**
 * Amazon 自动选品 API。
 *
 * - POST /api/v1/amazon/discover — 执行一次选品发现（需 PA-API 凭证）
 * - GET  /api/v1/amazon/discoveries — 历史发现记录
 * - GET  /api/v1/amazon/discoveries/:runId — 某次发现的产品列表
 * - POST /api/v1/amazon/discoveries/:runId/import — 导入选中的产品为 Offer
 *
 * 凭证从 AiSetting 加密字段读取（key: amazon.paapiEnc），
 * 格式：AccessKey|SecretKey|PartnerTag|Region（AES 加密存储）。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  runDiscovery,
  listDiscoveries,
  getDiscoveryProducts,
  validateCriteria,
} from "../services/amazon-discovery.js";
import { decryptSecret, assertAiSettingsPepperConfigured } from "../ai/crypto.js";
import { parseAmazonUrl } from "../services/amazon-parse-url.js";

interface Deps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: Deps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

async function getPaApiKey(
  prisma: PrismaClient,
  tenantId: string
): Promise<string | null> {
  void tenantId;
  const setting = await prisma.aiSetting.findUnique({
    where: { key: "amazon.paapiEnc" },
    select: { value: true },
  });
  if (setting?.value) {
    try {
      const pepper = assertAiSettingsPepperConfigured();
      return decryptSecret(setting.value, pepper);
    } catch {
      return null;
    }
  }
  return process.env.AMAZON_PAAPI_KEY ?? null;
}

export function registerAmazonDiscoveryRoutes(
  app: FastifyInstance,
  deps: Deps
): void {
  const { prisma } = deps;

  /** 执行选品发现 */
  app.post<{
    Body: {
      keywords?: unknown;
      minPrice?: unknown;
      maxPrice?: unknown;
      minRating?: unknown;
      minReviews?: unknown;
      region?: unknown;
      maxResults?: unknown;
      opportunityMode?: unknown;
      opportunityMinReviews?: unknown;
      opportunityMinRating?: unknown;
      opportunityMaxRating?: unknown;
    };
  }>("/api/v1/amazon/discover", async (request) => {
    const session = await requireSession(deps, request);
    const apiKey = await getPaApiKey(prisma, session.tenantId);
    if (!apiKey) {
      throw new ValidationError(
        "未配置 Amazon PA-API 凭证。请在 管理 → AI 设置 中配置 Amazon PA-API（Access Key、Secret Key、Partner Tag、Region）"
      );
    }
    const criteria = validateCriteria(request.body ?? {});
    const result = await runDiscovery(
      prisma,
      session.tenantId,
      session.id,
      apiKey,
      criteria
    );
    return result;
  });

  /** 历史发现记录 */
  app.get("/api/v1/amazon/discoveries", async (request) => {
    const session = await requireSession(deps, request);
    const discoveries = await listDiscoveries(prisma, session.tenantId);
    return { discoveries };
  });

  /**
   * 解析 Amazon 产品链接：提取 ASIN + slug 产品名（纯本地解析，无外部请求）。
   * 类目排名（BSR）服务器拿不到，调用方留空手填。
   */
  app.post<{
    Body: { url?: unknown };
  }>("/api/v1/amazon/parse-url", async (request) => {
    await requireSession(deps, request);
    const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!url) {
      throw new ValidationError("请粘贴产品链接");
    }
    if (url.length > 2000) {
      throw new ValidationError("链接过长");
    }
    return parseAmazonUrl(url);
  });

  /** 某次发现的产品列表 */
  app.get<{
    Params: { runId: string };
  }>("/api/v1/amazon/discoveries/:runId", async (request) => {
    const session = await requireSession(deps, request);
    const products = await getDiscoveryProducts(
      prisma,
      session.tenantId,
      request.params.runId
    );
    if (products.length === 0) {
      throw new NotFoundError("Discovery", request.params.runId);
    }
    return { products };
  });

  /** 导入选中的产品为 Offer */
  app.post<{
    Params: { runId: string };
    Body: { asins?: unknown };
  }>("/api/v1/amazon/discoveries/:runId/import", async (request) => {
    const session = await requireSession(deps, request);
    const products = await getDiscoveryProducts(
      prisma,
      session.tenantId,
      request.params.runId
    );
    if (products.length === 0) {
      throw new NotFoundError("Discovery", request.params.runId);
    }
    const asins = Array.isArray(request.body?.asins)
      ? (request.body.asins as unknown[]).filter(
          (a): a is string => typeof a === "string"
        )
      : products.map((p) => p.asin);
    const selected = products.filter((p) => asins.includes(p.asin));
    if (selected.length === 0) {
      throw new ValidationError("未选中任何产品");
    }

    const imported: Array<{ asin: string; offerId: string }> = [];
    for (const p of selected) {
      // 生成带 PartnerTag 的联盟链接
      const tag = process.env.AMAZON_PARTNER_TAG ?? "";
      const url = tag
        ? `${p.detailPageUrl}${p.detailPageUrl.includes("?") ? "&" : "?"}tag=${tag}`
        : p.detailPageUrl;
      const offer = await prisma.offer.create({
        data: {
          id: randomUUID(),
          tenantId: session.tenantId,
          name: p.title.slice(0, 200),
          network: "amazon",
          source: "amazon",
          destinationUrl: url,
          status: "ACTIVE",
          commissionValue: p.estimatedCommission,
          commissionType: "fixed",
        },
        select: { id: true },
      });
      imported.push({ asin: p.asin, offerId: offer.id });
    }
    return { imported, count: imported.length };
  });
}
