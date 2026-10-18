/**
 * POST /api/v1/traffic/gate 单测：
 * domain 跳过检测、三无参数 400、keywords 超限 400、
 * 限流 429（mock redis）、成功路径结构完整、Redis 异常时 fail-open。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";

vi.mock("../traffic/thresholds.js", () => ({
  getTrafficThresholds: vi.fn(),
  saveTrafficThresholds: vi.fn(),
}));
vi.mock("../traffic/gate.js", () => ({
  evaluateTrafficGate: vi.fn(),
}));

import { getTrafficThresholds } from "../traffic/thresholds.js";
import { evaluateTrafficGate } from "../traffic/gate.js";
import { registerTrafficRoutes } from "./traffic.js";
import type { TrafficThresholds } from "../traffic/types.js";

const mockGetThresholds = vi.mocked(getTrafficThresholds);
const mockEvaluate = vi.mocked(evaluateTrafficGate);

const THRESHOLDS: TrafficThresholds = {
  officialSiteMonthlyVisits: 50000,
  brandInterest: 25,
  keywordInterest: 25,
  organicTrafficMin: 1000,
  paidTrafficWarnRatio: 0.05,
};

const CANNED_RESULT = {
  passed: true as boolean | null,
  reason: "流量门通过：官网月访问量（SimilarWeb 付费 API）：120,000（阈值 50,000）。",
  officialSite: { found: true, domain: "anker.com", confidence: "medium" as const },
  signals: [
    {
      source: "similarweb" as const,
      label: "官网月访问量（SimilarWeb 付费 API）",
      value: 120000,
      threshold: 50000,
      passed: true as boolean | null,
    },
  ],
};

function makeRedis() {
  return {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
}

async function buildApp(redis?: ReturnType<typeof makeRedis>) {
  const fakePrisma = {} as unknown as PrismaClient;
  const app = Fastify({ logger: false });
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u1",
      email: "user@example.com",
      name: "user",
      role: "user",
      tenantId: "t-rate",
    };
    done();
  });
  registerTrafficRoutes(app, { prisma: fakePrisma, redis });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetThresholds.mockResolvedValue({ ...THRESHOLDS });
  mockEvaluate.mockResolvedValue(JSON.parse(JSON.stringify(CANNED_RESULT)));
});

describe("POST /api/v1/traffic/gate", () => {
  it("成功路径：返回完整 TrafficGateResult 结构", async () => {
    const app = await buildApp(makeRedis());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/gate",
      payload: { brand: "Anker", keywords: ["power bank"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.passed).toBe(true);
    expect(typeof body.reason).toBe("string");
    expect(body.officialSite).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "medium",
    });
    expect(Array.isArray(body.signals)).toBe(true);
    // geo 默认 US；阈值透传
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "Anker",
        keywords: ["power bank"],
        geo: "US",
        thresholds: THRESHOLDS,
      })
    );
  });

  it("domain 参数透传给 gate（跳过检测由 gate 负责）", async () => {
    const app = await buildApp(makeRedis());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/gate",
      payload: { domain: "anker.com", geo: "GB" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "anker.com", geo: "GB" })
    );
  });

  it("brand/domain/keywords 全空 → 400", async () => {
    const app = await buildApp(makeRedis());
    for (const payload of [{}, { brand: "  " }, { keywords: [] }]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/traffic/gate",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("keywords 超过 5 个 → 400", async () => {
    const app = await buildApp(makeRedis());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/gate",
      payload: { keywords: ["a", "b", "c", "d", "e", "f"] },
    });
    expect(res.statusCode).toBe(400);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("超限 → 429（key 含 tenantId 与分钟戳）", async () => {
    const redis = makeRedis();
    redis.incr.mockResolvedValue(21);
    const app = await buildApp(redis);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/gate",
      payload: { brand: "Anker" },
    });
    expect(res.statusCode).toBe(429);
    expect(mockEvaluate).not.toHaveBeenCalled();
    const key = redis.incr.mock.calls[0]?.[0] as string;
    expect(key.startsWith("traffic:ratelimit:t-rate:")).toBe(true);
  });

  it("Redis 异常时 fail-open，直接放行", async () => {
    const redis = makeRedis();
    redis.incr.mockRejectedValue(new Error("redis down"));
    const app = await buildApp(redis);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/gate",
      payload: { brand: "Anker" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEvaluate).toHaveBeenCalled();
  });
});
