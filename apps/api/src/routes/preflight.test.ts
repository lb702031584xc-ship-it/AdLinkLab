/**
 * P1-14 Preflight — 落地页可达检查必须走 SSRF 守卫的 fetchPage，
 * 绝不直连 fetch（直连可被利用探测内网 / 元数据端点）。
 * 用 vi.mock 替换 fetchPage，验证：成功 → ok；抛错（含 SSRF 拦截）→ warn 软失败。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const fetchPageMock = vi.fn();

vi.mock("../ai/fetch-page.js", () => ({
  fetchPage: (...args: unknown[]) => fetchPageMock(...args),
}));

import { registerPreflightRoutes } from "./preflight.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function fakePrisma() {
  return {
    googleAccount: {
      findFirst: async () => ({
        id: ACCOUNT_ID,
        tenantId: TENANT,
        customerId: "123-456-7890",
        accountType: "PERSONAL",
        healthStatus: "active",
        oauthCredentialRef: null,
      }),
      count: async () => 0,
    },
    googleAdsScriptIntegration: {
      findFirst: async () => null,
    },
    conversion: {
      count: async () => 0,
    },
  };
}

async function callPreflight(body: Record<string, unknown>) {
  const app = Fastify();
  await app.register(async (instance) => {
    await registerPreflightRoutes(instance, {
      prisma: fakePrisma() as never,
    });
  });
  // sessionAuth 由路由的 requireSession 直接取用，注入测试身份。
  app.addHook("onRequest", async (request) => {
    (request as unknown as { sessionAuth: unknown }).sessionAuth = {
      id: "user-1",
      tenantId: TENANT,
      role: "admin",
    };
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/ads/preflight",
    payload: body,
  });
  return { status: res.statusCode, body: res.json() as any };
}

describe("P1-14 preflight landing check uses SSRF-guarded fetchPage", () => {
  beforeEach(() => {
    fetchPageMock.mockReset();
  });

  it("fetchPage 成功 → landing_reachable ok", async () => {
    fetchPageMock.mockResolvedValue({
      finalUrl: "https://example.com/lp",
      text: "hello",
    });
    const { status, body } = await callPreflight({
      accountId: ACCOUNT_ID,
      landingUrl: "https://example.com/lp",
    });
    expect(status).toBe(200);
    expect(fetchPageMock).toHaveBeenCalledWith("https://example.com/lp");
    const check = body.checks.find((c: any) => c.key === "landing_reachable");
    expect(check.status).toBe("ok");
  });

  it("fetchPage 抛错（SSRF 拦截 / 不可达）→ landing_reachable warn 软失败，不阻塞", async () => {
    fetchPageMock.mockRejectedValue(new Error("SSRF blocked"));
    const { status, body } = await callPreflight({
      accountId: ACCOUNT_ID,
      landingUrl: "http://169.254.169.254/latest/meta-data/",
    });
    expect(status).toBe(200);
    expect(body.verdict).not.toBe("blocked");
    const check = body.checks.find((c: any) => c.key === "landing_reachable");
    expect(check.status).toBe("warn");
  });
});
