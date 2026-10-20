/**
 * Network API framework — pull service unit tests (in-memory fake Prisma).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  isNetworkPullInFlight,
  pullAllConfiguredNetworks,
  pullNetwork,
  startNetworkPullInBackground,
  type NetworkPullServiceDeps,
} from "./network-pull-service.js";
import { encryptApiKey } from "../networks/network-crypto.js";
import type { NetworkAdapter, NetworkOffer } from "../networks/types.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NETWORK = "22222222-2222-4222-8222-222222222222";
const PEPPER = "test-pepper-for-network-pull-service";

interface Ctx {
  networks: any[];
  offers: any[];
  pulls: any[];
}

function makeOffer(externalId: string, overrides: Partial<NetworkOffer> = {}): NetworkOffer {
  return {
    externalId,
    name: `Offer ${externalId}`,
    payout: 10,
    currency: "USD",
    termsText: "terms",
    url: null,
    rawData: { externalId },
    ...overrides,
  };
}

function buildDeps(ctx: Ctx, adapter: NetworkAdapter): NetworkPullServiceDeps {
  const fake = {
    affiliateNetwork: {
      findFirst: async (args: any) =>
        ctx.networks.find(
          (n) =>
            (!args.where.id || n.id === args.where.id) &&
            (!args.where.tenantId || n.tenantId === args.where.tenantId) &&
            (args.where.deletedAt === undefined || n.deletedAt === args.where.deletedAt)
        ) ?? null,
      findMany: async (args: any) =>
        ctx.networks.filter((n) => {
          const w = args.where;
          if (w.tenantId && n.tenantId !== w.tenantId) return false;
          if (w.deletedAt !== undefined && n.deletedAt !== w.deletedAt) return false;
          if (w.status && n.status !== w.status) return false;
          if (w.NOT?.apiKeyRef === null && n.apiKeyRef === null) return false;
          return true;
        }),
      update: async (args: any) => {
        const row = ctx.networks.find((n) => n.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    networkOffer: {
      findUnique: async (args: any) => {
        const k = args.where.tenantId_networkId_externalId;
        return (
          ctx.offers.find(
            (o) =>
              o.tenantId === k.tenantId &&
              o.networkId === k.networkId &&
              o.externalId === k.externalId
          ) ?? null
        );
      },
      create: async (args: any) => {
        const row = { ...args.data, payout: args.data.payout };
        ctx.offers.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = ctx.offers.find((o) => o.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    networkOfferPull: {
      create: async (args: any) => {
        ctx.pulls.push(args.data);
        return args.data;
      },
    },
  };
  return {
    prisma: fake as unknown as PrismaClient,
    getAdapterImpl: () => adapter,
    pepper: PEPPER,
    log: { info: () => {}, error: () => {} },
  };
}

function stubAdapter(offers: NetworkOffer[]): NetworkAdapter {
  return {
    kind: "impact",
    displayName: "Impact",
    defaultBaseUrl: "https://api.impact.com",
    pullOffers: async () => offers,
  };
}

function networkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NETWORK,
    tenantId: TENANT,
    name: "Impact",
    kind: "impact",
    website: null,
    apiConfigured: true,
    apiKeyRef: encryptApiKey("SID:TOKEN", PEPPER),
    apiBaseUrl: null,
    pullStatus: "NEVER",
    pullError: null,
    lastPullAt: null,
    status: "ACTIVE",
    deletedAt: null,
    ...overrides,
  };
}

describe("pullNetwork", () => {
  it("inserts new offers, counts them, and marks the pull SUCCESS", async () => {
    const ctx: Ctx = { networks: [networkRow()], offers: [], pulls: [] };
    const deps = buildDeps(ctx, stubAdapter([makeOffer("1"), makeOffer("2")]));

    const summary = await pullNetwork(deps, TENANT, NETWORK);

    expect(summary.status).toBe("SUCCESS");
    expect(summary.offerCount).toBe(2);
    expect(summary.newCount).toBe(2);
    expect(summary.updatedCount).toBe(0);
    expect(ctx.offers).toHaveLength(2);
    expect(ctx.pulls).toHaveLength(1);
    expect(ctx.pulls[0]).toMatchObject({ status: "SUCCESS", newCount: 2 });
    const net = ctx.networks[0];
    expect(net.pullStatus).toBe("SUCCESS");
    expect(net.lastPullAt).toBeInstanceOf(Date);
  });

  it("treats an unchanged second pull as seen-only (no new/updated)", async () => {
    const ctx: Ctx = { networks: [networkRow()], offers: [], pulls: [] };
    const deps = buildDeps(ctx, stubAdapter([makeOffer("1")]));

    await pullNetwork(deps, TENANT, NETWORK);
    const before = ctx.offers[0].lastSeenAt;
    const summary = await pullNetwork(deps, TENANT, NETWORK);

    expect(summary.newCount).toBe(0);
    expect(summary.updatedCount).toBe(0);
    expect(ctx.offers).toHaveLength(1);
    expect(ctx.offers[0].lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    );
  });

  it("counts changed offers as updated (name/payout drift)", async () => {
    const ctx: Ctx = { networks: [networkRow()], offers: [], pulls: [] };
    const deps = buildDeps(ctx, stubAdapter([makeOffer("1")]));
    await pullNetwork(deps, TENANT, NETWORK);

    const deps2 = buildDeps(
      ctx,
      stubAdapter([makeOffer("1", { name: "Offer 1 renamed", payout: 15 })])
    );
    const summary = await pullNetwork(deps2, TENANT, NETWORK);

    expect(summary.newCount).toBe(0);
    expect(summary.updatedCount).toBe(1);
    expect(ctx.offers[0].name).toBe("Offer 1 renamed");
    expect(ctx.offers[0].payout).toBe(15);
  });

  it("dedupes by [tenantId, networkId, externalId] across networks", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const ctx: Ctx = {
      networks: [networkRow(), networkRow({ id: other, name: "Impact 2" })],
      offers: [],
      pulls: [],
    };
    const deps = buildDeps(ctx, stubAdapter([makeOffer("1")]));
    await pullNetwork(deps, TENANT, NETWORK);
    await pullNetwork(deps, TENANT, other);
    expect(ctx.offers).toHaveLength(2);
    expect(new Set(ctx.offers.map((o) => o.networkId)).size).toBe(2);
  });

  it("records FAILED without throwing when the adapter blows up", async () => {
    const ctx: Ctx = { networks: [networkRow()], offers: [], pulls: [] };
    const badAdapter: NetworkAdapter = {
      kind: "impact",
      displayName: "Impact",
      pullOffers: async () => {
        throw new Error("connection reset");
      },
    };
    const deps = buildDeps(ctx, badAdapter);

    const summary = await pullNetwork(deps, TENANT, NETWORK);

    expect(summary.status).toBe("FAILED");
    expect(summary.error).toContain("connection reset");
    expect(ctx.pulls[0]).toMatchObject({ status: "FAILED" });
    expect(ctx.networks[0].pullStatus).toBe("FAILED");
    expect(ctx.networks[0].pullError).toContain("connection reset");
  });

  it("records FAILED with a friendly message when no credentials are configured", async () => {
    const ctx: Ctx = {
      networks: [networkRow({ apiKeyRef: null, apiConfigured: false })],
      offers: [],
      pulls: [],
    };
    const deps = buildDeps(ctx, stubAdapter([makeOffer("1")]));

    const summary = await pullNetwork(deps, TENANT, NETWORK);

    expect(summary.status).toBe("FAILED");
    expect(summary.error).toContain("API 凭证");
    expect(ctx.offers).toHaveLength(0);
  });

  it("throws NotFoundError for an unknown network id", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    const deps = buildDeps(ctx, stubAdapter([]));
    await expect(
      pullNetwork(deps, TENANT, "99999999-9999-4999-8999-999999999999")
    ).rejects.toThrow("Network not found");
  });
});

describe("startNetworkPullInBackground", () => {
  async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it("starts immediately, refuses a concurrent second start, and settles SUCCESS", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const adapter: NetworkAdapter = {
      kind: "impact",
      displayName: "Impact",
      defaultBaseUrl: "https://api.impact.com",
      pullOffers: async () => {
        calls += 1;
        await gate;
        return [makeOffer("1")];
      },
    };
    const ctx: Ctx = { networks: [networkRow()], offers: [], pulls: [] };
    const deps = buildDeps(ctx, adapter);

    expect(startNetworkPullInBackground(deps, TENANT, NETWORK)).toBe(true);
    expect(isNetworkPullInFlight(NETWORK)).toBe(true);
    // 在途时第二次启动被拒，适配器不会被调第二次。
    expect(startNetworkPullInBackground(deps, TENANT, NETWORK)).toBe(false);

    release();
    await waitFor(() => !isNetworkPullInFlight(NETWORK));
    expect(calls).toBe(1);
    expect(ctx.networks[0].pullStatus).toBe("SUCCESS");
    expect(ctx.offers).toHaveLength(1);

    // 落定后可以再次启动。
    expect(startNetworkPullInBackground(deps, TENANT, NETWORK)).toBe(true);
    await waitFor(() => !isNetworkPullInFlight(NETWORK));
    expect(calls).toBe(2);
  });

  it("settles FAILED (status + pullError in DB) when the adapter blows up", async () => {
    const adapter: NetworkAdapter = {
      kind: "impact",
      displayName: "Impact",
      defaultBaseUrl: "https://api.impact.com",
      pullOffers: async () => {
        throw new Error("upstream exploded");
      },
    };
    const ctx: Ctx = { networks: [networkRow()], offers: [], pulls: [] };
    const deps = buildDeps(ctx, adapter);

    expect(startNetworkPullInBackground(deps, TENANT, NETWORK)).toBe(true);
    await waitFor(() => !isNetworkPullInFlight(NETWORK));
    expect(ctx.networks[0].pullStatus).toBe("FAILED");
    expect(ctx.networks[0].pullError).toContain("upstream exploded");
    expect(ctx.pulls[0].status).toBe("FAILED");
  });

  it("swallows a crashed pull (unknown network) without unhandled rejection", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    const deps = buildDeps(ctx, stubAdapter([]));
    const MISSING = "99999999-9999-4999-8999-999999999999";
    // pullNetwork 对未知网络抛 NotFoundError；后台启动不得把它变成未处理 rejection。
    expect(startNetworkPullInBackground(deps, TENANT, MISSING)).toBe(true);
    expect(isNetworkPullInFlight(MISSING)).toBe(true);
    await waitFor(() => !isNetworkPullInFlight(MISSING));
  });
});

describe("pullAllConfiguredNetworks", () => {
  it("skips networks without credentials and pulls the rest", async () => {
    const ctx: Ctx = {
      networks: [
        networkRow(),
        networkRow({
          id: "44444444-4444-4444-8444-444444444444",
          name: "No creds",
          apiKeyRef: null,
          apiConfigured: false,
        }),
      ],
      offers: [],
      pulls: [],
    };
    const deps = buildDeps(ctx, stubAdapter([makeOffer("1")]));
    const results = await pullAllConfiguredNetworks(deps);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("SUCCESS");
  });
});

describe("per-adapter defaultBaseUrl (regression: no hardcoded Impact fallback)", () => {
  it("uses the adapter's own defaultBaseUrl when network.apiBaseUrl is empty", async () => {
    let capturedBaseUrl = "";
    const adapter: NetworkAdapter = {
      kind: "partnerboost",
      displayName: "PartnerBoost",
      defaultBaseUrl: "https://app.partnerboost.com",
      pullOffers: async (ctx) => {
        capturedBaseUrl = ctx.apiBaseUrl;
        return [];
      },
    };
    const ctx: Ctx = {
      networks: [networkRow({ kind: "partnerboost", apiBaseUrl: null })],
      offers: [],
      pulls: [],
    };
    const deps = buildDeps(ctx, adapter);
    await pullNetwork(deps, TENANT, NETWORK);
    expect(capturedBaseUrl).toBe("https://app.partnerboost.com");
    expect(capturedBaseUrl).not.toContain("impact.com");
  });

  it("prefers the user-configured apiBaseUrl over the adapter default", async () => {
    let capturedBaseUrl = "";
    const adapter: NetworkAdapter = {
      kind: "partnerboost",
      displayName: "PartnerBoost",
      defaultBaseUrl: "https://app.partnerboost.com",
      pullOffers: async (ctx) => {
        capturedBaseUrl = ctx.apiBaseUrl;
        return [];
      },
    };
    const ctx: Ctx = {
      networks: [
        networkRow({ kind: "partnerboost", apiBaseUrl: "https://custom.example.com/" }),
      ],
      offers: [],
      pulls: [],
    };
    const deps = buildDeps(ctx, adapter);
    await pullNetwork(deps, TENANT, NETWORK);
    expect(capturedBaseUrl).toBe("https://custom.example.com/");
  });
});
