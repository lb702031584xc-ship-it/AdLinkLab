import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ForbiddenError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  IpBanWatcher,
  IP_BAN_AUTO_DURATION_MS,
  IP_BAN_AUTO_THRESHOLD,
  IP_BAN_AUTO_WINDOW_MS,
} from "./ip-ban-watcher.js";

/**
 * P0-4 — IP bans for the OWN API only (never ad clicks).
 *
 * - Manual bans: POST /api/v1/admin/ip-bans (see routes/ip-bans.ts).
 * - Auto bans: error-rate watcher (opt-in via IP_BAN_AUTO_ENABLED=1).
 * - The onRequest hook rejects banned IPs with a generic 403 — no ban
 *   details leak. Whitelisted IPs (env IP_BAN_WHITELIST, default loopback)
 *   are exempt. DB failures fail OPEN (log nothing sensitive, never break
 *   the business path).
 */

declare module "fastify" {
  interface FastifyRequest {
    /** Set when this request was rejected by the IP-ban hook. */
    ipBanBlocked?: boolean;
  }
}

export const DEFAULT_IP_BAN_WHITELIST = ["127.0.0.1", "::1"];

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

export function isValidIp(ip: string): boolean {
  const trimmed = ip.trim();
  return IPV4_RE.test(trimmed) || IPV6_RE.test(trimmed);
}

/**
 * Parse IP_BAN_WHITELIST (comma-separated). Unset → loopback defaults;
 * explicitly set → used as-is (operator owns the full list).
 */
export function parseIpBanWhitelist(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const raw = (env.IP_BAN_WHITELIST ?? "").trim();
  if (!raw) return [...DEFAULT_IP_BAN_WHITELIST];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isWhitelistedIp(ip: string, whitelist: string[]): boolean {
  return whitelist.includes(ip.trim());
}

export function isIpBanAutoEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (env.IP_BAN_AUTO_ENABLED ?? "").trim() === "1";
}

export interface ActiveIpBan {
  id: string;
  ip: string;
  level: string;
  expiresAt: Date | null;
}

/** Active ban row for an IP (revokedAt empty, not expired). Null when none. */
export async function findActiveIpBan(
  prisma: PrismaClient,
  ip: string,
  now: Date = new Date()
): Promise<ActiveIpBan | null> {
  const rows = await prisma.ipBan.findMany({
    where: { ip: ip.trim() },
    orderBy: { createdAt: "desc" },
  });
  for (const row of rows) {
    if (row.revokedAt) continue;
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) continue;
    return {
      id: row.id,
      ip: row.ip,
      level: row.level,
      expiresAt: row.expiresAt,
    };
  }
  return null;
}

/**
 * True when the IP is currently banned. Whitelisted IPs are never banned.
 * Fail-open: any DB error resolves to false so a ban-check outage can
 * never take down the API.
 */
export async function isIpBanned(
  prisma: PrismaClient,
  ip: string,
  opts: { whitelist?: string[]; now?: Date } = {}
): Promise<boolean> {
  const whitelist = opts.whitelist ?? parseIpBanWhitelist();
  if (isWhitelistedIp(ip, whitelist)) return false;
  try {
    return (await findActiveIpBan(prisma, ip, opts.now ?? new Date())) !== null;
  } catch {
    return false;
  }
}

export interface IpBanHookOptions {
  /** Override the whitelist (defaults to env parsing). */
  whitelist?: string[];
  /** Inject a watcher (tests use a small threshold). Defaults to env-gated. */
  watcher?: IpBanWatcher;
  /** Force auto-ban on/off (defaults to IP_BAN_AUTO_ENABLED). */
  autoEnabled?: boolean;
}

/**
 * Register the ban-enforcement onRequest hook + the auto-ban onResponse
 * hook. No-op without prisma. Register BEFORE other routes so the hooks
 * apply to every subsequently registered route.
 */
export function registerIpBanHooks(
  app: FastifyInstance,
  prisma?: PrismaClient,
  opts: IpBanHookOptions = {}
): void {
  if (!prisma) return;
  const whitelist = opts.whitelist ?? parseIpBanWhitelist();
  const autoEnabled = opts.autoEnabled ?? isIpBanAutoEnabled();
  const watcher =
    opts.watcher ??
    new IpBanWatcher({
      whitelist,
      windowMs: IP_BAN_AUTO_WINDOW_MS,
      threshold: IP_BAN_AUTO_THRESHOLD,
      banDurationMs: IP_BAN_AUTO_DURATION_MS,
    });

  app.addHook("onRequest", async (request) => {
    const ip = request.ip ?? "";
    if (!ip || isWhitelistedIp(ip, whitelist)) return;
    let banned = false;
    try {
      banned = (await findActiveIpBan(prisma, ip)) !== null;
    } catch {
      banned = false; // fail-open
    }
    if (banned) {
      request.ipBanBlocked = true;
      throw new ForbiddenError("Forbidden");
    }
  });

  // Auto-ban: count 4xx/5xx per IP; trip the threshold → 1h auto ban.
  // Best-effort only: never throws, never changes the response.
  app.addHook("onResponse", async (request, reply) => {
    try {
      if (!autoEnabled) return;
      if (request.ipBanBlocked) return;
      const statusCode = reply.statusCode;
      if (statusCode < 400) return;
      const ip = request.ip ?? "";
      if (!ip || isWhitelistedIp(ip, whitelist)) return;
      const outcome = watcher.record(ip, statusCode);
      if (!outcome.shouldBan) return;
      const existing = await findActiveIpBan(prisma, ip).catch(() => null);
      if (existing) return;
      const now = new Date();
      await prisma.ipBan
        .create({
          data: {
            id: randomUUID(),
            ip,
            reason: `auto: ${outcome.count} error responses in 5 minutes`,
            level: "auto",
            expiresAt: new Date(now.getTime() + IP_BAN_AUTO_DURATION_MS),
            requestCount: outcome.count,
          },
        })
        .catch(() => undefined);
    } catch {
      // best-effort — never break the response path
    }
  });
}
