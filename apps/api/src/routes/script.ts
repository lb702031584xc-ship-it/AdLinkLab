/**
 * Phase 8.4.3–8.4.6 — Google Ads Script API routes (Integration Token auth).
 */
import type { FastifyInstance } from "fastify";
import { AuditActions } from "@adlinklab/domain";
import {
  requireScriptIntegrationAuth,
  type IntegrationAuthContext,
  type IntegrationAuthFailureReason,
} from "../auth/integration-auth.js";
import { extractBearerToken } from "../auth/integration-token-crypto.js";
import { ValidationError } from "@adlinklab/shared";
import type { AppServices } from "./index.js";

function scriptAuthAuditHooks(services: AppServices) {
  return {
    onSuccess: (ctx: IntegrationAuthContext) => {
      if (!services.audit) return;
      void services.audit
        .record({
          tenantId: ctx.tenantId,
          actorId: ctx.tokenKeyId,
          action: AuditActions.SCRIPT_INTEGRATION_AUTH_SUCCESS,
          entityType: "GoogleAdsScriptIntegration",
          entityId: ctx.integrationId,
          resourceType: "GoogleAdsScriptIntegration",
          resourceId: ctx.integrationId,
          after: {
            integrationId: ctx.integrationId,
            googleAccountId: ctx.googleAccountId,
            tokenKeyId: ctx.tokenKeyId,
          },
        })
        .catch(() => undefined);
    },
    onFailure: (reason: IntegrationAuthFailureReason) => {
      // No tenant known — skip tenant-scoped audit for auth failures.
      // Reason codes never include the raw token.
      void reason;
    },
  };
}

export async function registerScriptRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  const authHooks = scriptAuthAuditHooks(services);

  app.get<{
    Headers: {
      authorization?: string;
      "x-tenant-id"?: string;
      "x-integration-id"?: string;
      "x-google-account-id"?: string;
    };
    Querystring: {
      tenantId?: string;
      integrationId?: string;
      googleAccountId?: string;
    };
  }>("/api/v1/script/config", async (request) => {
    const query = request.query ?? {};
    await requireScriptIntegrationAuth(
      { scriptIntegrations: services.scriptIntegrations },
      request,
      {
        claimedTenantId: query.tenantId,
        claimedIntegrationId: query.integrationId,
        claimedGoogleAccountId: query.googleAccountId,
        ...authHooks,
      }
    );
    const ctx = request.integrationAuth!;
    return services.scriptConfig.getConfig(ctx);
  });

  app.post<{
    Headers: { authorization?: string };
    Body: {
      targetId?: string;
      desiredVersion?: number;
      result?: "SUCCESS" | "FAILED" | "PARTIAL" | "NO_CHANGE";
      idempotencyKey?: string;
    };
  }>("/api/v1/script/sync-result", async (request) => {
    await requireScriptIntegrationAuth(
      { scriptIntegrations: services.scriptIntegrations },
      request,
      authHooks
    );
    const ctx = request.integrationAuth!;
    return services.scriptSyncResult.submitResult(ctx, request.body ?? {});
  });

  /**
   * Phase 8.4.6 — Script Generator (READ ONLY).
   * Authorization Bearer token is embedded into source in-memory only.
   * Optional body.token must match Authorization when provided.
   */
  app.post<{
    Headers: { authorization?: string };
    Body: {
      baseUrl?: string;
      token?: string;
    };
  }>("/api/v1/script/generator", async (request) => {
    await requireScriptIntegrationAuth(
      { scriptIntegrations: services.scriptIntegrations },
      request,
      authHooks
    );
    const ctx = request.integrationAuth!;
    const authToken = extractBearerToken(request.headers.authorization);
    if (!authToken) {
      throw new ValidationError("Authorization Bearer token required");
    }
    return services.scriptGenerator.generate(
      ctx,
      authToken,
      request.body ?? {}
    );
  });

  /** GET variant — Authorization token only; baseUrl from SCRIPT_API_BASE_URL. */
  app.get<{
    Headers: { authorization?: string };
    Querystring: { baseUrl?: string };
  }>("/api/v1/script/generator", async (request) => {
    await requireScriptIntegrationAuth(
      { scriptIntegrations: services.scriptIntegrations },
      request,
      authHooks
    );
    const ctx = request.integrationAuth!;
    const authToken = extractBearerToken(request.headers.authorization);
    if (!authToken) {
      throw new ValidationError("Authorization Bearer token required");
    }
    return services.scriptGenerator.generate(ctx, authToken, {
      baseUrl: request.query?.baseUrl,
    });
  });
}
