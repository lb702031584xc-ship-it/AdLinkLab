/**
 * Phase 8.4.8 — Script Runtime Simulator (TEST / LAB ONLY).
 *
 * CONFIG → Script semantics → Mock apply → Sync Result → Applied State → Log
 *
 * NO real Google Ads mutation
 * NO real network
 * NO production route exposure
 */

import type { FastifyInstance } from "fastify";
import {
  SCRIPT_API_VERSION,
  SCRIPT_GENERATOR_VERSION,
  buildGoogleAdsScriptSource,
} from "../services/script-generator-source.js";
import {
  assertTestRuntime,
  SCRIPT_RUNTIME_SIMULATOR_MARKER,
} from "./assert-test-runtime.js";
import { MockAdsApp } from "./mock-ads-app.js";
import { MockLogger } from "./mock-logger.js";
import {
  MockUrlFetchApp,
  installNetworkGuard,
  type MockFetchOptions,
  type MockHttpResponse,
} from "./mock-url-fetch-app.js";
import { MockUtilities } from "./mock-utilities.js";
import { runScriptRuntimeAdapter } from "./script-runtime-adapter.js";
import type {
  ScriptRuntimeResult,
  ScriptRuntimeScenario,
  ScriptRuntimeSyncBehavior,
} from "./types.js";

export { SCRIPT_RUNTIME_SIMULATOR_MARKER };

const FIXED_STARTED = "2026-09-20T00:00:00.000Z";
const FIXED_COMPLETED = "2026-09-20T00:00:01.000Z";

export interface ScriptRuntimeSimulatorDeps {
  /** Fastify app with script routes registered (inject only). */
  app: FastifyInstance;
  /** Resolve appliedVersion after sync for a target. */
  resolveAppliedVersion: (targetId: string) => Promise<number | null>;
  /**
   * Snapshot applied versions before run (keyed by ScriptSyncTarget.id).
   * Pass empty map when unknown; adapter still records results.
   */
  snapshotAppliedVersions: () => Promise<Map<string, number | null>>;
}

export type ScriptRuntimeSimulatorRunOptions = ScriptRuntimeScenario;

export class ScriptRuntimeSimulator {
  readonly marker = SCRIPT_RUNTIME_SIMULATOR_MARKER;
  adsApp: MockAdsApp;
  utilities: MockUtilities;
  logger: MockLogger;
  urlFetchApp: MockUrlFetchApp;
  private readonly deps: ScriptRuntimeSimulatorDeps;
  private uninstallNetworkGuard: (() => void) | null = null;
  private loseResponseRemaining = 0;
  private loseResponseStatus = 500;
  private activeSyncBehavior: ScriptRuntimeSyncBehavior | undefined;

  constructor(deps: ScriptRuntimeSimulatorDeps) {
    assertTestRuntime();
    this.deps = deps;
    this.adsApp = new MockAdsApp();
    this.utilities = new MockUtilities();
    this.logger = new MockLogger();
    this.urlFetchApp = new MockUrlFetchApp({
      handler: (url, options) => this.defaultHandler(url, options),
    });
  }

  reset(): void {
    this.adsApp = new MockAdsApp();
    this.utilities = new MockUtilities();
    this.logger = new MockLogger();
    this.urlFetchApp.clear();
    this.loseResponseRemaining = 0;
    this.activeSyncBehavior = undefined;
    this.urlFetchApp.setAfterHandler(undefined);
    this.urlFetchApp.setHandler((url, options) =>
      this.defaultHandler(url, options)
    );
  }

  /**
   * Build generated source for the scenario (in-memory only — never persisted).
   */
  generateSource(scenario: ScriptRuntimeScenario): string {
    assertTestRuntime();
    return buildGoogleAdsScriptSource({
      integrationId: scenario.integrationId,
      token: scenario.token,
      configEndpoint: scenario.configEndpoint,
      syncResultEndpoint: scenario.syncResultEndpoint,
      generatorVersion: SCRIPT_GENERATOR_VERSION,
      apiVersion: SCRIPT_API_VERSION,
    });
  }

  private applySyncBehavior(
    behavior: ScriptRuntimeSyncBehavior | undefined
  ): void {
    this.activeSyncBehavior = behavior;
    if (!behavior || behavior === "normal") {
      this.loseResponseRemaining = 0;
      this.urlFetchApp.setAfterHandler(undefined);
      return;
    }
    if (behavior.loseResponseStatus) {
      this.loseResponseStatus = behavior.loseResponseStatus;
      this.loseResponseRemaining = behavior.loseResponseTimes ?? 1;
      this.urlFetchApp.setAfterHandler(async (url, _opts, response) => {
        if (
          isSyncPath(url) &&
          this.loseResponseRemaining > 0 &&
          response.statusCode >= 200 &&
          response.statusCode < 300
        ) {
          this.loseResponseRemaining -= 1;
          return {
            statusCode: this.loseResponseStatus,
            body: JSON.stringify({ error: "SIMULATED_RESPONSE_LOST" }),
          };
        }
        return response;
      });
    } else {
      this.urlFetchApp.setAfterHandler(undefined);
    }
  }

