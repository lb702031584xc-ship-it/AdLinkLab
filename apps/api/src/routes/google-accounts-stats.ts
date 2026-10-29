/**
 * Google Ads 效果数据（provider 直读，只读不写库）。
 *
 * - GET /api/v1/google-accounts/:id/campaign-stats?startDate&endDate[&campaignIds]
 *   账号归属租户内校验；日期必填 YYYY-MM-DD 且 start <= end；
 *   campaignIds 为可选的 Google 系列 ID 逗号串（数字）。
 *   返回 provider 种类（mock = 模拟数据，api = 真实接口）+ 按系列聚合的
 *   展示 / 点击 / 花费（微单位）/ 转化。零活动系列在区间内无行返回，
 *   前端以系列清单左连接补零。
 *
 * 与 GET /api/v1/campaigns/stats 区分：后者是站内库聚合（广告组/追踪链/
 * 点击/转化），本接口是 Google Ads API 的效果数。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import type { GoogleAdsStatsService } from "../services/google-ads-stats.js";

export interface GoogleAccountsStatsDeps {
  prisma: PrismaClient;
  googleAdsStats: GoogleAdsStatsService;
}

async function requireSession(
  deps: GoogleAccountsStatsDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_ID_RE = /^\d+$/;

export async function registerGoogleAccountsStatsRoutes(
  app: FastifyInstance,
  deps: GoogleAccountsStatsDeps
): Promise<void> {
  app.get<{
    Params: { id: string };
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignIds?: string;
    };
  }>("/api/v1/google-accounts/:id/campaign-stats", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) {
      throw new ValidationError("id must be a UUID");
    }
    const startDate = request.query.startDate ?? "";
    const endDate = request.query.endDate ?? "";
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      throw new ValidationError("startDate and endDate must be YYYY-MM-DD");
    }
    if (startDate > endDate) {
      throw new ValidationError("startDate must not be after endDate");
    }
    const campaignIds = (request.query.campaignIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of campaignIds) {
      if (!NUMERIC_ID_RE.test(id)) {
        throw new ValidationError("campaignIds must be numeric Google campaign ids");
      }
    }
    const result = await deps.googleAdsStats.getCampaignStats({
      tenantId: info.tenantId,
      googleAccountId: request.params.id,
      startDate,
      endDate,
      campaignIds: campaignIds.length > 0 ? campaignIds : undefined,
    });
    return result;
  });
}
