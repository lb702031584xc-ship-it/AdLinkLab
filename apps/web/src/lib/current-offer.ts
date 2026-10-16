/**
 * 全局“当前 offer”记忆：选一次 offer，到处都带。
 *
 * 每个页面（工作表 / 推广报告 / 投流页 / 自动化广告）选 offer 时记下来；
 * 别的页面没有 ?offerId= 时，默认用上次选的 offer 填充，不用每页重选。
 * ?offerId= 显式传入时以 URL 为准（并更新记忆）。
 */
const KEY = "adlinklab:lastOfferId";

export function getLastOfferId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastOfferId(id: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* localStorage 不可用时静默：记忆是便利，不是必需 */
  }
}
