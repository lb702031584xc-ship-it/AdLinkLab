/**
 * Feature 3 — 返利网换链 + AdsPower 集成 API.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * - GET  /api/v1/integrations/adspower/profiles
 * - POST /api/v1/integrations/adspower/open    { profileId }
 * - POST /api/v1/integrations/adspower/close   { profileId }
 * - POST /api/v1/cashback-offers               { cashbackNetwork, originalUrl, adspowerProfileId? }
 * - GET  /api/v1/cashback-offers               ?page ?pageSize ?status
 * - GET  /api/v1/cashback-offers/:id
 * - PUT  /api/v1/cashback-offers/:id           { status?, adspowerProfileId?, originalUrl? }
 * - DELETE /api/v1/cashback-offers/:id         (soft delete; pauses its tracking link)
 * - POST /api/v1/rotation-groups               { name, strategy?, items: [{ cashbackOfferId, weight? }] }
 * - GET  /api/v1/rotation-groups
 * - GET  /api/v1/rotation-groups/:id
 * - PUT  /api/v1/rotation-groups/:id           { name?, strategy?, isActive?, items? }
 * - DELETE /api/v1/rotation-groups/:id
 * - POST /api/v1/rotation-groups/:id/rotate-now
 *
 * Session auth only (one tenant per user), following offer-intel.ts.
 * TrackingLink creation reuses the existing TrackingLinkManagementService —
 * this file never re-implements it.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { createPrismaRepositoryBundle } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { TrackingLinkManagementService } from "../services/click-ingestion.js";
import {
  AdsPowerClient,
} from "../integrations/adspower.js";
import {
  createPrismaTrackingLinkRotationWriter,
  rotateGroup,
} from "../queue/rotation-worker.js";

export interface CashbackRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests (defaults to AdsPowerClient.fromEnv()). */
  adspowerImpl?: AdsPowerClient;
  /**
   * Injectable for tests. Defaults to the real TrackingLinkManagementService
   * over the prisma repository bundle — i.e. the EXISTING creation logic.
   */
  trackingLinkService?: CashbackTrackingLinkService;
}

/**
 * Structural subset of TrackingLinkManagementService used here:
 * create (existing creation logic) + status update. The real class
 * satisfies this interface; tests inject a fake.
 */
export interface CashbackTrackingLinkService {
  create(data: {
    id: string;
    tenantId: string;
    publicId: string;
    offerId: string;
    status: "ACTIVE";
  }): Promise<{ id: string; publicId: string; status: string }>;
  update(
    tenantId: string,
    id: string,
    data: { status?: "PAUSED" | "ACTIVE"; offerId?: string }
  ): Promise<unknown>;
}

async function requireSession(
  deps: CashbackRouteDeps,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asHttpUrl(v: unknown): string {
  const s = asTrimmedString(v);
  if (!s) throw new ValidationError("originalUrl is required");
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new ValidationError("originalUrl must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("originalUrl must use http(s)");
  }
  return parsed.toString();
}

/**
 * 建议用的返利网络名称：仅作前端自动补全/建议，不做白名单校验。
 *
 * 返利网络允许手动输入任意名称 —— asCashbackNetwork 只做非空 + 长度校验，
 * 不再限制为列表成员（历史行为是白名单，已放开）。
 */
export const CASHBACK_NETWORKS = [
  "rakuten",
  "55haitao",
  "ebates",
  "topcashback",
  "other",
] as const;

function asCashbackNetwork(v: unknown): string {
  const s = asTrimmedString(v);
  if (!s) throw new ValidationError("cashbackNetwork is required");
  if (s.length > 64) {
    throw new ValidationError("cashbackNetwork must be 1-64 characters");
  }
  return s;
}

const CASHBACK_STATUSES = ["active", "paused"] as const;

function asCashbackStatus(v: unknown): string {
  const s = asTrimmedString(v)?.toLowerCase();
  if (!s || !(CASHBACK_STATUSES as readonly string[]).includes(s)) {
    throw new ValidationError(
      `status must be one of: ${CASHBACK_STATUSES.join(", ")}`
    );
  }
  return s;
}

const ROTATION_STRATEGIES = ["round_robin", "weighted"] as const;

function asRotationStrategy(v: unknown): string {
  if (v === undefined || v === null || v === "") return "round_robin";
  const s = asTrimmedString(v)?.toLowerCase();
  if (!s || !(ROTATION_STRATEGIES as readonly string[]).includes(s)) {
    throw new ValidationError(
      `strategy must be one of: ${ROTATION_STRATEGIES.join(", ")}`
    );
  }
  return s;
}

/**
 * Rotation interval in ms. Accepts 0 (manual only) or >= 15 minutes.
 * Defaults to 1 hour when omitted.
 */
function asRotationIntervalMs(v: unknown): number {
  if (v === undefined || v === null || v === "") return 3600000;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError("rotationIntervalMs must be a non-negative number");
  }
  if (n > 0 && n < 900000) {
    throw new ValidationError("rotationIntervalMs must be 0 or at least 900000 (15 min)");
  }
  return Math.floor(n);
}

