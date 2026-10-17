import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { isRevoked } from "./token-revocation.js";

/**
 * Opaque login sessions.
 * - Token returned to the caller once; only its SHA-256 hash is stored.
 * - Presented via `alk_session` cookie or `Authorization: Bearer <token>`.
 * - Admins may impersonate a tenant view via `x-view-tenant` (validated UUID of
 *   an existing tenant); members' `x-view-tenant` is ignored.
 */

export const SESSION_COOKIE_NAME = "alk_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

export interface ResolvedSession {
  user: SessionUser;
  expiresAt: Date;
}

/** Session auth resolved for the current request (effective tenant applied). */
export interface SessionAuthInfo extends SessionUser {
  /** Effective tenant: home tenant, or x-view-tenant for admins. */
  tenantId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    sessionAuth?: SessionAuthInfo;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Minimal cookie parser — no @fastify/cookie dependency. */
export function parseSessionCookie(
  cookieHeader: string | undefined
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const raw = part.slice(idx + 1).trim();
    if (!raw) continue;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function extractBearerToken(
  authorization: string | undefined
): string | undefined {
  const auth = authorization?.trim();
  if (!auth) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() || undefined;
}

/** Cookie first, then Bearer. Returns undefined when neither is present. */
export function extractSessionToken(request: {
  headers: Record<string, unknown>;
}): string | undefined {
  const { cookie, authorization } = request.headers;
  return (
    parseSessionCookie(typeof cookie === "string" ? cookie : undefined) ??
    extractBearerToken(
      typeof authorization === "string" ? authorization : undefined
    )
  );
}

export async function createSession(
  prisma: PrismaClient,
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      id: randomUUID(),
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function resolveSession(
  prisma: PrismaClient,
  token: string
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    // Best-effort cleanup of the expired row.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // P0-5 — blacklisted sessions (logout / password change / admin disable)
  // are dead even though the row still exists. isRevoked never throws.
  if (await isRevoked(prisma, { tokenHash: session.tokenHash })) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      tenantId: session.user.tenantId,
    },
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(
  prisma: PrismaClient,
  token: string
): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

/**
 * Resolve session auth for a request (cached on `request.sessionAuth`).
 * Returns null when no session token was presented or it is invalid/expired.
 * Never throws for missing/invalid tokens — callers fall through to API-key auth.
 */
export async function authenticateSessionRequest(
  prisma: PrismaClient,
  request: FastifyRequest
): Promise<SessionAuthInfo | null> {
  if (request.sessionAuth) return request.sessionAuth;
  let token: string | undefined;
  try {
    token = extractSessionToken(request);
  } catch {
    return null;
  }
  if (!token) return null;
  let resolved: ResolvedSession | null;
  try {
    resolved = await resolveSession(prisma, token);
  } catch {
    return null;
  }
  if (!resolved) return null;

  let tenantId = resolved.user.tenantId;
  if (resolved.user.role === "admin") {
    const viewTenant = request.headers["x-view-tenant"];
    if (typeof viewTenant === "string" && UUID_RE.test(viewTenant)) {
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { id: viewTenant },
        });
        if (tenant) tenantId = tenant.id;
      } catch {
        // fall through with the home tenant
      }
    }
  }

  const info: SessionAuthInfo = { ...resolved.user, tenantId };
  request.sessionAuth = info;
  return info;
}
