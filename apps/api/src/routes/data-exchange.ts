/**
 * P1-27：导出脱敏 + 受保护 Token。
 *
 * - POST /api/v1/data/export { kind: offers | campaigns | settings, includeSensitive? }
 *   默认脱敏：任何键名命中 token/secret/password/apiKey/credential/privateKey/auth
 *   或以 Enc 结尾的字段，值替换为 "[REDACTED]"。只有显式传 includeSensitive: true
 *   才返回真实值（settings 导出仅限 admin/owner）。
 * - POST /api/v1/data/import { kind, data }
 *   只接受本系统导出的 JSON（exportedBy === "AdLinkLab" 且 version === 1）。
 *   受保护 Token 一律跳过并在 skippedProtected 中上报，绝不导入（需重新 OAuth /
 *   重新填密钥）。kind=settings / campaigns 只做 validate-only：报告哪些会导入、
 *   哪些被跳过，不实际应用。kind=offers 可经 OfferService 创建。
 *
 * 分类（写入文档与响应 note）：
 * - google_ads：部分可导入（campaigns 不同步回 Google，只做校验）；
 * - ai / proxy / system：设置类 validate-only。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import type { OfferService } from "../services/offer-engine.js";

export interface DataExchangeDeps {
  prisma: PrismaClient;
  offers: OfferService;
}

async function requireAdmin(
  deps: DataExchangeDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  // P2-5 兼容：owner 与 admin 同为管理员等价。
  if (info.role !== "admin" && info.role !== "owner") {
    throw new ForbiddenError("Admin access required");
  }
  return info;
}

const EXPORT_VERSION = 1;
const REDACTED = "[REDACTED]";

/** 受保护字段：密钥/Token 类键名，或 Enc 后缀的加密字段。 */
const PROTECTED_KEY_RE =
  /(token|secret|password|api[-_]?key|apikey|credential|private[-_]?key|auth|pepper)/i;

export function isProtectedKey(key: string): boolean {
  return PROTECTED_KEY_RE.test(key) || key.endsWith("Enc");
}

/** 递归脱敏：命中受保护键的值替换为 [REDACTED]。 */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isProtectedKey(k) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

const KINDS = ["offers", "campaigns", "settings"] as const;

