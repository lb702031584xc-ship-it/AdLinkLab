/**
 * Phase 8.4.2 — Script Integration authentication.
 * Token → HMAC hash → Integration → tenant/googleAccount authority.
 */
import type { FastifyRequest } from "fastify";
import type {
  GoogleAdsScriptIntegration,
  GoogleAdsScriptIntegrationRepository,
} from "@adlinklab/domain";
import { ForbiddenError, UnauthorizedError } from "@adlinklab/shared";
import {
  extractBearerToken,
  hashIntegrationToken,
  resolveIntegrationTokenPepper,
  safeEqualHex,
} from "./integration-token-crypto.js";

export interface IntegrationAuthContext {
  integrationId: string;
  tenantId: string;
  googleAccountId: string;
  tokenKeyId: string;
}

export type IntegrationAuthFailureReason =
  | "MISSING_TOKEN"
  | "INVALID_SCHEME"
  | "UNKNOWN_TOKEN"
  | "INACTIVE"
  | "DELETED"
  | "PEPPER_MISSING";

declare module "fastify" {
  interface FastifyRequest {
    integrationAuth?: IntegrationAuthContext;
  }
}

export interface AuthenticateIntegrationResult {
  context: IntegrationAuthContext;
  integration: GoogleAdsScriptIntegration;
}

export interface AuthenticateIntegrationOptions {
  /** Optional claimed ids from client — must match Integration authority or 403 */
  claimedTenantId?: string;
  claimedIntegrationId?: string;
  claimedGoogleAccountId?: string;
  /** Best-effort lastSeenAt update (default true) */
  touchLastSeen?: boolean;
  env?: NodeJS.ProcessEnv;
  /**
   * Optional sink for failure reason codes (never includes token).
   * Used by tests / future audit — must not log secrets.
   */
  onFailure?: (reason: IntegrationAuthFailureReason) => void;
  onSuccess?: (ctx: IntegrationAuthContext) => void;
}

function unauthorized(
  reason: IntegrationAuthFailureReason,
  onFailure?: (reason: IntegrationAuthFailureReason) => void
): never {
  onFailure?.(reason);
  throw new UnauthorizedError("Unauthorized");
}

function toContext(
  integration: GoogleAdsScriptIntegration
): IntegrationAuthContext {
  return {
    integrationId: integration.id,
    tenantId: integration.tenantId,
    googleAccountId: integration.googleAccountId,
    tokenKeyId: integration.tokenKeyId,
  };
}

/**
 * Assert client-claimed identifiers match IntegrationAuthContext.
 * Authority is always the authenticated Integration — never request body.
 */
export function assertIntegrationAuthClaims(
  ctx: IntegrationAuthContext,
  claims: {
    tenantId?: string;
    integrationId?: string;
    googleAccountId?: string;
  }
): void {
  if (claims.tenantId !== undefined && claims.tenantId !== ctx.tenantId) {
    throw new ForbiddenError("tenantId does not match Integration auth", {
      claimedTenantId: claims.tenantId,
    });
  }
  if (
    claims.integrationId !== undefined &&
    claims.integrationId !== ctx.integrationId
  ) {
    throw new ForbiddenError("integrationId does not match Integration auth", {
      claimedIntegrationId: claims.integrationId,
    });
  }
  if (
    claims.googleAccountId !== undefined &&
    claims.googleAccountId !== ctx.googleAccountId
  ) {
    throw new ForbiddenError(
      "googleAccountId does not match Integration auth",
      { claimedGoogleAccountId: claims.googleAccountId }
    );
  }
}

/**
 * Authenticate a Script Integration Bearer token.
 * Uniform 401 for missing/invalid/disabled/revoked/deleted — no existence leaks.
 */
export async function authenticateScriptIntegration(
  repos: {
    scriptIntegrations: GoogleAdsScriptIntegrationRepository;
  },
  authorizationHeader: string | undefined,
  options: AuthenticateIntegrationOptions = {}
): Promise<AuthenticateIntegrationResult> {
  const onFailure = options.onFailure;
  const env = options.env ?? process.env;

  let pepper: string;
  try {
    pepper = resolveIntegrationTokenPepper(env);
  } catch {
    return unauthorized("PEPPER_MISSING", onFailure);
  }

  if (authorizationHeader !== undefined && authorizationHeader.trim() !== "") {
    const schemeOk = /^Bearer\s+/i.test(authorizationHeader.trim());
    if (!schemeOk) {
      return unauthorized("INVALID_SCHEME", onFailure);
    }
  }

  const rawToken = extractBearerToken(authorizationHeader);
  if (!rawToken) {
    return unauthorized("MISSING_TOKEN", onFailure);
  }

  const tokenHash = hashIntegrationToken(rawToken, pepper);
  const integration = await repos.scriptIntegrations.findByTokenHash(tokenHash);
  if (!integration || !safeEqualHex(integration.tokenHash, tokenHash)) {
    return unauthorized("UNKNOWN_TOKEN", onFailure);
  }

  if (integration.deletedAt) {
    return unauthorized("DELETED", onFailure);
  }
  if (integration.status !== "ACTIVE") {
    return unauthorized("INACTIVE", onFailure);
  }

  const context = toContext(integration);
  assertIntegrationAuthClaims(context, {
    tenantId: options.claimedTenantId,
    integrationId: options.claimedIntegrationId,
    googleAccountId: options.claimedGoogleAccountId,
  });

  if (options.touchLastSeen !== false) {
    try {
      await repos.scriptIntegrations.update(integration.id, {
        lastSeenAt: new Date(),
      });
    } catch {
      // Best-effort — auth must not fail solely because lastSeenAt write failed.
    }
  }

  options.onSuccess?.(context);
  return { context, integration };
}

/**
 * Fastify helper: require Script Integration auth and attach request.integrationAuth.
 */
export async function requireScriptIntegrationAuth(
  repos: {
    scriptIntegrations: GoogleAdsScriptIntegrationRepository;
  },
  request: FastifyRequest,
  options: AuthenticateIntegrationOptions = {}
): Promise<IntegrationAuthContext> {
  const authHeader =
    typeof request.headers.authorization === "string"
      ? request.headers.authorization
      : undefined;

  const claimedTenantId =
    options.claimedTenantId ??
    (typeof request.headers["x-tenant-id"] === "string"
      ? request.headers["x-tenant-id"]
      : undefined);
  const claimedIntegrationId =
    options.claimedIntegrationId ??
    (typeof request.headers["x-integration-id"] === "string"
      ? request.headers["x-integration-id"]
      : undefined);
  const claimedGoogleAccountId =
    options.claimedGoogleAccountId ??
    (typeof request.headers["x-google-account-id"] === "string"
      ? request.headers["x-google-account-id"]
      : undefined);

  const { context } = await authenticateScriptIntegration(repos, authHeader, {
    ...options,
    claimedTenantId,
    claimedIntegrationId,
    claimedGoogleAccountId,
  });
  request.integrationAuth = context;
  return context;
}
