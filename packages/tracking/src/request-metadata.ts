import {
  REQUEST_METADATA_LIMITS,
  type RequestMetadata,
  type RequestMetadataInput,
} from "@adlinklab/domain";

const FORBIDDEN_QUERY_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
]);

function trimTruncate(
  value: string | null | undefined,
  max: number
): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function flattenQueryValue(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return first == null ? undefined : String(first);
  }
  return String(value);
}

/**
 * Normalize inbound request metadata for click ingestion.
 * Does not record Authorization, Cookie, passwords, or full HTTP headers.
 */
export function normalizeRequestMetadata(
  input: RequestMetadataInput = {}
): RequestMetadata {
  const queryParameters: Record<string, string> = {};
  const raw = input.queryParameters ?? {};
  const keys = Object.keys(raw).slice(0, REQUEST_METADATA_LIMITS.maxQueryKeys);

  for (const key of keys) {
    const normalizedKey = key.trim().slice(0, REQUEST_METADATA_LIMITS.maxQueryKeyLength);
    if (!normalizedKey) continue;
    if (FORBIDDEN_QUERY_KEYS.has(normalizedKey.toLowerCase())) continue;

    const rawValue = flattenQueryValue(raw[key]);
    if (rawValue == null) continue;
    const value = rawValue
      .trim()
      .slice(0, REQUEST_METADATA_LIMITS.maxQueryValueLength);
    if (!value) continue;
    queryParameters[normalizedKey] = value;
  }

  return Object.freeze({
    ipAddress: trimTruncate(input.ipAddress ?? undefined, REQUEST_METADATA_LIMITS.ipMax),
    userAgent: trimTruncate(
      input.userAgent ?? undefined,
      REQUEST_METADATA_LIMITS.userAgentMax
    ),
    referer: trimTruncate(
      input.referer ?? undefined,
      REQUEST_METADATA_LIMITS.refererMax
    ),
    queryParameters: Object.freeze({ ...queryParameters }),
  });
}

export function extractTrackingParams(query: Readonly<Record<string, string>>): {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
} {
  return {
    gclid: query.gclid,
    gbraid: query.gbraid,
    wbraid: query.wbraid,
    utmSource: query.utm_source,
    utmMedium: query.utm_medium,
    utmCampaign: query.utm_campaign,
    utmTerm: query.utm_term,
    utmContent: query.utm_content,
  };
}
