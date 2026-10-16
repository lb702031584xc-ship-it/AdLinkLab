/**
 * 专家营销口吻的参考来源之一：DataForSEO SERP API 搜同品类成功广告。
 *
 * 调 google/organic/live/advanced（同 brand-bidding.ts 的 endpoint / 凭证 / 请求体），
 * 优先取结果里的付费广告项，无付费广告时回落取自然结果。最多 5 条。
 * 请求失败抛 AiError（带 DataForSEO 返回的错误信息），不静默吞错。
 */
import { AiError } from "./llm.js";
import type { SerpReferenceAd } from "./ad-generator.js";

const SERP_API_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

export const MAX_SERP_REFERENCE_ADS = 5;

export interface SerpAdsDeps {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

interface SerpItem {
  type?: unknown;
  title?: unknown;
  description?: unknown;
  domain?: unknown;
  url?: unknown;
}

function toAd(item: SerpItem): SerpReferenceAd | null {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const description =
    typeof item.description === "string" ? item.description.trim() : "";
  if (!title || !description) return null;
  const displayUrl =
    typeof item.domain === "string" && item.domain.trim()
      ? item.domain.trim()
      : typeof item.url === "string" && item.url.trim()
        ? item.url.trim()
        : undefined;
  return { title, description, displayUrl };
}

/**
 * 搜 query 的 SERP，返回成功广告参考（付费广告优先，无则自然结果）。
 * 返回空数组表示 SERP 里没有任何可用条目（调用方按"搜不到"处理，不静默生成）。
 */
export async function fetchSerpAds(
  query: string,
  creds: { login: string; password: string },
  deps: SerpAdsDeps = {}
): Promise<SerpReferenceAd[]> {
  const q = query.trim();
  if (!q) return [];
  const fetchImpl = deps.fetchImpl ?? fetch;
  let items: SerpItem[];
  try {
    const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
    const res = await fetchImpl(SERP_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keyword: q,
          location_code: 2840, // 美国
          language_code: "en",
          device: "desktop",
          os: "windows",
        },
      ]),
    });
    if (!res.ok) {
      throw new AiError(`DataForSEO 请求失败（HTTP ${res.status}）`);
    }
    const data = (await res.json()) as {
      tasks?: Array<{
        status_code?: number;
        status_message?: string;
        result?: Array<{ items?: SerpItem[] }>;
      }>;
    };
    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      throw new AiError(
        `DataForSEO 任务异常（status_code=${task?.status_code ?? "?"}${task?.status_message ? `：${task.status_message}` : ""}）`
      );
    }
    items = task.result?.[0]?.items ?? [];
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(
      `DataForSEO SERP 搜索失败（${e instanceof Error ? e.message : String(e)}）`
    );
  }
  // 优先付费广告项；没有时回落自然结果。
  const paid = items.filter((it) => it?.type === "paid");
  const pool = paid.length > 0 ? paid : items.filter((it) => it?.type === "organic");
  const out: SerpReferenceAd[] = [];
  for (const item of pool) {
    const ad = toAd(item);
    if (ad) out.push(ad);
    if (out.length >= MAX_SERP_REFERENCE_ADS) break;
  }
  return out;
}
