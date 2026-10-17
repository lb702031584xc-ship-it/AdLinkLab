import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  DB_API_KEY_GRACE_MS,
  generateDbApiKey,
  resolveDbApiKeyStatus,
  type DbApiKeyStatus,
} from "../auth/api-keys.js";
import { isValidIp } from "../auth/ip-ban.js";
import { requireAdmin } from "./auth.js";

/**
 * P0-3 — DB-backed API key management (admin-only, session auth).
 * Plaintext keys are returned exactly once (create / rotate) and are
 * never stored; only the SHA-256 hash + 8-char prefix live in the DB.
 */

export interface ApiKeyRouteDeps {
  prisma: PrismaClient;
}

export interface PublicApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  ipWhitelist: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  graceExpiresAt: string | null;
  lastUsedAt: string | null;
  status: DbApiKeyStatus;
  createdAt: string;
  updatedAt: string;
}

function toPublicApiKey(
  row: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    ipWhitelist: string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
    graceExpiresAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date = new Date()
): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: [...row.scopes],
    ipWhitelist: [...row.ipWhitelist],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    graceExpiresAt: row.graceExpiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    status: resolveDbApiKeyStatus(row, now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new ValidationError(`${field} must contain only non-empty strings`);
    }
    out.push(item.trim());
  }
  if (out.length > 50) {
    throw new ValidationError(`${field} must contain at most 50 entries`);
  }
  return [...new Set(out)];
}

function parseExpiresAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError("expiresAt must be an ISO date string");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("expiresAt must be a valid date");
  }
  return date;
}

export async function registerApiKeyRoutes(
  app: FastifyInstance,
  deps: ApiKeyRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.post("/api/v1/auth/api-keys", async (request, reply) => {
    const info = await requireAdmin(deps, request);
    const body = (request.body ?? {}) as {
      name?: unknown;
      scopes?: unknown;
      ipWhitelist?: unknown;
      expiresAt?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw new ValidationError("Name is required");
    }
    if (name.length > 100) {
      throw new ValidationError("Name must be at most 100 characters");
    }
    const scopes = parseStringArray(body.scopes, "scopes");
    const ipWhitelist = parseStringArray(body.ipWhitelist, "ipWhitelist");
    for (const ip of ipWhitelist) {
      if (!isValidIp(ip)) {
        throw new ValidationError(`ipWhitelist contains an invalid IP: ${ip}`);
      }
    }
    const expiresAt = parseExpiresAt(body.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new ValidationError("expiresAt must be in the future");
    }

    const generated = generateDbApiKey();
    const row = await prisma.apiKey.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        scopes,
        ipWhitelist,
        expiresAt,
      },
    });
    // The plaintext key is returned exactly once — it is never stored.
    return reply
      .status(201)
      .send({ apiKey: toPublicApiKey(row), key: generated.key });
  });

  app.get("/api/v1/auth/api-keys", async (request) => {
    const info = await requireAdmin(deps, request);
    const rows = await prisma.apiKey.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    return { apiKeys: rows.map((row) => toPublicApiKey(row, now)) };
  });

  app.post("/api/v1/auth/api-keys/:id/rotate", async (request, reply) => {
    const info = await requireAdmin(deps, request);
    const params = request.params as { id?: string };
    const id = typeof params.id === "string" ? params.id : "";
    const now = new Date();

    const old = await prisma.apiKey.findUnique({ where: { id } });
    if (!old || old.tenantId !== info.tenantId) {
      throw new NotFoundError("ApiKey", id);
    }
    if (old.revokedAt) {
      throw new ConflictError("API key is already revoked");
    }

    const generated = generateDbApiKey();
    const created = await prisma.apiKey.create({
      data: {
        id: randomUUID(),
        tenantId: old.tenantId,
        name: old.name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        scopes: old.scopes,
        ipWhitelist: old.ipWhitelist,
        expiresAt: old.expiresAt,
        rotatedFromId: old.id,
      },
    });
    // Old key stays usable through the grace window, then dies.
    await prisma.apiKey.update({
      where: { id: old.id },
      data: {
        revokedAt: now,
        graceExpiresAt: new Date(now.getTime() + DB_API_KEY_GRACE_MS),
      },
    });
    return reply
      .status(201)
      .send({ apiKey: toPublicApiKey(created, now), key: generated.key });
  });

  app.post("/api/v1/auth/api-keys/:id/revoke", async (request) => {
    const info = await requireAdmin(deps, request);
    const params = request.params as { id?: string };
    const id = typeof params.id === "string" ? params.id : "";

    const row = await prisma.apiKey.findUnique({ where: { id } });
    if (!row || row.tenantId !== info.tenantId) {
      throw new NotFoundError("ApiKey", id);
    }
    if (row.revokedAt) {
      return { ok: true, alreadyRevoked: true };
    }
    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date(), graceExpiresAt: null },
    });
    return { ok: true };
  });
}
