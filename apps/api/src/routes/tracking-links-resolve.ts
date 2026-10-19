/**
 * P2-7 — 只读解析：POST /api/v1/tracking-links/resolve {url}
 * → {finalUrl, chain, suffix}。
 *
 * 合规边界（硬）：
 * - 只读解析：跟随重定向到最终 URL，绝不点击、不提交、不模拟用户行为。
 * - 固定 UA `AdLinkLab-AI/1.0`（见 fetch-page），自有出口 IP；无代理池、无 UA 轮换、
 *   无指纹、无 Referer 伪造、无 Cloudflare 绕过。
 * - 尊重 robots/ToS：本接口只解析调用方提供的单个 URL（通常是自己的追踪链接），
 *   不批量爬取、不绕过反爬。
 * - B2 强制执行：仅当 URL 的可注册域名属于本租户自有域名（AI 设置 ownedDomains）
 *   或在一条有效的 B2 授权白名单内时才解析；否则 403 + 需申请提示。
 *   管理员也不能绕过白名单强制放行（走 requireActiveGrant）。
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { ValidationError } from "@adlinklab/shared";
import { requireSession } from "./auth.js";
import { fetchPage } from "../ai/fetch-page.js";
import { registrableDomain } from "../ai/compliance.js";
import {
  incrementGrantUsage,
  requireActiveGrant,
} from "../services/admin-grants.js";

export interface TrackingLinkResolveDeps {
  prisma: PrismaClient;
  fetchPageImpl?: typeof fetchPage;
}

export async function registerTrackingLinkResolveRoutes(
  app: FastifyInstance,
  deps: TrackingLinkResolveDeps
): Promise<void> {
  const { prisma } = deps;
  const fetchImpl = deps.fetchPageImpl ?? fetchPage;

  app.post<{
    Body: { url?: unknown };
  }>("/api/v1/tracking-links/resolve", async (request) => {
    const info = await requireSession(deps, request);
    const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!url) throw new ValidationError("url is required");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError("url must be a valid absolute URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("url must use http or https");
    }
    const domain = registrableDomain(parsed.hostname);

    // B2 强制执行：自有域名 或 有效 B2 授权白名单，二者居其一。
    // ownedDomains 是现有全局 AI 设置（AiSetting.key = compliance.ownedDomains，
    // 与合规检查同一来源；本租户概念上即“站点的自有域名列表”）。
    const setting = await prisma.aiSetting.findUnique({
      where: { key: "compliance.ownedDomains" },
      select: { value: true },
    });
    const owned = (setting?.value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const isOwned = owned.includes(domain.toLowerCase());
    let grantId: string | null = null;
    if (!isOwned) {
      // 非自有域名 → 必须有有效授权；无授权 → 403（requireActiveGrant 内抛）；owner 豁免。
      const grant = await requireActiveGrant(prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        capability: "tracking-link-resolve",
        whitelistValue: domain.toLowerCase(),
      });
      grantId = grant?.id ?? null;
    }

    const fetched = await fetchImpl(url);
    const finalUrl = fetched.finalUrl;
    let finalParsed: URL;
    try {
      finalParsed = new URL(finalUrl);
    } catch {
      throw new ValidationError("resolved URL is not a valid absolute URL");
    }
    // suffix = 最终 URL 的路径 + 查询（追踪链接后缀部分）；无则 ""。
    const suffix = `${finalParsed.pathname}${finalParsed.search}`;
    const chain = (fetched.redirectChain ?? []).map((hop) => ({
      url: hop.url,
      status: hop.status,
    }));

    // 授权使用计数（仅授权路径；自有域名不计）。
    if (grantId) {
      const grant = (await prisma.adminGrant.findUnique({
        where: { id: grantId },
      })) as Parameters<typeof incrementGrantUsage>[1];
      if (grant) await incrementGrantUsage(prisma, grant);
    }

    return {
      finalUrl,
      chain,
      suffix,
      hops: chain.length,
      domain,
      viaGrant: grantId !== null,
    };
  });
}

// 供测试复用：suffix 提取（最终 URL 的路径 + 查询）。
export function resolveSuffix(finalUrl: string): string {
  const u = new URL(finalUrl);
  return `${u.pathname}${u.search}`;
}
