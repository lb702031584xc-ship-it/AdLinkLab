/**
 * 管理控制台路由测试（Fastify inject）。
 *
 * 覆盖：GET /api/v1/admin/backup-status —— 非管理员 403；管理员 200 返回
 * 最近备份列表（VERIFIED 标记解析、latest-verified.json 排除、坏文件跳过）；
 * 未配置目录 / 目录不存在 → 空列表不抛 500。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@adlinklab/database";
import { registerAdminConsoleRoutes } from "./admin-console.js";

const ENV_KEY = "ADLINKLAB_BACKUP_DIR";
let savedEnv: string | undefined;

function buildApp(role: string) {
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as any).sessionAuth = {
      id: "u1",
      email: "admin@test.dev",
      name: "Admin",
      role,
      tenantId: "t1",
    };
    done();
  });
  const prisma = {} as unknown as PrismaClient;
  void registerAdminConsoleRoutes(app, { prisma });
  return app;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

function makeBackupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "adlinklab-backup-test-"));
  writeFileSync(
    join(dir, "2026-10-18T00-09-04-123Z_abc.json"),
    JSON.stringify({
      backupId: "2026-10-18T00-09-04-123Z_abc",
      createdAt: "2026-10-18T00:09:04.123Z",
      sizeBytes: 1024,
      status: "VERIFIED",
    })
  );
  writeFileSync(
    join(dir, "2026-10-17T00-09-04-123Z_def.json"),
    JSON.stringify({
      backupId: "2026-10-17T00-09-04-123Z_def",
      createdAt: "2026-10-17T00:09:04.123Z",
      sizeBytes: 512,
      status: "FAILED",
    })
  );
  // latest 指针文件必须排除
  writeFileSync(
    join(dir, "latest-verified.json"),
    JSON.stringify({ backupId: "x" })
  );
  // 坏文件跳过
  writeFileSync(join(dir, "corrupt.json"), "not json{{{");
  return dir;
}

describe("GET /api/v1/admin/backup-status", () => {
  it("非管理员 → 403", async () => {
    const app = buildApp("user");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/backup-status",
    });
    expect(res.statusCode).toBe(403);
  });

  it("管理员 → 200，解析 VERIFIED 标记并排除指针/坏文件", async () => {
    const dir = makeBackupDir();
    process.env[ENV_KEY] = dir;
    try {
      const app = buildApp("admin");
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/backup-status",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        configured: boolean;
        items: Array<{
          id: string;
          time: string;
          sizeBytes: number;
          verified: boolean;
        }>;
      };
      expect(body.configured).toBe(true);
      expect(body.items).toHaveLength(2);
      // 按时间倒序
      expect(body.items[0].id).toBe("2026-10-18T00-09-04-123Z_abc");
      expect(body.items[0].verified).toBe(true);
      expect(body.items[0].sizeBytes).toBe(1024);
      expect(body.items[1].verified).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未配置目录 → 200 空列表", async () => {
    delete process.env[ENV_KEY];
    const app = buildApp("admin");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/backup-status",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { configured: boolean; items: unknown[] };
    expect(body.configured).toBe(false);
    expect(body.items).toEqual([]);
  });

  it("目录不存在 → 200 空列表（不抛 500）", async () => {
    process.env[ENV_KEY] = join(tmpdir(), "adlinklab-backup-no-such-dir-xyz");
    const app = buildApp("admin");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/backup-status",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { configured: boolean; items: unknown[] };
    expect(body.configured).toBe(true);
    expect(body.items).toEqual([]);
  });
});
