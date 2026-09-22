/**
 * Phase 8.4.2 — Test-only Script Integration auth route helper.
 * Registers ONLY when VITEST / NODE_ENV=test / ADLINKLAB_SCRIPT_AUTH_TEST_ROUTES=1.
 * Not a Phase 8.4.3 Config API.
 */
import type { FastifyInstance } from "fastify";
import type { GoogleAdsScriptIntegrationRepository } from "@adlinklab/domain";
import { AppError } from "@adlinklab/shared";
import { requireScriptIntegrationAuth } from "./integration-auth.js";

export function shouldRegisterScriptAuthTestRoutes(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.ADLINKLAB_SCRIPT_AUTH_TEST_ROUTES === "1") return true;
  if (env.VITEST) return true;
  if (env.NODE_ENV === "test") return true;
  return false;
}

/**
 * Minimal whoami endpoint for middleware HTTP tests.
 * Path intentionally not under /api/v1/script/config.
 */
export async function registerScriptIntegrationAuthTestRoutes(
  app: FastifyInstance,
  repos: { scriptIntegrations: GoogleAdsScriptIntegrationRepository },
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!shouldRegisterScriptAuthTestRoutes(env)) return;

  app.get("/__test__/script-integration/whoami", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as {
        tenantId?: string;
        integrationId?: string;
        googleAccountId?: string;
      };
      const query = request.query as {
        tenantId?: string;
        integrationId?: string;
        googleAccountId?: string;
      };
      const ctx = await requireScriptIntegrationAuth(repos, request, {
        claimedTenantId: body.tenantId ?? query.tenantId,
        claimedIntegrationId: body.integrationId ?? query.integrationId,
        claimedGoogleAccountId: body.googleAccountId ?? query.googleAccountId,
        env,
      });
      return {
        integrationId: ctx.integrationId,
        tenantId: ctx.tenantId,
        googleAccountId: ctx.googleAccountId,
        tokenKeyId: ctx.tokenKeyId,
      };
    } catch (error) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }
  });
}
