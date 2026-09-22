import {
  createPaginatedResult,
  type PaginationInput,
  type PaginatedResult,
} from "@adlinklab/shared";

export function normalizePagination(input?: PaginationInput): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 50));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function paginateArray<T>(
  items: T[],
  input?: PaginationInput
): PaginatedResult<T> {
  const { page, pageSize, skip } = normalizePagination(input);
  return createPaginatedResult(items.slice(skip, skip + pageSize), items.length, page, pageSize);
}

export function asRecord(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = String(v);
    }
    return out;
  }
  return {};
}

export function asUnknownRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
