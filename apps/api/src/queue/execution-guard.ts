/**
 * Phase 8.3.3 — same-process exclusive execution gate.
 *
 * Serializes HTTP execute ∥ Worker delivery for a given jobId so provider
 * mutations cannot overlap in one Node process. Cross-process safety still
 * relies on SyncJob COMPLETED + domain terminal skips (SUCCEEDED / UPLOADED).
 *
 * Re-entrant: nested calls with the same jobId (Worker → processIdempotentJob
 * → execute) do not deadlock.
 *
 * Waiters are chained (FIFO) so two concurrent acquirers cannot both pass
 * the wait loop after the holder releases.
 */

const tails = new Map<string, Promise<void>>();
const reentry = new Map<string, number>();

export function mutationLockKey(jobId: string): string {
  return `job:${jobId}`;
}

/**
 * Run `fn` exclusively for `key`. Waiters resume after the holder finishes
 * and should re-check terminal domain/SyncJob state before mutating.
 */
export async function withMutationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const depth = reentry.get(key) ?? 0;
  if (depth > 0) {
    reentry.set(key, depth + 1);
    try {
      return await fn();
    } finally {
      const next = (reentry.get(key) ?? 1) - 1;
      if (next <= 0) reentry.delete(key);
      else reentry.set(key, next);
    }
  }

  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Chain: next waiter awaits our gate after we finish.
  const chained = prev.then(() => gate);
  tails.set(key, chained);

  await prev;
  reentry.set(key, 1);
  try {
    return await fn();
  } finally {
    reentry.delete(key);
    release();
    // Drop map entry once our chain link has settled and we are still the tip.
    void chained.then(() => {
      if (tails.get(key) === chained) {
        tails.delete(key);
      }
    });
  }
}

/** Test helper — clears in-process gates between cases if needed. */
export function resetMutationLocksForTests(): void {
  tails.clear();
  reentry.clear();
}
