/**
 * Phase 8.4.7.1 — Dashboard read-only HTTP routes (Integration Token auth).
 */
import type { FastifyInstance } from "fastify";
import { AuditActions } from "@adlinklab/domain";
import {
  requireScriptIntegrationAuth,
  type IntegrationAuthContext,
  type IntegrationAuthFailureReason,
} from "../auth/integration-auth.js";
import type { AppServices } from "./index.js";

function dashboardAuthAuditHooks(services: AppServices) {
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
      void reason;
    },
  };
}

export async function registerDashboardRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  const authHooks = dashboardAuthAuditHooks(services);

  async function authenticate(request: Parameters<
    typeof requireScriptIntegrationAuth
  >[1]) {
    await requireScriptIntegrationAuth(
      { scriptIntegrations: services.scriptIntegrations },
      request,
      authHooks
    );
    return request.integrationAuth!;
  }

  app.get("/api/v1/dashboard/integrations", async (request) => {
    const ctx = await authenticate(request);
    return services.dashboardQuery.listIntegrations(ctx);
  });

  app.get<{
    Params: { integrationId: string };
  }>("/api/v1/dashboard/integrations/:integrationId", async (request) => {
    const ctx = await authenticate(request);
    return services.dashboardQuery.getIntegration(
      ctx,
      request.params.integrationId
    );
  });

  app.get<{
    Params: { integrationId: string };
  }>(
    "/api/v1/dashboard/integrations/:integrationId/targets",
    async (request) => {
      const ctx = await authenticate(request);
      return services.dashboardQuery.listTargets(
        ctx,
        request.params.integrationId
      );
    }
  );

  app.get<{
    Params: { integrationId: string };
    Querystring: { page?: string; pageSize?: string };
  }>(
    "/api/v1/dashboard/integrations/:integrationId/logs",
    async (request) => {
      const ctx = await authenticate(request);
      return services.dashboardQuery.listLogs(
        ctx,
        request.params.integrationId,
        request.query ?? {}
      );
    }
  );

  app.get("/api/v1/dashboard/summary", async (request) => {
    const ctx = await authenticate(request);
    return services.dashboardQuery.getSummary(ctx);
  });
}
