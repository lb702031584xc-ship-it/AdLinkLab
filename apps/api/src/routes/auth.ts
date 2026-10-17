import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  authenticateSessionRequest,
  createSession,
  extractSessionToken,
  hashSessionToken,
  revokeSession,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { revokeToken } from "../auth/token-revocation.js";

/**
 * Phase 10 — user auth (one tenant per user).
 * Requires Prisma persistence; registered only when services.prisma exists.
 */

export interface AuthRouteDeps {
  prisma: PrismaClient;
}

type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
};

function publicUser(u: PublicUser): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tenantId: u.tenantId,
  };
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}${secure}`
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_ROLES = new Set(["admin", "member", "researcher"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireSession(
  deps: AuthRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

export async function requireAdmin(
  deps: AuthRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info = await requireSession(deps, request);
  if (info.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  return info;
}

/** Soft-delete: DISABLED + deletedAt keeps the row, kills access (sessions revoked). */
async function countActiveAdmins(prisma: PrismaClient): Promise<number> {
  return prisma.user.count({ where: { role: "admin", status: "ACTIVE" } });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!EMAIL_RE.test(email)) {
      throw new ValidationError("A valid email is required");
    }
    if (!name) {
      throw new ValidationError("Name is required");
    }
    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }

    const existing = await prisma.user.findFirst({
      where: { email, status: "ACTIVE" },
    });
    if (existing) {
      throw new ConflictError("Email is already registered");
    }

    // Bootstrap: the first admin in the whole table makes this user admin.
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    const role = adminCount === 0 ? "admin" : "member";

    const tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: email,
        slug: `u-${randomBytes(4).toString("hex")}`,
        status: "ACTIVE",
      },
    });
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        tenantId,
        email,
        name,
        passwordHash: hashPassword(password),
        role,
        status: "ACTIVE",
      },
    });

    const session = await createSession(prisma, user.id);
    setSessionCookie(reply, session.token);
    return reply.status(201).send({
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: unknown;
      password?: unknown;
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      throw new ValidationError("Email and password are required");
    }

    const user = await prisma.user.findFirst({
      where: { email, status: "ACTIVE" },
    });
    // Same message for unknown email and bad password — no enumeration.
    if (
      !user ||
      !user.passwordHash ||
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const session = await createSession(prisma, user.id);
    setSessionCookie(reply, session.token);
    return {
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  app.post("/api/v1/auth/logout", async (request) => {
    const token = extractSessionToken(request);
    if (token) {
      await revokeSession(prisma, token);
      // P0-5 — blacklist the token hash as well (belt-and-braces: the row
      // is gone, but a replayed token must stay dead).
      await revokeToken(prisma, {
        tokenHash: hashSessionToken(token),
        type: "session",
        reason: "logout",
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
    }
    return { ok: true };
  });

  app.post("/api/v1/auth/change-password", async (request, reply) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword) {
      throw new ValidationError(
        "Current password and new password are required"
      );
    }
    if (newPassword.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    const user = await prisma.user.findUnique({ where: { id: info.id } });
    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.passwordHash ||
      !verifyPassword(currentPassword, user.passwordHash)
    ) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    await prisma.user.update({
      where: { id: info.id },
      data: { passwordHash: hashPassword(newPassword) },
    });
    // P0-5 — every other session dies with the old password: blacklist each
    // session token hash, then delete the rows. A fresh session keeps the
    // current request signed in.
    const sessions = await prisma.session.findMany({
      where: { userId: info.id },
    });
    for (const session of sessions) {
      await revokeToken(prisma, {
        tokenHash: session.tokenHash,
        type: "session",
        reason: "password_change",
        expiresAt: session.expiresAt,
      });
    }
    await prisma.session.deleteMany({ where: { userId: info.id } });
    const session = await createSession(prisma, info.id);
    setSessionCookie(reply, session.token);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  app.get("/api/v1/auth/me", async (request) => {
    const info = await requireSession(deps, request);
    return { user: publicUser(info) };
  });

  app.get("/api/v1/auth/admin/users", async (request) => {
    const info = await requireSession(deps, request);
    if (info.role !== "admin") {
      throw new ForbiddenError("Admin access required");
    }
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        tenantId: u.tenantId,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  });

  app.post("/api/v1/auth/admin/users", async (request, reply) => {
    await requireAdmin(deps, request);
    const body = (request.body ?? {}) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
      role?: unknown;
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";

    if (!EMAIL_RE.test(email)) {
      throw new ValidationError("A valid email is required");
    }
    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    if (!VALID_ROLES.has(role)) {
      throw new ValidationError(
        "Role must be one of: admin, member, researcher"
      );
    }

    const existing = await prisma.user.findFirst({
      where: { email, status: "ACTIVE" },
    });
    if (existing) {
      throw new ConflictError("Email is already registered");
    }

    // Every admin-created user gets their own tenant, same as registration.
    const tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: email,
        slug: `u-${randomBytes(4).toString("hex")}`,
        status: "ACTIVE",
      },
    });
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        tenantId,
        email,
        name,
        passwordHash: hashPassword(password),
        role,
        status: "ACTIVE",
      },
    });
    // No session is created: this account is for someone else.
    return reply.status(201).send({ user: publicUser(user) });
  });

  app.delete("/api/v1/auth/admin/users/:id", async (request) => {
    const info = await requireAdmin(deps, request);
    const params = request.params as { id?: string };
    // Lowercase so a case-mangled self-UUID cannot dodge the self check.
    const id = typeof params.id === "string" ? params.id.toLowerCase() : "";
    if (!UUID_RE.test(id)) {
      throw new ValidationError("A valid user id is required");
    }
    if (id === info.id) {
      throw new ValidationError("Cannot delete your own account");
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.status !== "ACTIVE") {
      throw new NotFoundError("User");
    }
    if (target.role === "admin" && (await countActiveAdmins(prisma)) <= 1) {
      throw new ConflictError("Cannot delete the last active admin");
    }

    await prisma.user.update({
      where: { id },
      data: { status: "DISABLED", deletedAt: new Date() },
    });
    // P0-5 — blacklist every session token of the disabled user, then
    // delete the rows (a stale token must stay dead even if a row lingers).
    const sessions = await prisma.session
      .findMany({ where: { userId: id } })
      .catch(() => []);
    for (const session of sessions) {
      await revokeToken(prisma, {
        tokenHash: session.tokenHash,
        type: "session",
        reason: "admin_user_disabled",
        expiresAt: session.expiresAt ?? new Date(Date.now() + SESSION_TTL_MS),
      });
    }
    await prisma.session.deleteMany({ where: { userId: id } });
    return { ok: true };
  });

  app.patch("/api/v1/auth/admin/users/:id", async (request) => {
    const info = await requireAdmin(deps, request);
    const params = request.params as { id?: string };
    // Lowercase so a case-mangled self-UUID cannot dodge the self check.
    const id = typeof params.id === "string" ? params.id.toLowerCase() : "";
    if (!UUID_RE.test(id)) {
      throw new ValidationError("A valid user id is required");
    }
    if (id === info.id) {
      throw new ValidationError("Cannot change your own role");
    }

    const body = (request.body ?? {}) as { role?: unknown };
    const role = typeof body.role === "string" ? body.role.trim() : "";
    if (!VALID_ROLES.has(role)) {
      throw new ValidationError(
        "Role must be one of: admin, member, researcher"
      );
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.status !== "ACTIVE") {
      throw new NotFoundError("User");
    }
    if (
      target.role === "admin" &&
      role !== "admin" &&
      (await countActiveAdmins(prisma)) <= 1
    ) {
      throw new ConflictError("Cannot demote the last active admin");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
    });
    return { user: publicUser(updated) };
  });
}