function asWeight(v: unknown): number {
  if (v === undefined || v === null || v === "") return 1;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.floor(n) < 1) {
    throw new ValidationError("weight must be an integer >= 1");
  }
  return Math.floor(n);
}

function resolveDeps(deps: CashbackRouteDeps): Required<
  Pick<CashbackRouteDeps, "adspowerImpl" | "trackingLinkService">
> {
  return {
    adspowerImpl:
      deps.adspowerImpl ??
      AdsPowerClient.fromEnv(process.env),
    trackingLinkService:
      deps.trackingLinkService ??
      new TrackingLinkManagementService(
        createPrismaRepositoryBundle(deps.prisma).trackingLinks
      ),
  };
}

function publicIdCandidate(): string {
  return `cb_${randomBytes(6).toString("hex")}`;
}

/** Generate a tenant-unique publicId (retries on the rare collision). */
async function generateUniquePublicId(
  prisma: PrismaClient,
  tenantId: string
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const publicId = publicIdCandidate();
    const existing = await prisma.trackingLink.findFirst({
      where: { tenantId, publicId },
      select: { id: true },
    });
    if (!existing) return publicId;
  }
  throw new ValidationError("failed to generate a unique publicId");
}

function offerDisplayName(network: string, url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = url.slice(0, 32);
  }
  return `[返利] ${network} · ${host}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerCashbackRoutes(
  app: FastifyInstance,
  deps: CashbackRouteDeps
): Promise<void> {
  const { prisma } = deps;
  const { adspowerImpl, trackingLinkService } = resolveDeps(deps);

  // -- AdsPower ------------------------------------------------------------

  app.get("/api/v1/integrations/adspower/profiles", async (request) => {
    await requireSession(deps, request);
    const profiles = await adspowerImpl.listProfiles();
    return { profiles, baseUrl: adspowerImpl.baseUrl };
  });

  app.post<{
    Body: { profileId?: string };
  }>("/api/v1/integrations/adspower/open", async (request) => {
    await requireSession(deps, request);
    const profileId = asTrimmedString(request.body?.profileId);
    if (!profileId) throw new ValidationError("profileId is required");
    const session = await adspowerImpl.openBrowser(profileId);
    return { session };
  });

  app.post<{
    Body: { profileId?: string };
  }>("/api/v1/integrations/adspower/close", async (request) => {
    await requireSession(deps, request);
    const profileId = asTrimmedString(request.body?.profileId);
    if (!profileId) throw new ValidationError("profileId is required");
    await adspowerImpl.closeBrowser(profileId);
    return { ok: true };
  });

  // -- Cashback offers -----------------------------------------------------

  app.post<{
    Body: {
      cashbackNetwork?: string;
      originalUrl?: string;
      adspowerProfileId?: string;
    };
  }>("/api/v1/cashback-offers", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const cashbackNetwork = asCashbackNetwork(request.body?.cashbackNetwork);
    const originalUrl = asHttpUrl(request.body?.originalUrl);
    const adspowerProfileId = asTrimmedString(
      request.body?.adspowerProfileId
    ) ?? null;

    // 1. Backing Offer row (destination = the cashback original URL).
    const offer = await prisma.offer.create({
      data: {
        id: randomUUID(),
        tenantId,
        name: offerDisplayName(cashbackNetwork, originalUrl),
        network: cashbackNetwork,
        source: "cashback",
        destinationUrl: originalUrl,
        status: "ACTIVE",
      },
    });

    // 2. TrackingLink via the EXISTING creation logic (not re-implemented).
    const trackingLink = await trackingLinkService.create({
      id: randomUUID(),
      tenantId,
      publicId: await generateUniquePublicId(prisma, tenantId),
      offerId: offer.id,
      status: "ACTIVE",
    });

    // 3. CashbackOffer bound to the tracking link.
    const cashbackOffer = await prisma.cashbackOffer.create({
      data: {
        id: randomUUID(),
        tenantId,
        cashbackNetwork,
        originalUrl,
        trackingLinkId: trackingLink.id,
        adspowerProfileId,
        status: "active",
      },
    });

    return {
      cashbackOffer,
      trackingLink: {
        id: trackingLink.id,
        publicId: trackingLink.publicId,
        status: trackingLink.status,
      },
    };
  });

  app.get<{
    Querystring: { page?: string; pageSize?: string; status?: string };
  }>("/api/v1/cashback-offers", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.query.pageSize) || 20)
    );
    const status = asTrimmedString(request.query.status)?.toLowerCase();
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.cashbackOffer.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          trackingLink: {
            select: { id: true, publicId: true, status: true },
          },
        },
      }),
      prisma.cashbackOffer.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });

  app.get<{
    Params: { id: string };
  }>("/api/v1/cashback-offers/:id", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const offer = await prisma.cashbackOffer.findFirst({
      where: { id: request.params.id, tenantId, deletedAt: null },
      include: {
        trackingLink: {
          select: { id: true, publicId: true, status: true },
        },
      },
    });
    if (!offer) throw new NotFoundError("CashbackOffer", request.params.id);
    return { cashbackOffer: offer };
  });

  app.put<{
    Params: { id: string };
    Body: {
      status?: string;
      adspowerProfileId?: string | null;
      originalUrl?: string;
    };
  }>("/api/v1/cashback-offers/:id", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const existing = await prisma.cashbackOffer.findFirst({
      where: { id: request.params.id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("CashbackOffer", request.params.id);

    const data: Record<string, unknown> = {};
    if (request.body?.status !== undefined) {
      data.status = asCashbackStatus(request.body.status);
    }
    if (request.body?.adspowerProfileId !== undefined) {
      data.adspowerProfileId =
        asTrimmedString(request.body.adspowerProfileId) ?? null;
    }
    if (request.body?.originalUrl !== undefined) {
      const originalUrl = asHttpUrl(request.body.originalUrl);
      data.originalUrl = originalUrl;
      // Keep the backing offer destination in sync.
      if (existing.trackingLinkId) {
        const link = await prisma.trackingLink.findUnique({
          where: { id: existing.trackingLinkId },
          select: { offerId: true },
        });
        if (link) {
          await prisma.offer.update({
            where: { id: link.offerId },
            data: { destinationUrl: originalUrl },
          });
        }
      }
    }

    const updated = await prisma.cashbackOffer.update({
      where: { id: existing.id },
      data,
    });
    return { cashbackOffer: updated };
  });

  app.delete<{
    Params: { id: string };
  }>("/api/v1/cashback-offers/:id", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const existing = await prisma.cashbackOffer.findFirst({
      where: { id: request.params.id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("CashbackOffer", request.params.id);

    await prisma.cashbackOffer.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), status: "paused" },
    });
    // Stop spend through the bound tracking link.
    if (existing.trackingLinkId) {
      try {
        await trackingLinkService.update(tenantId, existing.trackingLinkId, {
          status: "PAUSED",
        });
      } catch {
        /* best effort — the offer is already soft-deleted */
      }
    }
    return { ok: true };
  });

  // -- Rotation groups -----------------------------------------------------

  async function validateGroupItems(
    tenantId: string,
    items: unknown
  ): Promise<Array<{ cashbackOfferId: string; weight: number }>> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError("items must be a non-empty array");
    }
    const seen = new Set<string>();
    const out: Array<{ cashbackOfferId: string; weight: number }> = [];
    for (const raw of items) {
      const offerId = asTrimmedString(
        (raw as { cashbackOfferId?: unknown })?.cashbackOfferId
      );
      if (!offerId || !UUID_RE.test(offerId)) {
        throw new ValidationError("each item needs a valid cashbackOfferId");
      }
      if (seen.has(offerId)) {
        throw new ValidationError("duplicate cashbackOfferId in items");
      }
      seen.add(offerId);
      const offer = await prisma.cashbackOffer.findFirst({
        where: { id: offerId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!offer) throw new NotFoundError("CashbackOffer", offerId);
      out.push({
        cashbackOfferId: offerId,
        weight: asWeight((raw as { weight?: unknown })?.weight),
      });
    }
    return out;
  }

  function groupDetailSelect() {
    return {
      include: {
        items: {
          orderBy: { sortOrder: "asc" } as const,
          include: {
            cashbackOffer: {
              select: {
                id: true,
                cashbackNetwork: true,
                originalUrl: true,
                status: true,
                adspowerProfileId: true,
                trackingLinkId: true,
              },
            },
          },
        },
      },
    };
  }

  app.post<{
    Body: {
      name?: string;
      strategy?: string;
      rotationIntervalMs?: unknown;
      items?: unknown;
    };
  }>("/api/v1/rotation-groups", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const name = asTrimmedString(request.body?.name);
    if (!name) throw new ValidationError("name is required");
    const strategy = asRotationStrategy(request.body?.strategy);
    const rotationIntervalMs = asRotationIntervalMs(request.body?.rotationIntervalMs);
    const items = await validateGroupItems(tenantId, request.body?.items);

    const group = await prisma.rotationGroup.create({
      data: {
        id: randomUUID(),
        tenantId,
        name,
        strategy,
        rotationIntervalMs,
        isActive: true,
        items: {
          create: items.map((it, idx) => ({
            id: randomUUID(),
            cashbackOfferId: it.cashbackOfferId,
            weight: it.weight,
            sortOrder: idx,
          })),
        },
      },
      ...groupDetailSelect(),
    });
    return { rotationGroup: group };
  });

  app.get("/api/v1/rotation-groups", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const groups = await prisma.rotationGroup.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      ...groupDetailSelect(),
    });
    return { items: groups, total: groups.length };
  });

  app.get<{
    Params: { id: string };
  }>("/api/v1/rotation-groups/:id", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const group = await prisma.rotationGroup.findFirst({
      where: { id: request.params.id, tenantId },
      ...groupDetailSelect(),
    });
    if (!group) throw new NotFoundError("RotationGroup", request.params.id);
    return { rotationGroup: group };
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      strategy?: string;
      isActive?: boolean;
      rotationIntervalMs?: unknown;
      items?: unknown;
    };
  }>("/api/v1/rotation-groups/:id", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const existing = await prisma.rotationGroup.findFirst({
      where: { id: request.params.id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("RotationGroup", request.params.id);

    const data: Record<string, unknown> = {};
    if (request.body?.name !== undefined) {
      const name = asTrimmedString(request.body.name);
      if (!name) throw new ValidationError("name cannot be empty");
      data.name = name;
    }
    if (request.body?.strategy !== undefined) {
      data.strategy = asRotationStrategy(request.body.strategy);
    }
    if (request.body?.isActive !== undefined) {
      data.isActive = request.body.isActive === true;
    }
    if (request.body?.rotationIntervalMs !== undefined) {
      data.rotationIntervalMs = asRotationIntervalMs(request.body.rotationIntervalMs);
    }

    let items: Array<{ cashbackOfferId: string; weight: number }> | undefined;
    if (request.body?.items !== undefined) {
      items = await validateGroupItems(tenantId, request.body.items);
      await prisma.rotationGroupItem.deleteMany({
        where: { rotationGroupId: existing.id },
      });
    }

    const updated = await prisma.rotationGroup.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(items
          ? {
              items: {
                create: items.map((it, idx) => ({
                  id: randomUUID(),
                  cashbackOfferId: it.cashbackOfferId,
                  weight: it.weight,
                  sortOrder: idx,
                })),
              },
            }
          : {}),
      },
      ...groupDetailSelect(),
    });
    return { rotationGroup: updated };
  });

  app.delete<{
    Params: { id: string };
  }>("/api/v1/rotation-groups/:id", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const existing = await prisma.rotationGroup.findFirst({
      where: { id: request.params.id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("RotationGroup", request.params.id);
    // Items cascade (schema); cashback offers are never deleted.
    await prisma.rotationGroup.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
  }>("/api/v1/rotation-groups/:id/rotate-now", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const existing = await prisma.rotationGroup.findFirst({
      where: { id: request.params.id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("RotationGroup", request.params.id);

    const result = await rotateGroup({
      prisma,
      trackingLinks: createPrismaTrackingLinkRotationWriter(prisma),
      groupId: existing.id,
    });
    return { result };
  });
}
