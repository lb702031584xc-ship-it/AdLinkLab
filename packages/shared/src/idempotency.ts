export function createIdempotencyKey(...parts: Array<string | number | undefined | null>): string {
  return parts
    .filter((p) => p !== undefined && p !== null && String(p).length > 0)
    .map(String)
    .join(":");
}

export interface IdempotentJobPayload {
  idempotencyKey: string;
  attempt?: number;
}
