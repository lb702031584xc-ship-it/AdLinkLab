/**
 * 管理控制台后端（2026-10-18）。
 *
 * 全部接口 requireAdmin（admin/owner），普通用户 403。
 *
 *   GET    /api/v1/admin/backup-status    最近备份列表（只读备份目录，不触发备份）
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { requireAdmin } from "./auth.js";
import { summarizePaidDataUsage } from "../services/paid-data-gateway.js";

export interface AdminConsoleDeps {
  prisma: PrismaClient;
}

export interface BackupStatusItem {
  id: string;
  time: string;
  sizeBytes: number;
  verified: boolean;
  status: string;
}

const MAX_ITEMS = 10;

/**
 * 备份目录口径与 infra/backup/backup-auto.sh 一致：
 * ADLINKLAB_BACKUP_DIR 优先；未配置则返回空列表（API 容器内无仓库相对路径，不猜）。
 * 路径穿越防护：目录完全来自环境变量，无任何用户输入参与路径拼接。
 */
function resolveBackupDir(): string | null {
  const configured = (process.env.ADLINKLAB_BACKUP_DIR ?? "").trim();
  return configured || null;
}

async function readBackupStatus(): Promise<{
  dir: string | null;
  configured: boolean;
  items: BackupStatusItem[];
}> {
  const dir = resolveBackupDir();
  if (!dir) return { dir: null, configured: false, items: [] };
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // 目录不可读/不存在：返回空列表，不抛 500。
    return { dir, configured: true, items: [] };
  }
  const metas = files.filter(
    (f) => f.endsWith(".json") && f !== "latest-verified.json"
  );
  const items: BackupStatusItem[] = [];
  for (const f of metas) {
    try {
      const raw = await readFile(join(dir, f), "utf8");
      const meta = JSON.parse(raw) as {
        backupId?: unknown;
        createdAt?: unknown;
        sizeBytes?: unknown;
        status?: unknown;
      };
      if (typeof meta.backupId !== "string" || !meta.backupId) continue;
      items.push({
        id: meta.backupId,
        time: typeof meta.createdAt === "string" ? meta.createdAt : "",
        sizeBytes:
          typeof meta.sizeBytes === "number" && Number.isFinite(meta.sizeBytes)
            ? meta.sizeBytes
            : 0,
        verified: meta.status === "VERIFIED",
        status: typeof meta.status === "string" ? meta.status : "UNKNOWN",
      });
    } catch {
      // 单个元数据损坏：跳过该条，不影响整体。
      continue;
    }
  }
  items.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return { dir, configured: true, items: items.slice(0, MAX_ITEMS) };
}

export async function registerAdminConsoleRoutes(
  app: FastifyInstance,
  deps: AdminConsoleDeps
): Promise<void> {
  app.get("/api/v1/admin/backup-status", async (request) => {
    await requireAdmin(deps, request);
    return readBackupStatus();
  });

  /**
   * 付费数据用量汇总（按租户 × 功能 × key 来源，近 N 天，缺省 30）：
   * 数据来自付费数据网关台账（paid_data_usages），管理员在此核对
   * 平台额度消耗与各租户自备 key 的调用量。只读，不含任何凭证。
   */
  app.get<{ Querystring: { days?: string } }>(
    "/api/v1/admin/paid-data-usage",
    async (request) => {
      await requireAdmin(deps, request);
      const daysRaw = Number(request.query.days);
      const days =
        Number.isFinite(daysRaw) && daysRaw > 0
          ? Math.min(365, Math.floor(daysRaw))
          : 30;
      return summarizePaidDataUsage(deps.prisma, days);
    }
  );
}
