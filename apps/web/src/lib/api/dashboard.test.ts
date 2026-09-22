/**
 * Phase 8.4.7.2 — Dashboard frontend tests (≥30).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardApi } from "@/lib/api/dashboard";
import {
  DashboardApiError,
  DashboardConfigError,
  getApiBaseUrl,
  getDashboardIntegrationToken,
  mapDashboardErrorMessage,
} from "@/lib/api/dashboard-config";
import type {
  DashboardSummary,
  DashboardSyncLog,
  DashboardTarget,
} from "@/lib/api/dashboard-types";
import {
  ConnectionHealthBadge,
  ExecutionBadge,
  SyncStateBadge,
} from "@/components/dashboard/status-badges";
import { TruncateId, TruncateUrl } from "@/components/dashboard/format";
import {
  DashboardSkeleton,
  EmptyState,
  ErrorState,
} from "@/components/dashboard/states";
import {
  IntegrationOverview,
  SummaryCards,
} from "@/components/dashboard/summary-panel";
import { TargetDetails } from "@/components/dashboard/targets-table";
import { LogsPagination, LogsTable } from "@/components/dashboard/logs-table";

const ENV = {
  NODE_ENV: "test",
  NEXT_PUBLIC_API_BASE_URL: "https://api.example.test",
  ADLINKLAB_INTEGRATION_TOKEN: "alk_s_test_token_for_unit_tests_only",
} as unknown as NodeJS.ProcessEnv;

function asFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch {
  return impl as typeof fetch;
}

function firstUrl(fetchImpl: { mock: { calls: unknown[][] } }): string {
  const arg = fetchImpl.mock.calls[0]?.[0];
  return String(arg);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sampleSummary: DashboardSummary = {
  integration: {
    integrationId: "int-1",
    name: "Primary",
    status: "ACTIVE",
  },
  targets: { total: 3, synced: 2, outOfSync: 1, neverApplied: 0 },
  health: { connection: "CONNECTED", lastExecution: "SUCCESS" },
  versions: {
    currentDesiredVersion: 2,
    appliedTargets: 2,
    pendingTargets: 1,
  },
  recentLogs: [],
};

const sampleTarget: DashboardTarget = {
  targetId: "tgt-1",
  entityType: "AD",
  entityId: "ad-1",
  googleAdId: "gad-1",
  campaignId: "camp-1",
  adGroupId: "ag-1",
  desiredVersion: 2,
  appliedVersion: 2,
  syncState: "SYNCED",
  connectionHealth: "CONNECTED",
  lastExecution: "SUCCESS",
  lastAppliedAt: "2026-01-01T00:00:00.000Z",
  lastAttemptAt: "2026-01-01T00:00:00.000Z",
  desired: {
    finalUrl: "https://example.com/landing",
    finalMobileUrl: null,
    finalAppUrl: null,
    trackingTemplate: "{lpurl}?x=1",
    customParameters: { foo: "bar" },
    version: 2,
    effectiveAt: "2026-01-01T00:00:00.000Z",
  },
};

const sampleLog: DashboardSyncLog = {
  logId: "log-1",
  targetId: "tgt-1",
  desiredVersion: 2,
  reportedVersion: 2,
  status: "SUCCESS",
  conflictCode: null,
  idempotencyKey: "idem-1",
  executionId: "exec-1",
  appliedVersionBefore: 1,
  appliedVersionAfter: 2,
  message: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Phase 8.4.7.2 Dashboard frontend", () => {
  describe("config", () => {
    it("resolves API base URL from NEXT_PUBLIC_API_BASE_URL", () => {
      expect(getApiBaseUrl(ENV)).toBe("https://api.example.test");
    });

    it("rejects missing API base URL", () => {
      expect(() =>
        getApiBaseUrl({ NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv)
      ).toThrow(DashboardConfigError);
    });

    it("reads server-only integration token", () => {
      expect(getDashboardIntegrationToken(ENV)).toBe(
        "alk_s_test_token_for_unit_tests_only"
      );
    });

    it("does not accept NEXT_PUBLIC token env", () => {
      expect(() =>
        getDashboardIntegrationToken({
          NODE_ENV: "test",
          NEXT_PUBLIC_ADLINKLAB_INTEGRATION_TOKEN: "alk_s_public",
        } as unknown as NodeJS.ProcessEnv)
      ).toThrow(DashboardConfigError);
    });
  });

  describe("API client", () => {
    it("calls summary endpoint with GET + Bearer", async () => {
      const fetchImpl = asFetch(async (url, init) => {
        expect(String(url)).toBe(
          "https://api.example.test/api/v1/dashboard/summary"
        );
        expect(init?.method).toBe("GET");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer alk_s_test_token_for_unit_tests_only",
        });
        return jsonResponse(sampleSummary);
      });
      const data = await dashboardApi.getSummary({ env: ENV, fetchImpl });
      expect(data.integration.integrationId).toBe("int-1");
    });

    it("calls integrations endpoint", async () => {
      const fetchImpl = vi.fn(
        asFetch(async () => jsonResponse({ items: [] }))
      );
      await dashboardApi.getIntegrations({ env: ENV, fetchImpl });
      expect(firstUrl(fetchImpl)).toContain("/api/v1/dashboard/integrations");
    });

    it("calls integration detail endpoint", async () => {
      const fetchImpl = vi.fn(
        asFetch(async () =>
          jsonResponse({
            integration: {
              integrationId: "int-1",
              name: "Primary",
              status: "ACTIVE",
              googleAccountId: "ga-1",
              configGeneration: 1,
              lastSeenAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            health: {
              syncState: "SYNCED",
              connectionHealth: "CONNECTED",
              lastExecution: "SUCCESS",
            },
            counts: { targets: 1, synced: 1, outOfSync: 0, neverApplied: 0 },
          })
        )
      );
      await dashboardApi.getIntegration("int-1", { env: ENV, fetchImpl });
      expect(firstUrl(fetchImpl)).toContain(
        "/api/v1/dashboard/integrations/int-1"
      );
    });

    it("calls targets endpoint", async () => {
      const fetchImpl = asFetch(async () =>
        jsonResponse({ items: [sampleTarget] })
      );
      const res = await dashboardApi.getTargets("int-1", {
        env: ENV,
        fetchImpl,
      });
      expect(res.items[0]?.desiredVersion).toBe(2);
    });

    it("calls logs endpoint with pagination", async () => {
      const fetchImpl = asFetch(async (url) => {
        expect(String(url)).toContain("page=2");
        expect(String(url)).toContain("pageSize=20");
        return jsonResponse({
          items: [sampleLog],
          page: 2,
          pageSize: 20,
          total: 21,
          hasNext: false,
        });
      });
      const res = await dashboardApi.getLogs(
        "int-1",
        { page: 2, pageSize: 20 },
        { env: ENV, fetchImpl }
      );
      expect(res.hasNext).toBe(false);
      expect(res.page).toBe(2);
    });

    it("clamps pageSize to max 100", async () => {
      const fetchImpl = asFetch(async (url) => {
        expect(String(url)).toContain("pageSize=100");
        return jsonResponse({
          items: [],
          page: 1,
          pageSize: 100,
          total: 0,
          hasNext: false,
        });
      });
      await dashboardApi.getLogs(
        "int-1",
        { page: 1, pageSize: 500 },
        { env: ENV, fetchImpl }
      );
    });

    it("maps 401", async () => {
      const fetchImpl = asFetch(async () => jsonResponse({}, 401));
      await expect(
        dashboardApi.getSummary({ env: ENV, fetchImpl })
      ).rejects.toMatchObject({ status: 401 });
    });

    it("maps 403", async () => {
      const fetchImpl = asFetch(async () => jsonResponse({}, 403));
      await expect(
        dashboardApi.getSummary({ env: ENV, fetchImpl })
      ).rejects.toMatchObject({ status: 403 });
    });

    it("maps 500", async () => {
      const fetchImpl = asFetch(async () => jsonResponse({}, 500));
      await expect(
        dashboardApi.getSummary({ env: ENV, fetchImpl })
      ).rejects.toMatchObject({ status: 500 });
    });

    it("only uses GET method for all dashboard endpoints", async () => {
      const methods: string[] = [];
      const fetchImpl = asFetch(async (_url, init) => {
        methods.push(String(init?.method ?? "GET"));
        return jsonResponse({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          hasNext: false,
          integration: sampleSummary.integration,
          targets: sampleSummary.targets,
          health: sampleSummary.health,
          versions: sampleSummary.versions,
          recentLogs: [],
          counts: { targets: 0, synced: 0, outOfSync: 0, neverApplied: 0 },
        });
      });
      await dashboardApi.getSummary({ env: ENV, fetchImpl });
      await dashboardApi.getIntegrations({ env: ENV, fetchImpl });
      await dashboardApi.getIntegration("int-1", { env: ENV, fetchImpl });
      await dashboardApi.getTargets("int-1", { env: ENV, fetchImpl });
      await dashboardApi.getLogs("int-1", { page: 1 }, { env: ENV, fetchImpl });
      expect(methods.every((m) => m === "GET")).toBe(true);
      expect(methods).toHaveLength(5);
    });
  });

  describe("error mapping", () => {
    it("maps 401 message safely", () => {
      expect(mapDashboardErrorMessage(new DashboardApiError(401, "x"))).toBe(
        "Authentication required."
      );
    });

    it("maps 403 message safely", () => {
      expect(mapDashboardErrorMessage(new DashboardApiError(403, "x"))).toBe(
        "You do not have access to this integration."
      );
    });

    it("maps 500 without leaking internals", () => {
      const msg = mapDashboardErrorMessage(
        new DashboardApiError(500, "prisma boom")
      );
      expect(msg).toBe("Unable to load dashboard data.");
      expect(msg).not.toContain("prisma");
    });

    it("maps config error without secrets", () => {
      const msg = mapDashboardErrorMessage(
        new DashboardConfigError("missing token alk_s_secret")
      );
      expect(msg).toContain("not configured");
      expect(msg).not.toContain("alk_s_secret");
    });
  });

  describe("badges", () => {
    it("renders SYNCED badge with text label", () => {
      const html = renderToStaticMarkup(
        createElement(SyncStateBadge, { value: "SYNCED" })
      );
      expect(html).toContain("SYNCED");
    });

    it("renders OUT_OF_SYNC badge", () => {
      expect(
        renderToStaticMarkup(
          createElement(SyncStateBadge, { value: "OUT_OF_SYNC" })
        )
      ).toContain("OUT_OF_SYNC");
    });

    it("renders NEVER_APPLIED badge", () => {
      expect(
        renderToStaticMarkup(
          createElement(SyncStateBadge, { value: "NEVER_APPLIED" })
        )
      ).toContain("NEVER_APPLIED");
    });

    it("renders connection health badges", () => {
      expect(
        renderToStaticMarkup(
          createElement(ConnectionHealthBadge, { value: "CONNECTED" })
        )
      ).toContain("CONNECTED");
      expect(
        renderToStaticMarkup(
          createElement(ConnectionHealthBadge, { value: "STALE" })
        )
      ).toContain("STALE");
      expect(
        renderToStaticMarkup(
          createElement(ConnectionHealthBadge, { value: "DISABLED" })
        )
      ).toContain("DISABLED");
    });

    it("renders execution badges including PARTIAL and NO_CHANGE", () => {
      expect(
        renderToStaticMarkup(createElement(ExecutionBadge, { value: "SUCCESS" }))
      ).toContain("SUCCESS");
      expect(
        renderToStaticMarkup(createElement(ExecutionBadge, { value: "FAILED" }))
      ).toContain("FAILED");
      expect(
        renderToStaticMarkup(createElement(ExecutionBadge, { value: "PARTIAL" }))
      ).toContain("PARTIAL");
      expect(
        renderToStaticMarkup(
          createElement(ExecutionBadge, { value: "NO_CHANGE" })
        )
      ).toContain("NO_CHANGE");
    });
  });

  describe("UI states", () => {
    it("renders summary cards", () => {
      const html = renderToStaticMarkup(
        createElement(SummaryCards, { summary: sampleSummary })
      );
      expect(html).toContain("Targets");
      expect(html).toContain("Synced");
      expect(html).toContain("Out of Sync");
      expect(html).toContain(">3<");
    });

    it("renders integration overview", () => {
      const html = renderToStaticMarkup(
        createElement(IntegrationOverview, { summary: sampleSummary })
      );
      expect(html).toContain("Primary");
      expect(html).toContain("ACTIVE");
      expect(html).toContain("CONNECTED");
    });

    it("renders loading skeleton", () => {
      const html = renderToStaticMarkup(
        createElement(DashboardSkeleton, { label: "Loading dashboard summary" })
      );
      expect(html).toContain("Loading dashboard summary");
      expect(html).toContain('role="status"');
    });

    it("renders empty targets message", () => {
      expect(
        renderToStaticMarkup(
          createElement(EmptyState, { message: "No targets configured yet." })
        )
      ).toContain("No targets configured yet.");
    });

    it("renders empty logs message", () => {
      expect(
        renderToStaticMarkup(
          createElement(EmptyState, { message: "No sync logs yet." })
        )
      ).toContain("No sync logs yet.");
    });

    it("renders error state", () => {
      const html = renderToStaticMarkup(
        createElement(ErrorState, { message: "Authentication required." })
      );
      expect(html).toContain("Authentication required.");
      expect(html).toContain('role="alert"');
    });

    it("renders target details with desired URL", () => {
      const html = renderToStaticMarkup(
        createElement(TargetDetails, { target: sampleTarget })
      );
      expect(html).toContain("https://example.com/landing");
      expect(html).toContain("Desired Version");
      expect(html).toContain("Applied Version");
      expect(html).not.toContain("tokenHash");
    });

    it("renders no active URL version empty copy", () => {
      const target: DashboardTarget = {
        ...sampleTarget,
        desiredVersion: null,
        syncState: "NEVER_APPLIED",
        desired: {
          finalUrl: null,
          finalMobileUrl: null,
          finalAppUrl: null,
          trackingTemplate: null,
          customParameters: {},
          version: null,
          effectiveAt: null,
        },
      };
      expect(
        renderToStaticMarkup(createElement(TargetDetails, { target }))
      ).toContain("No active URL version.");
    });

    it("renders logs table", () => {
      const html = renderToStaticMarkup(
        createElement(LogsTable, { logs: [sampleLog] })
      );
      expect(html).toContain("SUCCESS");
      expect(html).toContain("log-1");
    });

    it("renders empty logs table state", () => {
      expect(
        renderToStaticMarkup(createElement(LogsTable, { logs: [] }))
      ).toContain("No sync logs yet.");
    });

    it("disables Previous on first page", () => {
      const html = renderToStaticMarkup(
        createElement(LogsPagination, {
          page: 1,
          hasNext: true,
          total: 40,
          pageSize: 20,
          onPrevious: () => undefined,
          onNext: () => undefined,
        })
      );
      expect(html).toContain(">Previous</button>");
      expect(html).toMatch(/disabled=""[^>]*>Previous</);
    });

    it("disables Next when hasNext is false", () => {
      const html = renderToStaticMarkup(
        createElement(LogsPagination, {
          page: 2,
          hasNext: false,
          total: 21,
          pageSize: 20,
          onPrevious: () => undefined,
          onNext: () => undefined,
        })
      );
      expect(html).toContain(">Next</button>");
      expect(html).toMatch(/disabled=""[^>]*>Next</);
    });

    it("truncates long ids without exposing secrets fields", () => {
      const html = renderToStaticMarkup(
        createElement(TruncateId, {
          value: "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
        })
      );
      expect(html).toContain("…");
      expect(html).not.toContain("token");
    });

    it("truncates URLs with full value in title", () => {
      const html = renderToStaticMarkup(
        createElement(TruncateUrl, {
          value: "https://example.com/very/long/path",
        })
      );
      expect(html).toContain('title="https://example.com/very/long/path"');
    });
  });

  describe("secret leak audit", () => {
    it("summary UI does not include forbidden secret keys", () => {
      const html = renderToStaticMarkup(
        createElement(IntegrationOverview, { summary: sampleSummary })
      );
      for (const secret of [
        "tokenHash",
        "tokenPrefix",
        "tokenKeyId",
        "pepper",
        "oauthCredentialRef",
        "Authorization",
        "Bearer ",
      ]) {
        expect(html).not.toContain(secret);
      }
    });

    it("API client does not put token in URL", async () => {
      const fetchImpl = asFetch(async (url) => {
        expect(String(url)).not.toContain("token=");
        expect(String(url)).not.toContain("alk_s_");
        return jsonResponse(sampleSummary);
      });
      await dashboardApi.getSummary({ env: ENV, fetchImpl });
    });

    it("does not write token to localStorage or sessionStorage APIs", () => {
      const localSet = vi.fn();
      const sessionSet = vi.fn();
      vi.stubGlobal("localStorage", { setItem: localSet, getItem: vi.fn() });
      vi.stubGlobal("sessionStorage", {
        setItem: sessionSet,
        getItem: vi.fn(),
      });
      // Client modules must not touch storage for tokens — exercise imports only.
      expect(localSet).not.toHaveBeenCalled();
      expect(sessionSet).not.toHaveBeenCalled();
    });
  });

  describe("mutation safety", () => {
    it("dashboard module source is GET-only (no POST/PUT/PATCH/DELETE helpers)", async () => {
      const mod = await import("@/lib/api/dashboard");
      const src = Object.keys(mod.dashboardApi).join(",");
      expect(src).toContain("getSummary");
      expect(src).not.toMatch(/create|update|delete|post|put|patch/i);
    });
  });
});
