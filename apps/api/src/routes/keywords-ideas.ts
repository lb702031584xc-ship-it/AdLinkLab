/**
 * P1-10：POST /api/v1/keywords/ideas — 规则生成关键词 ideas。
 * 无 LLM，无搜索量（avgMonthlySearches/competition 永远 null，不编造）。
 * 输入：seeds（种子词，最多 30）+ brandTerms（品牌词，最多 10）+ domain（用于规则分加成）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError, ValidationError } from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import { generateRuleIdeas } from "../services/keyword-ideas.js";
import { assessKeyword } from "../services/keyword-gate.js";

export interface KeywordIdeasRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: KeywordIdeasRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

function asStringArray(v: unknown, field: string, max: number): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ValidationError(`${field} must be an array of strings`);
  if (v.length > max) throw new ValidationError(`${field} accepts at most ${max} items`);
  for (const item of v) {
    if (typeof item !== "string") throw new ValidationError(`${field} must be an array of strings`);
  }
  return v as string[];
}

export async function registerKeywordIdeasRoutes(
  app: FastifyInstance,
  deps: KeywordIdeasRouteDeps
): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keywords/ideas",
    async (request) => {
      await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const seeds = asStringArray(body.seeds, "seeds", 30);
      if (seeds.length === 0) throw new ValidationError("seeds must be a non-empty array");
      const brandTerms = asStringArray(body.brandTerms, "brandTerms", 10);
      const domain = typeof body.domain === "string" ? body.domain : "";
      const limitPerKind =
        body.limitPerKind === undefined ? 20 : Number(body.limitPerKind);
      if (!Number.isInteger(limitPerKind) || limitPerKind < 1 || limitPerKind > 50) {
        throw new ValidationError("limitPerKind must be an integer between 1 and 50");
      }
      // 每条 idea 过关键词闸门：对比无页 / 折扣无码 / 后台代码 / 品类大词 /
      // 纯参数词 / 信息型 / 维修型 —— 结构上不可能的，直接带 reject 标记。
      const brand = brandTerms[0] ?? null;
      const ideas = generateRuleIdeas({
        seeds,
        brandTerms,
        domain,
        limitPerKind,
      }).map((idea) => {
        const g = assessKeyword(idea.keyword, { brandName: brand });
        return {
          ...idea,
          gateVerdict: g.verdict,
          gateReason: g.reason,
          gateCodes: g.codes,
        };
      });
      return {
        ideas,
        count: ideas.length,
        note: "规则生成（无 LLM）；搜索量/竞争度未连接 Keyword Planner，返回 null，不编造。",
      };
    }
  );
}
