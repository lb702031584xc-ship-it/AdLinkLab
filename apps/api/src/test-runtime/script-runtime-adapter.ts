/**
 * Phase 8.4.8 — Script Runtime Adapter.
 *
 * Maps production generated Script semantics to Node test runtime.
 * Does NOT eval production source (GAS is sync; Node handlers are async).
 * Behavior must stay aligned with script-generator-source.ts.
 *
 * TEST_ONLY
 */

import { assertTestRuntime } from "./assert-test-runtime.js";
import type { MockAdsApp } from "./mock-ads-app.js";
import type { MockLogger } from "./mock-logger.js";
import type { MockUrlFetchApp } from "./mock-url-fetch-app.js";
import type { MockUtilities } from "./mock-utilities.js";
import type {
  ScriptRuntimeResult,
  ScriptRuntimeTargetResult,
  ScriptRuntimeTargetStatus,
} from "./types.js";

export interface AdapterGlobals {
  AdsApp: MockAdsApp;
  UrlFetchApp: MockUrlFetchApp;
  Utilities: MockUtilities;
  Logger: MockLogger;
}

export interface AdapterConfig {
  generatorVersion: string;
  apiVersion: string;
  integrationId: string;
  configEndpoint: string;
  syncResultEndpoint: string;
  token: string;
  maxHttpRetries: number;
}

export interface AdapterRunInput {
  globals: AdapterGlobals;
  adlinklab: AdapterConfig;
  /** Deterministic executionId — overrides Utilities.getUuid(). */
  executionId?: string;
  startedAt: string;
  completedAt: string;
  /** Snapshot appliedVersion before run: targetId → version. */
  appliedVersionBefore: Map<string, number | null>;
  /** Resolve appliedVersion after run. */
  resolveAppliedAfter: (targetId: string) => Promise<number | null>;
  afterConfigHook?: () => Promise<void> | void;
}

type ConfigTarget = {
  targetId?: string;
  entityType?: string;
  desiredVersion?: number | null;
  configurationState?: string;
  googleAdId?: string;
  finalUrl?: string | null;
  finalMobileUrl?: string | null;
  finalAppUrl?: string | null;
  trackingTemplate?: string | null;
  customParameters?: Record<string, string>;
};

type HttpLast = { statusCode: number; body: string } | null;

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    Math.floor(value) === value
  );
}

/**
 * Port of generated Script main() + helpers — async because MockUrlFetchApp is async.
 */
