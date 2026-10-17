/**
 * Network API framework — offer pull service (2026-10-07).
 *
 * pullNetwork(tenantId, networkId):
 *   read network (tenant-scoped) → decrypt apiKey → adapter.pullOffers →
 *   upsert into network_offers by [tenantId, networkId, externalId] →
 *   write network_offer_pulls audit row → update network.lastPullAt/pullStatus.
 *
 * Failures set pullStatus=FAILED + pullError and are logged; they are never
 * rethrown to the worker/scheduler, so one bad network cannot wedge the run.
 * Plaintext apiKeys are never logged.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { NotFoundError } from "@adlinklab/shared";
import {
  decryptApiKey,
  resolveNetworkApiPepper,
} from "../networks/network-crypto.js";
import { getAdapter } from "../networks/index.js";
import type { NetworkAdapter, NetworkOffer } from "../networks/types.js";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "../utils/circuit-breaker.js";

/**
 * P2-10：每网络一个熔断器（按 network.id 分桶；调用保护，绝不暂停广告）。
 * OPEN 时直接跳过下游拉取，pull 记 FAILED + 熔断原因，不重试轰炸已挂的联盟 API。
 */
const breakersByNetwork = new Map<string, CircuitBreaker>();
export function breakerForNetwork(networkId: string): CircuitBreaker {
  let cb = breakersByNetwork.get(networkId);
  if (!cb) {
    cb = new CircuitBreaker(`network-pull:${networkId}`);
    breakersByNetwork.set(networkId, cb);
  }
  return cb;
}

export interface NetworkPullLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface NetworkPullServiceDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  getAdapterImpl?: (kind: string) => NetworkAdapter;
  /** Injectable pepper (tests); defaults to resolveNetworkApiPepper(). */
  pepper?: string;
  log?: NetworkPullLog;
}

export interface NetworkPullSummary {
  networkId: string;
  tenantId: string;
  status: "SUCCESS" | "FAILED";
  offerCount: number;
  newCount: number;
  updatedCount: number;
  error?: string;
}

const defaultLog: NetworkPullLog = {
  info: (msg, meta) =>
    meta ? console.log(`[network-pull] ${msg}`, meta) : console.log(`[network-pull] ${msg}`),
  error: (msg, meta) =>
    meta
      ? console.error(`[network-pull] ${msg}`, meta)
      : console.error(`[network-pull] ${msg}`),
};

function changed(existing: {
  name: string;
  payout: { toNumber(): number } | number | null;
  currency: string | null;
  termsText: string | null;
}, offer: NetworkOffer): boolean {
  const existingPayout =
    existing.payout === null || existing.payout === undefined
      ? null
      : typeof existing.payout === "number"
        ? existing.payout
        : existing.payout.toNumber();
  const nextPayout = offer.payout ?? null;
  return (
    existing.name !== offer.name ||
    existingPayout !== nextPayout ||
    (existing.currency ?? null) !== (offer.currency ?? null) ||
    (existing.termsText ?? null) !== (offer.termsText ?? null)
  );
}

// TODO(phase1-auto-screen): run the Phase 1 offer-intelligence pipeline
// (offerAnalyst → riskAnalyst → profitAnalyst → synthesizeDecision, see
// apps/api/src/ai/pipeline.ts runOfferPipeline) for each new/updated
// NetworkOffer. Integration point: create/lookup the matching Offer row,
// then call runOfferPipeline with the tenant's AiSetting LLM config.
// Deliberately NOT wired yet: it needs (1) an Offer row per network offer,
// (2) a configured AI settings key (LLM cost per offer), and (3) a product
// decision on auto vs manual screening. The staging table keeps every
// pulled offer available for the manual flow (GET /:id/offers) in the
// meantime.
export async function autoScreenNetworkOffer(
  _deps: { prisma: PrismaClient; tenantId: string },
  _networkOfferId: string
): Promise<{ screened: false; reason: string }> {
  return { screened: false, reason: "auto-screen not wired (see TODO)" };
}

