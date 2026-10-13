"use server";

/**
 * 工作台状态持久化 server actions：{ok, data} | {ok:false, error}。
 * 供 client 组件调用；自动保存失败不打断用户操作（静默）。
 */
import { EntityApiError } from "./entities-config";
import {
  listWorkStateHistory,
  loadWorkState,
  saveWorkState,
  type WorkStateHistoryItem,
  type WorkStatePage,
} from "./work-state";

export type { WorkStateHistoryItem, WorkStatePage };

export type WorkStateActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  if (e instanceof EntityApiError) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: fallback };
}

export async function saveWorkStateAction(
  page: WorkStatePage,
  state: Record<string, unknown>,
  opts: { offerId?: string | null; label?: string | null } = {}
): Promise<WorkStateActionResult<{ id: string; updatedAt: string }>> {
  try {
    return { ok: true, data: await saveWorkState(page, state, opts) };
  } catch (e) {
    return mapError(e, "自动保存失败");
  }
}

export async function loadWorkStateAction(
  page: WorkStatePage,
  offerId?: string | null
): Promise<
  WorkStateActionResult<{
    state: Record<string, unknown> | null;
    label: string | null;
    updatedAt: string | null;
  }>
> {
  try {
    return { ok: true, data: await loadWorkState(page, offerId) };
  } catch (e) {
    return mapError(e, "读取保存的进度失败");
  }
}

export async function listWorkStateHistoryAction(
  page: WorkStatePage,
  opts: { offerId?: string | null; limit?: number } = {}
): Promise<WorkStateActionResult<WorkStateHistoryItem[]>> {
  try {
    return { ok: true, data: await listWorkStateHistory(page, opts) };
  } catch (e) {
    return mapError(e, "读取历史记录失败");
  }
}
