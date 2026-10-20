/**
 * 数据管理：用户自助导出 / 导入（对标 autoads 数据管理，但按我们的架构）。
 *
 * GET  /api/v1/user-data/export?type=offers|campaigns|settings&format=json|csv
 * POST /api/v1/user-data/import  { type: "settings", data: {...} }
 *
 * 注意：/api/v1/data/export|import 已被管理员 data-exchange 占用（POST），
 * 用户自助接口必须走 /user-data/* 前缀，否则 Fastify 启动即 FST_ERR_DUPLICATED_ROUTE。
 *
 * 安全原则：
 * - 导出 Settings 时密钥一律脱敏（API Key → "已配置"/"未配置"，代理 → 条数）；
 *   永不导出明文密钥——导入时会跳过脱敏项（OAuth/refresh_token 之类我们根本不导出）。
 * - 导入仅支持 settings；用与 /settings 同一套校验器；代理必须明文才入库。
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import { requireSession } from "./auth.js";
import {
  getTenantSettingValue,
  maskAds,
  maskAi,
  maskProxies,
  saveTenantAi,
  saveTenantProxies,
  setTenantSettingValue,
  validateAiInput,
  validateMccList,
  validateSystemInput,
  type AiProvider,
  type TenantAdsSetting,
  type TenantAiSetting,
  type TenantProxiesSetting,
  type TenantSystemSetting,
} from "../services/tenant-settings.js";

export interface DataIoRouteDeps {
  prisma: PrismaClient;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

const OFFER_COLUMNS = [
  "id",
  "name",
  "network",
  "source",
  "status",
  "affiliateUrl",
  "destinationUrl",
  "payout",
  "payoutType",
  "createdAt",
];

const CAMPAIGN_COLUMNS = [
  "id",
  "name",
  "status",
  "googleCampaignId",
  "createdAt",
];

export async function registerDataIoRoutes(
  app: FastifyInstance,
  deps: DataIoRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.get("/api/v1/user-data/export", async (request) => {
    const info = await requireSession(deps, request);
    const q = request.query as Record<string, unknown>;
    const type = q.type as string;
    const format = q.format === "csv" ? "csv" : "json";
    const tenantId = info.tenantId;
    const stamp = new Date().toISOString().slice(0, 10);

    if (type === "offers") {
      const rows = await prisma.offer.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: {
          id: true,
          name: true,
          network: true,
          source: true,
          status: true,
          affiliateUrl: true,
          destinationUrl: true,
          commissionValue: true,
          commissionType: true,
          createdAt: true,
        },
      });
      const items = (rows as Array<Record<string, unknown>>).map((r) => ({
        id: r.id,
        name: r.name,
        network: r.network,
        source: r.source,
        status: r.status,
        affiliateUrl: r.affiliateUrl ?? "",
        destinationUrl: r.destinationUrl ?? "",
        payout: r.commissionValue != null ? Number(r.commissionValue) : null,
        payoutType: r.commissionType ?? "",
        createdAt: (r.createdAt as Date)?.toISOString?.() ?? "",
      }));
      if (format === "csv") {
        return {
          filename: `adlinklab-offers-${stamp}.csv`,
          mime: "text/csv;charset=utf-8",
          content: toCsv(OFFER_COLUMNS, items.map((i) => OFFER_COLUMNS.map((c) => i[c as keyof typeof i]))),
        };
      }
      return {
        filename: `adlinklab-offers-${stamp}.json`,
        mime: "application/json",
        content: JSON.stringify({ type: "offers", exportedAt: new Date().toISOString(), items }, null, 2),
      };
    }

    if (type === "campaigns") {
      const rows = await prisma.campaign.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: {
          id: true,
          name: true,
          status: true,
          googleCampaignId: true,
          createdAt: true,
        },
      });
      const items = (rows as Array<Record<string, unknown>>).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        googleCampaignId: r.googleCampaignId ?? "",
        createdAt: (r.createdAt as Date)?.toISOString?.() ?? "",
      }));
      if (format === "csv") {
        return {
          filename: `adlinklab-campaigns-${stamp}.csv`,
          mime: "text/csv;charset=utf-8",
          content: toCsv(
            CAMPAIGN_COLUMNS,
            items.map((i) => CAMPAIGN_COLUMNS.map((c) => i[c as keyof typeof i]))
          ),
        };
      }
      return {
        filename: `adlinklab-campaigns-${stamp}.json`,
        mime: "application/json",
        content: JSON.stringify({ type: "campaigns", exportedAt: new Date().toISOString(), items }, null, 2),
      };
    }

    if (type === "settings") {
      // Settings 仅支持 JSON；密钥全部脱敏。
      const [ai, ads, proxies, system] = await Promise.all([
        getTenantSettingValue<TenantAiSetting>(prisma, tenantId, "ai"),
        getTenantSettingValue<TenantAdsSetting>(prisma, tenantId, "ads"),
        getTenantSettingValue<TenantProxiesSetting>(prisma, tenantId, "proxies"),
        getTenantSettingValue<TenantSystemSetting>(prisma, tenantId, "system"),
      ]);
      const masked = maskAi(ai);
      const settings = {
        ai: {
          provider: masked.provider,
          model: masked.model,
          apiKey: masked.apiKeyConfigured ? "****" : null,
        },
        ads: { mccs: maskAds(ads).mccs.map((m) => ({ name: m.name, customerId: m.customerId, mode: m.mode })) },
        proxies: {
          count: maskProxies(proxies).count,
          urls: "****",
        },
        system: system ?? null,
      };
      return {
        filename: `adlinklab-settings-${stamp}.json`,
        mime: "application/json",
        content: JSON.stringify(
          { type: "settings", exportedAt: new Date().toISOString(), settings },
          null,
          2
        ),
      };
    }

    throw new AppError("type must be offers, campaigns or settings", {
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  });

  /**
   * 导入用户配置（Settings JSON）。仅接受本系统导出的格式；
   * 脱敏项（"****"）自动跳过；代理必须明文 URL 才入库。
   */
  app.post("/api/v1/user-data/import", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      type?: unknown;
      data?: unknown;
    };
    if (body.type !== "settings") {
      throw new AppError("only settings import is supported", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    const doc = (body.data ?? {}) as Record<string, unknown>;
    const settings = (doc.settings ?? doc) as Record<string, unknown>;
    const applied: string[] = [];
    const skipped: string[] = [];
    const tenantId = info.tenantId;

    // AI：服务商/模型可导入；apiKey 为 "****"/null/空 → 跳过（需重新填写）。
    if (settings.ai && typeof settings.ai === "object") {
      const ai = settings.ai as Record<string, unknown>;
      const { provider, model, endpoint } = validateAiInput(ai);
      const key = typeof ai.apiKey === "string" ? ai.apiKey : null;
      if (key && key !== "****") {
        await saveTenantAi(
          prisma,
          tenantId,
          { provider: provider as AiProvider, model, endpoint },
          key
        );
        applied.push("ai");
      } else {
        const existing = await getTenantSettingValue<TenantAiSetting>(prisma, tenantId, "ai");
        await saveTenantAi(prisma, tenantId, {
          provider: provider as AiProvider,
          model,
          endpoint,
        });
        // 保留原有密钥（若有），仅更新服务商/模型。
        if (existing?.apiKeyEnc) {
          const merged = await getTenantSettingValue<TenantAiSetting>(prisma, tenantId, "ai");
          if (merged) await setTenantSettingValue(prisma, tenantId, "ai", { ...merged, apiKeyEnc: existing.apiKeyEnc });
        }
        applied.push("ai");
        skipped.push("ai.apiKey（已脱敏，未变更）");
      }
    }

    // 广告发布（MCC）：无密钥，可整表导入。
    if (settings.ads && typeof settings.ads === "object") {
      const ads = settings.ads as Record<string, unknown>;
      const mccs = validateMccList(ads.mccs ?? []);
      await setTenantSettingValue(prisma, tenantId, "ads", { mccs });
      applied.push("ads");
    }

    // 代理：必须明文 URL；脱敏导出（"****"）自动跳过。
    if (settings.proxies && typeof settings.proxies === "object") {
      const px = settings.proxies as Record<string, unknown>;
      const urls = Array.isArray(px.urls) ? px.urls : [];
      const plain = urls.filter(
        (u): u is string => typeof u === "string" && u.trim() !== "" && !u.includes("****")
      );
      if (plain.length > 0) {
        await saveTenantProxies(prisma, tenantId, plain);
        applied.push("proxies");
      } else {
        skipped.push("proxies（脱敏项跳过，需在系统设置重新填写）");
      }
    }

    // 系统偏好：直接覆盖。
    if (settings.system && typeof settings.system === "object") {
      const next = validateSystemInput(settings.system as Record<string, unknown>);
      await setTenantSettingValue(prisma, tenantId, "system", next);
      applied.push("system");
    }

    return { applied, skipped };
  });
}