export async function pullNetwork(
  deps: NetworkPullServiceDeps,
  tenantId: string,
  networkId: string
): Promise<NetworkPullSummary> {
  const { prisma } = deps;
  const log = deps.log ?? defaultLog;
  const getAdapterImpl = deps.getAdapterImpl ?? getAdapter;

  const network = await prisma.affiliateNetwork.findFirst({
    where: { id: networkId, tenantId, deletedAt: null },
  });
  if (!network) {
    throw new NotFoundError("Network not found");
  }

  await prisma.affiliateNetwork.update({
    where: { id: network.id },
    data: { pullStatus: "RUNNING", pullError: null },
  });

  const fail = async (error: string): Promise<NetworkPullSummary> => {
    const message = error.slice(0, 2000);
    await prisma.networkOfferPull.create({
      data: {
        id: randomUUID(),
        tenantId,
        networkId: network.id,
        offerCount: 0,
        newCount: 0,
        updatedCount: 0,
        status: "FAILED",
        error: message,
      },
    });
    await prisma.affiliateNetwork.update({
      where: { id: network.id },
      data: { pullStatus: "FAILED", pullError: message },
    });
    log.error("network pull failed", { networkId: network.id, tenantId, error: message });
    return {
      networkId: network.id,
      tenantId,
      status: "FAILED",
      offerCount: 0,
      newCount: 0,
      updatedCount: 0,
      error: message,
    };
  };

  try {
    if (!network.apiKeyRef) {
      return await fail("未配置 API 凭证：请先在网络设置中填写 API Key");
    }

    const pepper = deps.pepper ?? resolveNetworkApiPepper();
    const apiKey = decryptApiKey(network.apiKeyRef, pepper);
    const adapter = getAdapterImpl(network.kind);

    // P2-10：熔断器包裹下游拉取；OPEN 时直接 fail（不触碰联盟 API）。
    let offers: NetworkOffer[];
    try {
      offers = await breakerForNetwork(network.id).execute(() =>
        adapter.pullOffers({
          apiKey,
          apiBaseUrl: (network.apiBaseUrl ?? "").trim() || adapter.defaultBaseUrl,
          tenantId,
        })
      );
    } catch (e) {
      if (e instanceof CircuitBreakerOpenError) {
        return await fail(`联盟 API 熔断器已打开（连续失败），本次跳过拉取：${e.message}`);
      }
      throw e;
    }

    let newCount = 0;
    let updatedCount = 0;
    for (const offer of offers) {
      if (!offer.externalId) continue;
      const where = {
        tenantId_networkId_externalId: {
          tenantId,
          networkId: network.id,
          externalId: offer.externalId,
        },
      };
      const existing = await prisma.networkOffer.findUnique({ where });
      if (!existing) {
        const created = await prisma.networkOffer.create({
          data: {
            id: randomUUID(),
            tenantId,
            networkId: network.id,
            externalId: offer.externalId,
            name: offer.name,
            payout: offer.payout ?? null,
            currency: offer.currency ?? "USD",
            termsText: offer.termsText ?? null,
            rawData: offer.rawData as never,
            lastSeenAt: new Date(),
          },
        });
        newCount += 1;
        await autoScreenNetworkOffer({ prisma, tenantId }, created.id);
      } else if (changed(existing as never, offer)) {
        await prisma.networkOffer.update({
          where: { id: existing.id },
          data: {
            name: offer.name,
            payout: offer.payout ?? null,
            currency: offer.currency ?? "USD",
            termsText: offer.termsText ?? null,
            rawData: offer.rawData as never,
            lastSeenAt: new Date(),
          },
        });
        updatedCount += 1;
        await autoScreenNetworkOffer({ prisma, tenantId }, existing.id);
      } else {
        await prisma.networkOffer.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date() },
        });
      }
    }

    await prisma.networkOfferPull.create({
      data: {
        id: randomUUID(),
        tenantId,
        networkId: network.id,
        offerCount: offers.length,
        newCount,
        updatedCount,
        status: "SUCCESS",
        error: null,
      },
    });
    await prisma.affiliateNetwork.update({
      where: { id: network.id },
      data: {
        pullStatus: "SUCCESS",
        pullError: null,
        lastPullAt: new Date(),
        apiConfigured: true,
      },
    });

    log.info("network pull complete", {
      networkId: network.id,
      tenantId,
      offerCount: offers.length,
      newCount,
      updatedCount,
    });
    return {
      networkId: network.id,
      tenantId,
      status: "SUCCESS",
      offerCount: offers.length,
      newCount,
      updatedCount,
    };
  } catch (err) {
    return await fail((err as Error).message ?? "unknown error");
  }
}

/**
 * Pull every configured network (optionally scoped to one tenant).
 * Per-network failures are recorded, never thrown.
 */
export async function pullAllConfiguredNetworks(
  deps: NetworkPullServiceDeps,
  opts: { tenantId?: string } = {}
): Promise<NetworkPullSummary[]> {
  const { prisma } = deps;
  const log = deps.log ?? defaultLog;
  const networks = await prisma.affiliateNetwork.findMany({
    where: {
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      deletedAt: null,
      status: "ACTIVE",
      NOT: { apiKeyRef: null },
    },
    select: { id: true, tenantId: true },
  });
  log.info("scheduled network pull scan", { networks: networks.length });
  const results: NetworkPullSummary[] = [];
  for (const n of networks) {
    results.push(await pullNetwork(deps, n.tenantId, n.id));
  }
  return results;
}
