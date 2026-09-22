export type EntityStatus = "active" | "paused" | "archived" | "draft";

export type JobStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "waiting";

export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown";

export type SyncJobType =
  | "googleAdsSync"
  | "urlChange"
  | "conversionUpload"
  | "clickProcessing"
  | "analyticsAggregation";

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function createPaginatedResult<T>(
  items: T[],
  total: number,
  page = 1,
  pageSize = 50
): PaginatedResult<T> {
  return { items, total, page, pageSize };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
