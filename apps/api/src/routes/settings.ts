/**
 * 每租户系统设置（对标 autoads 系统设置 /settings）。
 *
 * GET  /api/v1/settings            — 全部区块（密钥只返回「已配置」布尔/个数）
 * PUT  /api/v1/settings/ai        — AI 引擎（服务商/模型/端点/Key；Key 为空=保持原值）
 * DELETE /api/v1/settings/ai      — 清空 AI 配置
 * POST /api/v1/settings/ai/test   — 验证 AI 连接（用提交值或已存值）
 * PUT  /api/v1/settings/ads       — 广告发布（MCC 列表，整表替换）
 * PUT  /api/v1/settings/proxies   — 代理 URL 列表（整表替换，每条加密）
 * PUT  /api/v1/settings/system     — 系统偏好（货币/链接检查）
 *
 * 读取：租户内任何登录用户；写入：租户管理员（owner/admin 等价）及以上。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import { requireSession } from "./auth.js";
import { isAdminRole } from "../auth/rbac.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import {
  AI_PROVIDER_MODELS,
  DEFAULT_SYSTEM_SETTING,
  deleteTenantSetting,
  deriveAiEndpoint,
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

export interface SettingsRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

async function requireTenantOwner(
  deps: SettingsRouteDeps,
  request: FastifyRequest
): Promise<{ tenantId: string }> {
  const info = await requireSession(deps, request);
  if (!isAdminRole(info.role)) {
    throw new AppError("Tenant admin access required", {
      code: "FORBIDDEN",
      statusCode: 403,
    });
  }
  return { tenantId: info.tenantId };
}

export async function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRouteDeps
): Promise<void> {
  const { prisma } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get("/api/v1/settings", async (request) => {
    const info = await requireSession(deps, request);
    const tenantId = info.tenantId;
    const [ai, ads, proxies, system] = await Promise.all([
      getTenantSettingValue<TenantAiSetting>(prisma, tenantId, "ai"),
      getTenantSettingValue<TenantAdsSetting>(prisma, tenantId, "ads"),
      getTenantSettingValue<TenantProxiesSetting>(prisma, tenantId, "proxies"),
      getTenantSettingValue<TenantSystemSetting>(prisma, tenantId, "system"),
    ]);
    return {
      ai: maskAi(ai),
      ads: maskAds(ads),
      proxies: maskProxies(proxies),
      system: system ?? DEFAULT_SYSTEM_SETTING,
      aiModels: AI_PROVIDER_MODELS,
    };
  });

  app.put("/api/v1/settings/ai", async (request) => {
    const { tenantId } = await requireTenantOwner(deps, request);
    const body = (request.body ?? {}) as {
      provider?: unknown;
      model?: unknown;
      endpoint?: unknown;
      apiKey?: unknown;
    };
    const { provider, model, endpoint } = validateAiInput(body);
    const apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : undefined;
    if (!apiKey) {
      const existing = await getTenantSettingValue<TenantAiSetting>(
        prisma,
        tenantId,
        "ai"
      );
      if (!existing?.apiKeyEnc) {
        throw new AppError("API Key is required on first save", {
          code: "VALIDATION_ERROR",
          statusCode: 400,
        });
      }
    }
    const saved = await saveTenantAi(
      prisma,
      tenantId,
      { provider, model, endpoint } as {
        provider: AiProvider;
        model: string;
        endpoint?: string;
      },
      apiKey
    );
    return { ai: maskAi(saved) };
  });

  app.delete("/api/v1/settings/ai", async (request) => {
    const { tenantId } = await requireTenantOwner(deps, request);
    await deleteTenantSetting(prisma, tenantId, "ai");
    return { ok: true };
  });

  app.post("/api/v1/settings/ai/test", async (request) => {
    const { tenantId } = await requireTenantOwner(deps, request);
    const body = (request.body ?? {}) as {
      provider?: unknown;
      model?: unknown;
      endpoint?: unknown;
      apiKey?: unknown;
    };
    // 提交值优先；否则用已存配置。
    let provider = body.provider as AiProvider | undefined;
    let model = typeof body.model === "string" ? body.model.trim() : "";
    let endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    let apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : null;
    if (!provider || !model || !apiKey) {
      const stored = await getTenantSettingValue<TenantAiSetting>(
        prisma,
        tenantId,
        "ai"
      );
      if (!stored) {
        return { ok: false, message: "AI 未配置：请先填写服务商、模型与 API Key" };
      }
      provider = provider ?? stored.provider;
      model = model || stored.model;
      endpoint = endpoint || deriveAiEndpoint(stored);
      if (!apiKey && stored.apiKeyEnc) {
        try {
          apiKey = decryptSecret(
            stored.apiKeyEnc,
            assertAiSettingsPepperConfigured()
          );
        } catch {
          apiKey = null;
        }
      }
    }
    if (provider === "relay" && !/^https?:\/\//i.test(endpoint)) {
      return { ok: false, message: "第三方中转需要填写有效的 http(s) 端点" };
    }
    if (!provider || !model || !apiKey) {
      return { ok: false, message: "AI 未配置：请先填写服务商、模型与 API Key" };
    }
    const cleanBase = endpoint.replace(/\/+$/, "");
    const started = Date.now();
    let res: Response;
    try {
      res = await fetchImpl(`${cleanBase}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: `连接失败：${msg.slice(0, 140)}（可能是服务器连不上该域名或被机房屏蔽）`,
      };
    }
    const latencyMs = Date.now() - started;
    if (res.status === 401) {
      return {
        ok: false,
        latencyMs,
        httpStatus: 401,
        message: "网络通了，但 API Key 无效（401）。请检查 key 是否复制完整。",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        httpStatus: res.status,
        message: `服务端返回 ${res.status}，请检查端点与 Key 是否匹配该服务商。`,
      };
    }
    return { ok: true, latencyMs, message: `连接成功（${latencyMs}ms）` };
  });

  app.put("/api/v1/settings/ads", async (request) => {
    const { tenantId } = await requireTenantOwner(deps, request);
    const body = (request.body ?? {}) as { mccs?: unknown };
    const mccs = validateMccList(body.mccs);
    await setTenantSettingValue(prisma, tenantId, "ads", {
      mccs,
    } satisfies TenantAdsSetting);
    return { ads: maskAds({ mccs }) };
  });

  app.put("/api/v1/settings/proxies", async (request) => {
    const { tenantId } = await requireTenantOwner(deps, request);
    const body = (request.body ?? {}) as { urls?: unknown };
    if (!Array.isArray(body.urls)) {
      throw new AppError("urls must be an array of strings", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    const plain = body.urls
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter(Boolean);
    const count = await saveTenantProxies(prisma, tenantId, plain);
    return { proxies: { count } };
  });

  app.put("/api/v1/settings/system", async (request) => {
    const { tenantId } = await requireTenantOwner(deps, request);
    const body = (request.body ?? {}) as {
      defaultCurrency?: unknown;
      linkCheckEnabled?: unknown;
      linkCheckHour?: unknown;
      linkCheckMinute?: unknown;
    };
    const next = validateSystemInput(body);
    await setTenantSettingValue(prisma, tenantId, "system", next);
    return { system: next };
  });
}
