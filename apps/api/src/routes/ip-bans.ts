import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { findActiveIpBan, isValidIp } from "../auth/ip-ban.js";
import { requireAdmin } from "./auth.js";

/**
 * P0-4 — Manual IP bans for the own API (admin-only, session auth).
 * Bans are global (not tenant-scoped). Auto bans are written by the
 * error-rate watcher (see auth/ip-ban.ts); this module only manages them.
 */

export interface IpBanRouteDeps {
  prisma: PrismaClient;
}

export interface PublicIpBan {
  id: string;
  ip: string;
  reason: string;
  level: string;
  expiresAt: string | null;
  requestCount: number;
  revokedAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function toPublicIpBan(
  row: {
    id: string;
    ip: string;
    reason: string;
    level: string;
    expiresAt: Date | null;
    requestCount: number;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date = new Date()
): PublicIpBan {
  return {
    id: row.id,
    ip: row.ip,
    reason: row.reason,
    level: row.level,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    requestCount: row.requestCount,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    active:
      !row.revokedAt &&
      (!row.expiresAt || row.expiresAt.getTime() > now.getTime()),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerIpBanRoutes(
  app: FastifyInstance,
  deps: IpBanRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.get("/api/v1/admin/ip-bans", async (request) => {
    await requireAdmin(deps, request);
    const rows = await prisma.ipBan.findMany({
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    return { ipBans: rows.map((row) => toPublicIpBan(row, now)) };
  });

  app.post("/api/v1/admin/ip-bans", async (request, reply) => {
    const info = await requireAdmin(deps, request);
    const body = (request.body ?? {}) as {
      ip?: unknown;
      reason?: unknown;
      expiresAt?: unknown;
    };
    const ip = typeof body.ip === "string" ? body.ip.trim() : "";
    if (!ip || !isValidIp(ip)) {
      throw new ValidationError("A valid IP address is required");
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      throw new ValidationError("Reason is required");
    }
    if (reason.length > 500) {
      throw new ValidationError("Reason must be at most 500 characters");
    }
    let expiresAt: Date | null = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
      if (typeof body.expiresAt !== "string") {
        throw new ValidationError("expiresAt must be an ISO date string");
      }
      expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ValidationError("expiresAt must be a valid date");
      }
    }

    const existing = await findActiveIpBan(prisma, ip);
    if (existing) {
      throw new ConflictError(`IP ${ip} is already banned`);
    }
    const row = await prisma.ipBan.create({
      data: {
        id: randomUUID(),
        ip,
        reason,
        level: "manual",
        expiresAt,
        requestCount: 0,
        createdBy: info.id,
      },
    });
    return reply.status(201).send({ ipBan: toPublicIpBan(row) });
  });

  app.post("/api/v1/admin/ip-bans/:id/revoke", async (request) => {
    await requireAdmin(deps, request);
    const params = request.params as { id?: string };
    const id = typeof params.id === "string" ? params.id : "";

    const row = await prisma.ipBan.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundError("IpBan", id);
    }
    if (row.revokedAt) {
      return { ok: true, alreadyRevoked: true };
    }
    await prisma.ipBan.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });
}
