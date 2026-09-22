/** Raw inbound request metadata before normalization. */
export interface RequestMetadataInput {
  ipAddress?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  queryParameters?: Record<string, string | string[] | undefined> | null;
}

/** Normalized, size-capped request metadata (no cookies / auth / passwords). */
export interface RequestMetadata {
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly referer?: string;
  readonly queryParameters: Readonly<Record<string, string>>;
}

export const REQUEST_METADATA_LIMITS = {
  userAgentMax: 1024,
  refererMax: 2048,
  ipMax: 64,
  maxQueryKeys: 50,
  maxQueryKeyLength: 128,
  maxQueryValueLength: 2048,
} as const;
