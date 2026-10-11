/**
 * 回归测试：multipart 只能注册一次。
 *
 * 2026-10-10 线上事故：registerOfferMetricsRoutes 和 registerKeepaRoutes
 * 各自在模块内 `app.register(multipart)`，生产环境（prisma 模式）两个模块
 * 注册到同一个 Fastify 实例 → FST_ERR_DEC_ALREADY_PRESENT（multipartErrors
 * 重复添加）→ 容器启动即退出(1)，全站 502。
 *
 * 修复：multipart 只在 routes/index.ts 注册一次。本测试按生产顺序
 * （先注册 multipart，再注册两个模块）走一遍，旧代码下会直接抛错。
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { PrismaClient } from "@adlinklab/database";
import { registerKeepaRoutes } from "./keepa.js";
import { registerOfferMetricsRoutes } from "./offer-metrics.js";

const fakePrisma = {
  aiSetting: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
  },
} as unknown as PrismaClient;

const fakeRedis = {
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("multipart 单次注册（生产顺序回归）", () => {
  it("同一实例上先注册 multipart，再注册 offer-metrics + keepa，不抛 FST_ERR_DEC_ALREADY_PRESENT", async () => {
    const app = Fastify({ logger: false });
    // 与 routes/index.ts 相同的顺序和上限
    await app.register(multipart, {
      limits: { files: 3, fileSize: 8 * 1024 * 1024 },
    });
    await registerOfferMetricsRoutes(app, {
      prisma: fakePrisma,
      redis: fakeRedis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scrapeImpl: (async () => null) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ocrImpl: (async () => null) as any,
    });
    await registerKeepaRoutes(app, {
      prisma: fakePrisma,
      redis: fakeRedis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visionImpl: (async () => null) as any,
    });
    await app.ready();
    await app.close();
  });
});
