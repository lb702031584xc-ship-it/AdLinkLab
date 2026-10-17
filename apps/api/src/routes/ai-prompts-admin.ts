/**
 * P1-18：提示词 DB 化 — 管理 API（admin/owner）。
 *
 * - GET /api/v1/admin/ai-prompts — 列出全部提示词行（key/version/isActive）。
 * - PUT /api/v1/admin/ai-prompts/:key — 二选一：
 *   · { content, version } → 新建版本行并设为 active（旧 active 全部 deactivate）；
 *   · { version }（无 content）→ 切换 active 到已有版本。
 *   version 在同一 key 下必须唯一；编辑永不原地覆盖旧行（可回滚）。
 * - Prompt 文案改动 ⇒ bump PROMPT_VERSION（P0-6 规则）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import {
  activatePromptVersion,
  PROMPT_KEYS,
  upsertPromptVersion,
} from "../ai/prompts-store.js";

export interface AiPromptsAdminDeps {
  prisma: PrismaClient;
}

async function requireAdmin(
  deps: AiPromptsAdminDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  if (info.role !== "admin" && info.role !== "owner") {
    throw new ForbiddenError("Admin access required");
  }
  return info;
}

export async function registerAiPromptsAdminRoutes(
  app: FastifyInstance,
  deps: AiPromptsAdminDeps
): Promise<void> {
  const { prisma } = deps;

  app.get("/api/v1/admin/ai-prompts", async (request) => {
    await requireAdmin(deps, request);
    const rows = await prisma.aiPrompt.findMany({
      orderBy: [{ key: "asc" }, { updatedAt: "desc" }],
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        version: r.version,
        isActive: r.isActive,
        updatedAt: r.updatedAt,
        contentPreview: r.content.slice(0, 200),
      })),
    };
  });

  app.get<{
    Params: { key: string };
  }>("/api/v1/admin/ai-prompts/:key", async (request) => {
    await requireAdmin(deps, request);
    const key = request.params.key;
    if (!PROMPT_KEYS.includes(key as (typeof PROMPT_KEYS)[number])) {
      throw new ValidationError(`unknown prompt key: ${key}`);
    }
    const rows = await prisma.aiPrompt.findMany({
      where: { key },
      orderBy: { updatedAt: "desc" },
    });
    return { items: rows };
  });

  app.put<{
    Params: { key: string };
    Body: { content?: unknown; version?: unknown };
  }>("/api/v1/admin/ai-prompts/:key", async (request) => {
    await requireAdmin(deps, request);
    const key = request.params.key;
    if (!PROMPT_KEYS.includes(key as (typeof PROMPT_KEYS)[number])) {
      throw new ValidationError(`unknown prompt key: ${key}`);
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const version = typeof body.version === "string" ? body.version.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    try {
      if (content) {
        if (!version) throw new ValidationError("version is required when content is provided");
        const row = await upsertPromptVersion(prisma, key, version, content);
        return { ...row, created: true };
      }
      if (!version) {
        throw new ValidationError("provide content + version to create, or version to activate");
      }
      const row = await activatePromptVersion(prisma, key, version);
      return { ...row, created: false };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(err instanceof Error ? err.message : "prompt update failed");
    }
  });
}