export async function registerDataExchangeRoutes(
  app: FastifyInstance,
  deps: DataExchangeDeps
): Promise<void> {
  const { prisma, offers } = deps;

  app.post<{
    Body: { kind?: unknown; includeSensitive?: unknown };
  }>("/api/v1/data/export", async (request) => {
    const info = await requireAdmin(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const kind = String(body.kind ?? "");
    if (!(KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError("kind must be offers, campaigns or settings");
    }
    const includeSensitive = body.includeSensitive === true;
    let items: unknown[] = [];
    if (kind === "offers") {
      const rows = await prisma.offer.findMany({
        where: { tenantId: info.tenantId },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      items = rows.map((o) => ({
        id: o.id,
        name: o.name,
        network: o.network,
        source: o.source,
        destinationUrl: o.destinationUrl,
        status: o.status,
        commissionType: o.commissionType,
        commissionValue: o.commissionValue ? Number(o.commissionValue) : null,
        avgPrice: o.avgPrice ? Number(o.avgPrice) : null,
        brandName: o.brandName,
        brandNameSource: o.brandNameSource,
        brandNameConfidence: o.brandNameConfidence,
        festivalTheme: o.festivalTheme,
      }));
    } else if (kind === "campaigns") {
      const rows = await prisma.campaign.findMany({
        where: { tenantId: info.tenantId },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      items = rows.map((c) => ({
        id: c.id,
        googleAccountId: c.googleAccountId,
        googleCampaignId: c.googleCampaignId,
        name: c.name,
        status: c.status,
      }));
    } else {
      const rows = await prisma.aiSetting.findMany({ orderBy: { key: "asc" } });
      items = rows.map((s) => ({
        key: s.key,
        // 默认脱敏；显式 includeSensitive 才返回真实值。
        value: includeSensitive || !isProtectedKey(s.key) ? s.value : REDACTED,
        redacted: !includeSensitive && isProtectedKey(s.key),
      }));
    }
    const payload = {
      exportedBy: "AdLinkLab",
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      kind,
      sensitiveIncluded: includeSensitive,
      items: includeSensitive ? items : items.map(redactValue),
    };
    return payload;
  });

  app.post<{
    Body: { kind?: unknown; data?: unknown };
  }>("/api/v1/data/import", async (request) => {
    const info = await requireAdmin(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const kind = String(body.kind ?? "");
    if (!(KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError("kind must be offers, campaigns or settings");
    }
    const data = body.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") {
      throw new ValidationError("data must be an object");
    }
    // 只接受本系统导出的 JSON。
    if (data.exportedBy !== "AdLinkLab" || data.version !== EXPORT_VERSION) {
      throw new ValidationError(
        "data must be an AdLinkLab export (exportedBy=AdLinkLab, version=1)"
      );
    }
    if (data.kind !== kind) {
      throw new ValidationError("data.kind must match kind");
    }
    if (!Array.isArray(data.items)) {
      throw new ValidationError("data.items must be an array");
    }
    const items = data.items as Record<string, unknown>[];

    if (kind === "settings") {
      // validate-only：报告会导入哪些、跳过哪些受保护键，不实际应用。
      const wouldImport: string[] = [];
      const skippedProtected: string[] = [];
      for (const item of items) {
        const key = typeof item.key === "string" ? item.key : "";
        if (!key) continue;
        if (isProtectedKey(key)) skippedProtected.push(key);
        else wouldImport.push(key);
      }
      return {
        kind,
        applied: false,
        mode: "validate-only",
        note: "settings 导入为 validate-only：受保护 Token 永不导入，需重新 OAuth / 重新填密钥；非敏感设置请在 AI 设置页手动确认后应用。",
        wouldImport,
        skippedProtected,
        created: 0,
        skipped: skippedProtected.length,
      };
    }

    if (kind === "campaigns") {
      // validate-only：campaigns 由 Google 同步而来，不从导入创建。
      return {
        kind,
        applied: false,
        mode: "validate-only",
        note: "campaigns 为 Google Ads 同步数据，不从导入创建；请用同步恢复。",
        wouldImport: [] as string[],
        skippedProtected: [] as string[],
        created: 0,
        skipped: items.length,
      };
    }

    // kind=offers：经 OfferService 创建；受保护字段不存在于 Offer 导出中，
    // 但任何命中受保护键的字段仍跳过并上报。
    let created = 0;
    let replayed = 0;
    const skipped: Array<{ index: number; reason: string }> = [];
    const skippedProtected: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const protectedKeys = Object.keys(item).filter(isProtectedKey);
      if (protectedKeys.length > 0) {
        skippedProtected.push(...protectedKeys);
      }
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const network = typeof item.network === "string" ? item.network.trim() : "";
      const destinationUrl =
        typeof item.destinationUrl === "string" ? item.destinationUrl.trim() : "";
      if (!name || !network || !destinationUrl) {
        skipped.push({ index: i, reason: "missing name, network or destinationUrl" });
        continue;
      }
      try {
        const res = await offers.create({
          tenantId: info.tenantId,
          name,
          network,
          source:
            item.source === "amazon" || item.source === "cashback"
              ? (item.source as "amazon" | "cashback")
              : "affiliate",
          destinationUrl,
          commissionValue:
            typeof item.commissionValue === "number" ? item.commissionValue : undefined,
          commissionType:
            typeof item.commissionType === "string" ? item.commissionType : undefined,
          avgPrice: typeof item.avgPrice === "number" ? item.avgPrice : undefined,
          brandName: typeof item.brandName === "string" ? item.brandName : undefined,
          brandNameSource:
            typeof item.brandNameSource === "string" ? item.brandNameSource : undefined,
          brandNameConfidence:
            typeof item.brandNameConfidence === "number" ? item.brandNameConfidence : undefined,
          festivalTheme:
            typeof item.festivalTheme === "string" ? item.festivalTheme : undefined,
        });
        if (res.replayed) replayed++;
        else created++;
      } catch (err) {
        skipped.push({
          index: i,
          reason: err instanceof Error ? err.message : "create failed",
        });
      }
    }
    return {
      kind,
      applied: true,
      mode: "create",
      note: "offers 已经 OfferService 创建；受保护 Token 字段（如有）已跳过并上报。",
      wouldImport: [] as string[],
      skippedProtected: [...new Set(skippedProtected)],
      created,
      replayed,
      skipped,
    };
  });
}
