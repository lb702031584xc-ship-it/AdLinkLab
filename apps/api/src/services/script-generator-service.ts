/**
 * Phase 8.4.6 — Script Generator (READ ONLY).
 * Emits Google Ads Script source for the authenticated Integration.
 * Never persists source or plaintext token.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { ForbiddenError, ValidationError } from "@adlinklab/shared";
import type { IntegrationAuthContext } from "../auth/integration-auth.js";
import {
  SCRIPT_API_VERSION,
  SCRIPT_GENERATOR_VERSION,
  buildGoogleAdsScriptSource,
} from "./script-generator-source.js";

export interface ScriptGeneratorRequest {
  /** Optional override; otherwise SCRIPT_API_BASE_URL / PUBLIC_API_BASE_URL. */
  baseUrl?: string;
  /**
   * Optional plaintext token — must match Authorization Bearer when provided.
   * Used only in memory for embedding into source; never persisted.
   */
  token?: string;
}

export interface ScriptGeneratorResponse {
  integrationId: string;
  scriptVersion: string;
  apiVersion: string;
  configEndpoint: string;
  syncResultEndpoint: string;
  source: string;
}

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function isTestEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.VITEST) || env.NODE_ENV === "test";
}

function safeEqualUtf8(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Resolve API base URL for generated Script endpoints.
 * Rejects missing / invalid / loopback (unless test) configurations.
 */
export function resolveScriptApiBaseUrl(
  input: { baseUrl?: string },
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (
    input.baseUrl ??
    env.SCRIPT_API_BASE_URL ??
    env.PUBLIC_API_BASE_URL ??
    ""
  ).trim();

  if (!raw) {
    throw new ValidationError(
      "SCRIPT_API_BASE_URL is required to generate Script source",
      { code: "SCRIPT_API_BASE_URL_MISSING" }
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("Invalid Script API base URL", {
      code: "SCRIPT_API_BASE_URL_INVALID",
    });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError("Script API base URL must be http(s)", {
      code: "SCRIPT_API_BASE_URL_INVALID",
    });
  }

  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) && !isTestEnv(env)) {
    throw new ValidationError(
      "Script API base URL must not point to localhost in non-test environments",
      { code: "SCRIPT_API_BASE_URL_LOOPBACK" }
    );
  }

  // Normalize: strip trailing slash
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export function joinScriptEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export class ScriptGeneratorService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /**
   * Generate Script source for the authenticated Integration only.
   * READ ONLY — does not mutate Integration / Target / UrlVersion / appliedVersion / logs.
   */
  generate(
    ctx: IntegrationAuthContext,
    authorizationToken: string,
    body: ScriptGeneratorRequest = {}
  ): ScriptGeneratorResponse {
    if (body.token !== undefined && body.token !== null) {
      if (typeof body.token !== "string" || !body.token) {
        throw new ValidationError("token must be a non-empty string");
      }
      if (!safeEqualUtf8(body.token, authorizationToken)) {
        throw new ForbiddenError(
          "body token does not match Authorization token"
        );
      }
    }

    // Prefer Authorization token (already authenticated). Body token only validates match.
    const embedToken = authorizationToken;

    const baseUrl = resolveScriptApiBaseUrl(
      { baseUrl: body.baseUrl },
      this.env
    );
    const configEndpoint = joinScriptEndpoint(
      baseUrl,
      "/api/v1/script/config"
    );
    const syncResultEndpoint = joinScriptEndpoint(
      baseUrl,
      "/api/v1/script/sync-result"
    );

    const source = buildGoogleAdsScriptSource({
      integrationId: ctx.integrationId,
      token: embedToken,
      configEndpoint,
      syncResultEndpoint,
      generatorVersion: SCRIPT_GENERATOR_VERSION,
      apiVersion: SCRIPT_API_VERSION,
    });

    return {
      integrationId: ctx.integrationId,
      scriptVersion: SCRIPT_GENERATOR_VERSION,
      apiVersion: SCRIPT_API_VERSION,
      configEndpoint,
      syncResultEndpoint,
      source,
    };
  }
}
