/**
 * 清单 #3 — 品牌词分级管理 HTTP 路由。
 *
 * Pure addition: new endpoints only. NOT wired into routes/index.ts
 * (coordinator owns that wiring — subtask scope keeps this file standalone).
 *
 * Tenant-isolated via requireTenant (same pattern as budget-rules.ts /
 * admin-script-integrations.ts; auth defaults to createAuthContext() so
 * the coordinator can call registerBrandKeywordRoutes(app, { prisma })).
 *   GET    /api/v1/brand-keywords              — list own tenant's words
 *   POST   /api/v1/brand-keywords              — create (bidding on, ACTIVE)
 *   PATCH  /api/v1/brand-keywords/:id          — edit switch/status/brand/offer
 *   POST   /api/v1/brand-keywords/:id/warning  — warn + auto-downgrade
 *   POST   /api/v1/brand-keywords/:id/reenable — manual restore to ACTIVE
 */
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  createAuthContext,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  assertValidStatus,
  assertValidWarningKind,
  createBrandKeyword,
  listBrandKeywords,
  reenableBrandKeyword,
  recordBrandKeywordWarning,
  serializeBrandKeyword,
  updateBrandKeyword,
} from "../services/brand-keywords.js";

export interface BrandKeywordRouteServices {
  prisma: PrismaClient;
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

/** Present key = explicit null clears; absent key = untouched. */
function asNullableString(
  body: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  return asTrimmedString(body[key]) ?? null;
}

export async function registerBrandKeywordRoutes(
  app: FastifyInstance,
  services: BrandKeywordRouteServices,
  auth: AuthContext = createAuthContext()
): Promise<void> {
  const tenantOf = (request: Parameters<typeof requireTenant>[1]): string =>
    requireTenant(auth, request);

  app.get("/api/v1/brand-keywords", async (request) => {
    const tenantId = tenantOf(request);
    const rows = await listBrandKeywords(services.prisma, tenantId);
    return { keywords: rows.map(serializeBrandKeyword) };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/brand-keywords",
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const body = request.body ?? {};
      const keyword = asTrimmedString(body.keyword);
      if (!keyword) {
        throw new ValidationError("keyword is required");
      }
      const created = await createBrandKeyword(services.prisma, tenantId, {
        keyword,
        brand: asNullableString(body, "brand") ?? null,
        offerId: asNullableString(body, "offerId") ?? null,
      });
      void reply.code(201);
      return { keyword: serializeBrandKeyword(created) };
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/brand-keywords/:id",
    async (request) => {
      const tenantId = tenantOf(request);
      const body = request.body ?? {};
      const biddingEnabled = asBoolean(body.biddingEnabled);
      if (
        body.biddingEnabled !== undefined &&
        biddingEnabled === undefined
      ) {
        throw new ValidationError("biddingEnabled must be a boolean");
      }
      const status =
        body.status === undefined
          ? undefined
          : assertValidStatus(body.status);
      const updated = await updateBrandKeyword(
        services.prisma,
        tenantId,
        request.params.id,
        {
          biddingEnabled,
          status,
          brand: asNullableString(body, "brand"),
          offerId: asNullableString(body, "offerId"),
        }
      );
      return { keyword: serializeBrandKeyword(updated) };
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/brand-keywords/:id/warning",
    async (request) => {
      const tenantId = tenantOf(request);
      const kind = assertValidWarningKind(request.body?.kind);
      const updated = await recordBrandKeywordWarning(
        services.prisma,
        tenantId,
        request.params.id,
        kind
      );
      return { keyword: serializeBrandKeyword(updated) };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/brand-keywords/:id/reenable",
    async (request) => {
      const tenantId = tenantOf(request);
      const updated = await reenableBrandKeyword(
        services.prisma,
        tenantId,
        request.params.id
      );
      return { keyword: serializeBrandKeyword(updated) };
    }
  );
}
