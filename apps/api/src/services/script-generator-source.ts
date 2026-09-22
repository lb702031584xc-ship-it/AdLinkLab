/**
 * Phase 8.4.6 — Safe Google Ads Script source generation.
 * Target runtime: Google Ads Scripts (UrlFetchApp / AdsApp), NOT Node.js.
 */
export const SCRIPT_GENERATOR_VERSION = "8.4.6";
export const SCRIPT_API_VERSION = "v1";

/** Escape a value as a JavaScript string literal (quotes included). */
export function jsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

export interface ScriptSourceParams {
  integrationId: string;
  token: string;
  configEndpoint: string;
  syncResultEndpoint: string;
  generatorVersion?: string;
  apiVersion?: string;
}

/**
 * Build Google Ads Script source. Token/URLs are injected via JSON.stringify
 * to prevent quote / injection escapes.
 */
export function buildGoogleAdsScriptSource(params: ScriptSourceParams): string {
  const generatorVersion = params.generatorVersion ?? SCRIPT_GENERATOR_VERSION;
  const apiVersion = params.apiVersion ?? SCRIPT_API_VERSION;
  const integrationIdLit = jsStringLiteral(params.integrationId);
  const tokenLit = jsStringLiteral(params.token);
  const configUrlLit = jsStringLiteral(params.configEndpoint);
  const syncUrlLit = jsStringLiteral(params.syncResultEndpoint);
  const genVerLit = jsStringLiteral(generatorVersion);
  const apiVerLit = jsStringLiteral(apiVersion);

  return `/**
 * AdLinkLab generated Google Ads Script
 * Generator version: ${generatorVersion}
 * API version: ${apiVersion}
 *
 * READS desired URL configuration from AdLinkLab Config API (ACTIVE UrlVersion).
 * APPLIES configuration via AdsApp official APIs.
 * REPORTS results to AdLinkLab Sync Result API.
 *
 * Do not log Authorization headers or tokens.
 */
var ADLINKLAB = {
  generatorVersion: ${genVerLit},
  apiVersion: ${apiVerLit},
  integrationId: ${integrationIdLit},
  configEndpoint: ${configUrlLit},
  syncResultEndpoint: ${syncUrlLit},
  token: ${tokenLit},
  maxHttpRetries: 3
};

function main() {
  var executionId = Utilities.getUuid();
  var config = fetchConfig_();
  if (!config) {
    return;
  }
  var targets = config.targets || [];
  for (var i = 0; i < targets.length; i++) {
    processTarget_(targets[i], executionId);
  }
}

function fetchConfig_() {
  var response = httpJson_("GET", ADLINKLAB.configEndpoint, null, true);
  if (!response) {
    return null;
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    Logger.log("AdLinkLab auth failed status=" + response.statusCode);
    return null;
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    Logger.log("AdLinkLab config HTTP status=" + response.statusCode);
    return null;
  }
  try {
    return JSON.parse(response.body);
  } catch (e) {
    Logger.log("AdLinkLab config parse error");
    return null;
  }
}

function processTarget_(target, executionId) {
  if (!target || !target.targetId) {
    return;
  }
  if (target.entityType !== "AD") {
    reportResult_(target.targetId, target.desiredVersion, "FAILED", executionId);
    return;
  }
  if (!isPositiveInt_(target.desiredVersion)) {
    Logger.log("skip targetId=" + target.targetId + " invalid desiredVersion");
    return;
  }
  if (target.configurationState === "NEVER_CONFIGURED" || target.desiredVersion === null) {
    Logger.log("skip targetId=" + target.targetId + " no ACTIVE desired version");
    return;
  }
  if (!target.googleAdId) {
    reportResult_(target.targetId, target.desiredVersion, "FAILED", executionId);
    return;
  }

  var applyOk = applyAdUrls_(target);
  var result = applyOk ? "SUCCESS" : "FAILED";
  reportResult_(target.targetId, target.desiredVersion, result, executionId);
}

function applyAdUrls_(target) {
  try {
    var iterator = AdsApp.ads()
      .withCondition('Id = "' + String(target.googleAdId).replace(/"/g, "") + '"')
      .get();
    if (!iterator.hasNext()) {
      Logger.log("ad not found targetId=" + target.targetId);
      return false;
    }
    var ad = iterator.next();
    var urls = ad.urls();
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
    if (target.trackingTemplate !== null && target.trackingTemplate !== undefined) {
      urls.setTrackingTemplate(String(target.trackingTemplate));
    }
    if (target.customParameters && typeof target.customParameters === "object") {
      urls.setCustomParameters(target.customParameters);
    }
    return true;
  } catch (e) {
    Logger.log(
      "apply failed targetId=" +
        target.targetId +
        " desiredVersion=" +
        target.desiredVersion
    );
    return false;
  }
}

function reportResult_(targetId, desiredVersion, result, executionId) {
  if (!targetId || !isPositiveInt_(desiredVersion)) {
    return;
  }
  var idempotencyKey =
    ADLINKLAB.integrationId +
    ":" +
    targetId +
    ":" +
    String(desiredVersion) +
    ":" +
    String(executionId);
  var payload = {
    targetId: targetId,
    desiredVersion: desiredVersion,
    result: result,
    idempotencyKey: idempotencyKey
  };
  var response = httpJson_("POST", ADLINKLAB.syncResultEndpoint, payload, true);
  if (!response) {
    Logger.log("sync-result transport failed targetId=" + targetId);
    return;
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    Logger.log("sync-result auth failed status=" + response.statusCode);
    return;
  }
  if (response.statusCode === 409) {
    Logger.log(
      "sync-result conflict targetId=" +
        targetId +
        " desiredVersion=" +
        desiredVersion
    );
    return;
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    Logger.log(
      "sync-result HTTP status=" +
        response.statusCode +
        " targetId=" +
        targetId
    );
  }
}

function httpJson_(method, url, payload, allowRetry) {
  var attempt = 0;
  var last = null;
  var max = allowRetry ? ADLINKLAB.maxHttpRetries : 1;
  while (attempt < max) {
    attempt++;
    try {
      var options = {
        method: method,
        muteHttpExceptions: true,
        headers: {
          Authorization: "Bearer " + ADLINKLAB.token,
          Accept: "application/json"
        }
      };
      if (payload !== null && payload !== undefined) {
        options.contentType = "application/json";
        options.payload = JSON.stringify(payload);
      }
      var res = UrlFetchApp.fetch(url, options);
      last = {
        statusCode: res.getResponseCode(),
        body: res.getContentText()
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
    } catch (e) {
      if (attempt >= max) {
        return null;
      }
      Utilities.sleep(250 * attempt);
    }
  }
  return last;
}

function isPositiveInt_(value) {
  return typeof value === "number" && isFinite(value) && value >= 1 && Math.floor(value) === value;
}
`;
}

/** Banned substrings for static security audit of generated source. */
export const SCRIPT_SOURCE_BANNED_PATTERNS = [
  "proxy",
  "Proxy",
  "User-Agent",
  "Referer",
  "X-Forwarded-For",
  "X-Real-IP",
  "cloaking",
  "anti-detection",
  "require(",
  "module.exports",
  "process.",
  "document.",
  "window.",
] as const;

export function assertScriptSourceSafe(source: string): string[] {
  const hits: string[] = [];
  for (const p of SCRIPT_SOURCE_BANNED_PATTERNS) {
    if (source.includes(p)) hits.push(p);
  }
  // Node ESM import form (space after import)
  if (/\bimport\s+/.test(source)) hits.push("import ");
  return hits;
}
