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

/** 手动 Offer（工作表手动输入，无库里 id）记忆，与库里 Offer 互斥。 */
const MANUAL_KEY = "adlinklab:manualOffer";

export interface ManualOffer {
  name: string;
  network: string;
  url: string;
  affiliateUrl?: string;
}

export function getManualOffer(): ManualOffer | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(MANUAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManualOffer>;
    if (typeof parsed?.name !== "string" || !parsed.name.trim()) return null;
    return {
      name: parsed.name.trim(),
      network: typeof parsed.network === "string" ? parsed.network.trim() : "",
      url: typeof parsed.url === "string" ? parsed.url.trim() : "",
      affiliateUrl:
        typeof parsed.affiliateUrl === "string" ? parsed.affiliateUrl.trim() : "",
    };
  } catch {
    return null;
  }
}

export function setManualOffer(manual: ManualOffer | null): void {
  try {
    if (typeof window === "undefined") return;
    if (manual && manual.name.trim()) {
      window.localStorage.setItem(
        MANUAL_KEY,
        JSON.stringify({
          name: manual.name.trim(),
          network: manual.network.trim(),
          url: manual.url.trim(),
          affiliateUrl: (manual.affiliateUrl ?? "").trim(),
        })
      );
    } else {
      window.localStorage.removeItem(MANUAL_KEY);
    }
  } catch {
    /* localStorage 不可用时静默 */
  }
}