  private async defaultHandler(
    url: string,
    options: MockFetchOptions
  ): Promise<MockHttpResponse> {
    assertTestRuntime();
    const behavior =
      this.activeSyncBehavior && this.activeSyncBehavior !== "normal"
        ? this.activeSyncBehavior
        : undefined;

    if (behavior?.forceConfigStatus && isConfigPath(url)) {
      return {
        statusCode: behavior.forceConfigStatus,
        body: behavior.malformedConfig
          ? "{not-json"
          : JSON.stringify({ error: "FORCED_CONFIG_FAILURE" }),
      };
    }
    if (behavior?.malformedConfig && isConfigPath(url)) {
      return { statusCode: 200, body: "{not-json" };
    }
    if (behavior?.forceSyncStatus && isSyncPath(url)) {
      return {
        statusCode: behavior.forceSyncStatus,
        body: JSON.stringify({ error: "FORCED_SYNC_FAILURE" }),
      };
    }

    return this.injectToApp(url, options);
  }

  private async injectToApp(
    url: string,
    options: MockFetchOptions
  ): Promise<MockHttpResponse> {
    let path: string;
    try {
      const parsed = new URL(url);
      path = parsed.pathname + parsed.search;
    } catch {
      path = url.startsWith("/") ? url : `/${url}`;
    }

    const method = (options.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
    };
    if (options.contentType) {
      headers["content-type"] = options.contentType;
    }

    let payload: string | object | undefined = undefined;
    if (options.payload) {
      try {
        payload = JSON.parse(options.payload) as object;
      } catch {
        payload = options.payload;
      }
    }

    const res = await this.deps.app.inject({
      method: method as "GET" | "POST",
      url: path,
      headers,
      payload,
    });

    return {
      statusCode: res.statusCode,
      body: typeof res.body === "string" ? res.body : JSON.stringify(res.body),
    };
  }

  async run(
    scenario: ScriptRuntimeSimulatorRunOptions
  ): Promise<ScriptRuntimeResult> {
    assertTestRuntime();
    this.uninstallNetworkGuard = installNetworkGuard();
    try {
      this.adsApp = new MockAdsApp();
      this.utilities = new MockUtilities({
        uuidSequence: [scenario.executionId],
      });
      this.logger = new MockLogger();
      this.urlFetchApp.clear();
      this.urlFetchApp.setHandler((url, options) =>
        this.defaultHandler(url, options)
      );

      for (const ad of scenario.ads) {
        this.adsApp.seedAd({
          id: ad.id,
          urls: (ad.urls as Record<string, string>) ?? {},
        });
      }

      if (scenario.applyBehavior === "fail_all") {
        for (const ad of scenario.ads) {
          this.adsApp.addApplyFailAdId(ad.id);
        }
      } else if (
        scenario.applyBehavior &&
        typeof scenario.applyBehavior === "object" &&
        "failAdIds" in scenario.applyBehavior
      ) {
        for (const id of scenario.applyBehavior.failAdIds) {
          this.adsApp.addApplyFailAdId(id);
        }
      }

      this.applySyncBehavior(scenario.syncBehavior);

      // Generate source in memory only — never persist.
      void this.generateSource(scenario);

      const appliedBefore = await this.deps.snapshotAppliedVersions();

      const result = await runScriptRuntimeAdapter({
        globals: {
          AdsApp: this.adsApp,
          UrlFetchApp: this.urlFetchApp,
          Utilities: this.utilities,
          Logger: this.logger,
        },
        adlinklab: {
          generatorVersion: SCRIPT_GENERATOR_VERSION,
          apiVersion: SCRIPT_API_VERSION,
          integrationId: scenario.integrationId,
          configEndpoint: scenario.configEndpoint,
          syncResultEndpoint: scenario.syncResultEndpoint,
          token: scenario.token,
          maxHttpRetries: 3,
        },
        executionId: scenario.executionId,
        startedAt: scenario.startedAt ?? FIXED_STARTED,
        completedAt: scenario.completedAt ?? FIXED_COMPLETED,
        appliedVersionBefore: appliedBefore,
        resolveAppliedAfter: (targetId) =>
          this.deps.resolveAppliedVersion(targetId),
        afterConfigHook: scenario.afterConfigHook,
      });

      this.logger.assertNoSecrets();
      return result;
    } finally {
      this.uninstallNetworkGuard?.();
      this.uninstallNetworkGuard = null;
    }
  }
}

function isSyncPath(url: string): boolean {
  return url.includes("/api/v1/script/sync-result");
}

function isConfigPath(url: string): boolean {
  return url.includes("/api/v1/script/config");
}
