/**
 * Phase 8.4.9 — Script Integration Admin HTTP routes (Tenant API Key auth).
 * Never expose Integration Token plaintext except create/rotate/generate responses.
 */
import type { FastifyInstance } from "fastify";
import type { AppServices } from "./index.js";
import {
  createAuthContext,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";

export async function registerAdminScriptIntegrationRoutes(
  app: FastifyInstance,
  services: AppServices,
  auth: AuthContext = createAuthContext()
): Promise<void> {
  const admin = services.scriptIntegrationAdmin;
  const tenantOf = (
    request: Parameters<typeof requireTenant>[1],
    bodyTenant?: string
  ) => requireTenant(auth, request, bodyTenant);

  app.get("/api/v1/admin/script-integrations", async (request) => {
    const tenantId = tenantOf(request);
    const q = (request.query ?? {}) as { page?: string; pageSize?: string };
    return admin.list(
      tenantId,
      q.page ? Number(q.page) : 1,
      q.pageSize ? Number(q.pageSize) : 50
    );
  });

  app.post<{
    Body: { name?: string; googleAccountId?: string; tenantId?: string };
  }>("/api/v1/admin/script-integrations", async (request) => {
    const body = request.body ?? {};
    const tenantId = tenantOf(request, body.tenantId);
    return admin.create(tenantId, {
      name: body.name ?? "",
      googleAccountId: body.googleAccountId ?? "",
    });
  });

  app.get<{
    Params: { integrationId: string };
  }>("/api/v1/admin/script-integrations/:integrationId", async (request) => {
    const tenantId = tenantOf(request);
    return admin.get(tenantId, request.params.integrationId);
  });

  app.post<{
    Params: { integrationId: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/rotate-token",
    async (request) => {
      const tenantId = tenantOf(request);
      return admin.rotateToken(tenantId, request.params.integrationId);
    }
  );

  app.post<{
    Params: { integrationId: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/revoke",
    async (request) => {
      const tenantId = tenantOf(request);
      return admin.revoke(tenantId, request.params.integrationId);
    }
  );

  app.post<{
    Params: { integrationId: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/disable",
    async (request) => {
      const tenantId = tenantOf(request);
      return admin.disable(tenantId, request.params.integrationId);
    }
  );

  app.post<{
    Params: { integrationId: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/enable",
    async (request) => {
      const tenantId = tenantOf(request);
      return admin.enable(tenantId, request.params.integrationId);
    }
  );

  app.get<{
    Params: { integrationId: string };
    Querystring: { page?: string; pageSize?: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/targets",
    async (request) => {
      const tenantId = tenantOf(request);
      const q = request.query ?? {};
      return admin.listTargets(
        tenantId,
        request.params.integrationId,
        q.page ? Number(q.page) : 1,
        q.pageSize ? Number(q.pageSize) : 50
      );
    }
  );

  app.post<{
    Params: { integrationId: string };
    Body: { entityType?: string; entityId?: string; tenantId?: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/targets",
    async (request) => {
      const body = request.body ?? {};
      const tenantId = tenantOf(request, body.tenantId);
      return admin.attachTarget(tenantId, request.params.integrationId, {
        entityType: body.entityType ?? "",
        entityId: body.entityId ?? "",
      });
    }
  );

  app.delete<{
    Params: { integrationId: string; targetId: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/targets/:targetId",
    async (request) => {
      const tenantId = tenantOf(request);
      return admin.detachTarget(
        tenantId,
        request.params.integrationId,
        request.params.targetId
      );
    }
  );

  app.post<{
    Params: { integrationId: string };
    Body: { token?: string; baseUrl?: string; tenantId?: string };
  }>(
    "/api/v1/admin/script-integrations/:integrationId/generate-script",
    async (request) => {
      const body = request.body ?? {};
      const tenantId = tenantOf(request, body.tenantId);
      return admin.generateScript(tenantId, request.params.integrationId, {
        token: body.token ?? "",
        baseUrl: body.baseUrl,
      });
    }
  );
}
