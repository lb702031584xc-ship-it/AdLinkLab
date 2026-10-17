"use server";

/** P1-27：数据导出/导入 server actions（仅 admin/owner 可调后端接口）。 */
import { exportData, importData, type DataExchangeKind } from "./data-exchange";
import { EntityApiError } from "./entities-config";

export type DataExchangeActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string) {
  if (e instanceof EntityApiError) return { ok: false as const, error: e.message };
  return { ok: false as const, error: fallback };
}

export async function exportDataAction(kind: DataExchangeKind, includeSensitive: boolean) {
  try {
    return { ok: true as const, data: await exportData(kind, includeSensitive) };
  } catch (e) {
    return mapError(e, "导出失败，请稍后重试。");
  }
}

export async function importDataAction(kind: DataExchangeKind, data: unknown) {
  try {
    return { ok: true as const, data: await importData(kind, data) };
  } catch (e) {
    return mapError(e, "导入失败，请稍后重试。");
  }
}