export async function runScriptRuntimeAdapter(
  input: AdapterRunInput
): Promise<ScriptRuntimeResult> {
  assertTestRuntime();
  const { AdsApp, UrlFetchApp, Utilities, Logger } = input.globals;
  const ADLINKLAB = input.adlinklab;
  const targetResults: ScriptRuntimeTargetResult[] = [];
  let targetsSucceeded = 0;
  let targetsFailed = 0;
  let targetsSkipped = 0;

  const httpJson_ = async (
    method: string,
    url: string,
    payload: unknown,
    allowRetry: boolean
  ): Promise<HttpLast> => {
    let attempt = 0;
    let last: HttpLast = null;
    const max = allowRetry ? ADLINKLAB.maxHttpRetries : 1;
    while (attempt < max) {
      attempt++;
      try {
        const options: {
          method: string;
          muteHttpExceptions: boolean;
          headers: Record<string, string>;
          contentType?: string;
          payload?: string;
        } = {
          method,
          muteHttpExceptions: true,
          headers: {
            Authorization: `Bearer ${ADLINKLAB.token}`,
            Accept: "application/json",
          },
        };
        if (payload !== null && payload !== undefined) {
          options.contentType = "application/json";
          options.payload = JSON.stringify(payload);
        }
        const res = await UrlFetchApp.fetch(url, options);
        last = {
          statusCode: res.getResponseCode(),
          body: res.getContentText(),
        };
        if (last.statusCode === 401 || last.statusCode === 403) {
          return last;
        }
        if (last.statusCode === 409) {
          return last;
        }
        if (last.statusCode >= 500 && attempt < max) {
          Utilities.sleep(250 * attempt);
          continue;
        }
        return last;
      } catch {
        if (attempt >= max) {
          return null;
        }
        Utilities.sleep(250 * attempt);
      }
    }
    return last;
  };

  const fetchConfig_ = async (): Promise<{ targets?: ConfigTarget[] } | null> => {
    const response = await httpJson_("GET", ADLINKLAB.configEndpoint, null, true);
    if (!response) return null;
    if (response.statusCode === 401 || response.statusCode === 403) {
      Logger.log(`AdLinkLab auth failed status=${response.statusCode}`);
      return null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      Logger.log(`AdLinkLab config HTTP status=${response.statusCode}`);
      return null;
    }
    try {
      return JSON.parse(response.body) as { targets?: ConfigTarget[] };
    } catch {
      Logger.log("AdLinkLab config parse error");
      return null;
    }
  };

  const applyAdUrls_ = (target: ConfigTarget): boolean => {
    try {
      const iterator = AdsApp.ads()
        .withCondition(
          `Id = "${String(target.googleAdId ?? "").replace(/"/g, "")}"`
        )
        .get();
      if (!iterator.hasNext()) {
        Logger.log(`ad not found targetId=${target.targetId}`);
        return false;
      }
      const ad = iterator.next();
      const urls = ad.urls();
      if (target.finalUrl) {
        urls.setFinalUrl(String(target.finalUrl));
      }
      if (target.finalMobileUrl !== null && target.finalMobileUrl !== undefined) {
        urls.setFinalMobileUrl(String(target.finalMobileUrl));
      }
      if (
        target.finalAppUrl !== null &&
        target.finalAppUrl !== undefined &&
        typeof urls.setFinalAppUrl === "function"
      ) {
        urls.setFinalAppUrl(String(target.finalAppUrl));
      }
      if (
        target.trackingTemplate !== null &&
        target.trackingTemplate !== undefined
      ) {
        urls.setTrackingTemplate(String(target.trackingTemplate));
      }
      if (target.customParameters && typeof target.customParameters === "object") {
        urls.setCustomParameters(target.customParameters);
      }
      return true;
    } catch {
      Logger.log(
        `apply failed targetId=${target.targetId} desiredVersion=${target.desiredVersion}`
      );
      return false;
    }
  };

  const parseConflictCode = (body: string): string | undefined => {
    try {
      const parsed = JSON.parse(body) as { error?: string; code?: string };
      return parsed.error ?? parsed.code;
    } catch {
      return undefined;
    }
  };

  const reportResult_ = async (
    targetId: string,
    desiredVersion: number,
    result: "SUCCESS" | "FAILED",
    executionId: string,
    applySucceeded: boolean
  ): Promise<void> => {
    if (!targetId || !isPositiveInt(desiredVersion)) return;
    const idempotencyKey = `${ADLINKLAB.integrationId}:${targetId}:${String(desiredVersion)}:${String(executionId)}`;
    const payload = {
      targetId,
      desiredVersion,
      result,
      idempotencyKey,
    };
    const response = await httpJson_(
      "POST",
      ADLINKLAB.syncResultEndpoint,
      payload,
      true
    );
    const before = input.appliedVersionBefore.get(targetId) ?? null;
    let status: ScriptRuntimeTargetStatus;
    let conflictCode: string | undefined;
    let error: string | undefined;
    let syncHttpStatus: number | undefined;

    if (!response) {
      Logger.log(`sync-result transport failed targetId=${targetId}`);
      status = "TRANSPORT_FAILED";
      error = "transport_failed";
      targetsFailed += 1;
    } else {
      syncHttpStatus = response.statusCode;
      if (response.statusCode === 401 || response.statusCode === 403) {
        Logger.log(`sync-result auth failed status=${response.statusCode}`);
        status = "AUTH_FAILED";
        error = "auth_failed";
        targetsFailed += 1;
      } else if (response.statusCode === 409) {
        Logger.log(
          `sync-result conflict targetId=${targetId} desiredVersion=${desiredVersion}`
        );
        status = "CONFLICT";
        conflictCode = parseConflictCode(response.body);
        targetsFailed += 1;
      } else if (response.statusCode < 200 || response.statusCode >= 300) {
        Logger.log(
          `sync-result HTTP status=${response.statusCode} targetId=${targetId}`
        );
        status = result === "SUCCESS" ? "FAILED" : "FAILED";
        error = `http_${response.statusCode}`;
        targetsFailed += 1;
      } else {
        status = result === "SUCCESS" ? "SUCCESS" : "FAILED";
        if (result === "SUCCESS") targetsSucceeded += 1;
        else targetsFailed += 1;
      }
    }

    const after = await input.resolveAppliedAfter(targetId);
    targetResults.push({
      targetId,
      desiredVersion,
      appliedVersionBefore: before,
      appliedVersionAfter: after,
      status,
      conflictCode,
      error,
      syncHttpStatus,
      applySucceeded,
    });
  };

  const processTarget_ = async (
    target: ConfigTarget,
    executionId: string
  ): Promise<void> => {
    if (!target || !target.targetId) {
      targetsSkipped += 1;
      return;
    }
    if (target.entityType !== "AD") {
      await reportResult_(
        target.targetId,
        target.desiredVersion as number,
        "FAILED",
        executionId,
        false
      );
      return;
    }
    if (!isPositiveInt(target.desiredVersion)) {
      Logger.log(
        `skip targetId=${target.targetId} invalid desiredVersion`
      );
      targetsSkipped += 1;
      targetResults.push({
        targetId: target.targetId,
        desiredVersion: target.desiredVersion ?? null,
        appliedVersionBefore:
          input.appliedVersionBefore.get(target.targetId) ?? null,
        appliedVersionAfter: await input.resolveAppliedAfter(target.targetId),
        status: "SKIPPED",
        error: "invalid_desired_version",
      });
      return;
    }
    if (
      target.configurationState === "NEVER_CONFIGURED" ||
      target.desiredVersion === null
    ) {
      Logger.log(
        `skip targetId=${target.targetId} no ACTIVE desired version`
      );
      targetsSkipped += 1;
      targetResults.push({
        targetId: target.targetId,
        desiredVersion: null,
        appliedVersionBefore:
          input.appliedVersionBefore.get(target.targetId) ?? null,
        appliedVersionAfter: await input.resolveAppliedAfter(target.targetId),
        status: "SKIPPED",
        error: "NO_ACTIVE_VERSION",
      });
      return;
    }
    if (!target.googleAdId) {
      await reportResult_(
        target.targetId,
        target.desiredVersion,
        "FAILED",
        executionId,
        false
      );
      return;
    }

    const applyOk = applyAdUrls_(target);
    const result = applyOk ? "SUCCESS" : "FAILED";
    await reportResult_(
      target.targetId,
      target.desiredVersion,
      result,
      executionId,
      applyOk
    );
  };

  const executionId = input.executionId ?? Utilities.getUuid();
  const config = await fetchConfig_();
  if (!config) {
    return {
      executionId,
      integrationId: ADLINKLAB.integrationId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      targetsProcessed: 0,
      targetsSucceeded: 0,
      targetsFailed: 0,
      targetsSkipped: 0,
      logs: [...Logger.inMemoryLogs],
      targetResults,
      googleAdsProviderInvocations: UrlFetchApp.googleAdsProviderInvocations,
      realNetworkCalls: 0,
    };
  }

  if (input.afterConfigHook) {
    await input.afterConfigHook();
  }

  const targets = config.targets || [];
  for (let i = 0; i < targets.length; i++) {
    await processTarget_(targets[i]!, executionId);
  }

  return {
    executionId,
    integrationId: ADLINKLAB.integrationId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    targetsProcessed: targets.length,
    targetsSucceeded,
    targetsFailed,
    targetsSkipped,
    logs: [...Logger.inMemoryLogs],
    targetResults,
    googleAdsProviderInvocations: UrlFetchApp.googleAdsProviderInvocations,
    realNetworkCalls: 0,
  };
}
