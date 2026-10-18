/**
 * Google Trends 品牌/关键词相对热度（免费、无需 key）。
 *
 * 流程：GET /trends/api/explore 取 TIMESERIES widget 的 token
 * → GET /trends/api/widgetdata/multiline 取 timeline
 * → default.averages（多词各一个）或 timelineData 按词取平均 → 0-100。
 *
 * 注意：
 * - 返回体前 5 个字符是 `)]}',` 防 XSSI 前缀，必须剥离。
 * - 机房 IP 可能被 429/403：返回 { value: null, rateLimited: true }，
 *   调用方可据此在 UI 写明"被限流"，而不是笼统的"暂无数据"。
 * - 其他失败（解析失败/无数据/网络异常）→ { value: null, rateLimited: false }。
 * - 失败时 console.warn 记录状态码，方便排查；绝不抛错。
 * - Redis 缓存 24h（key `traffic:trends:<geo>:<kw1,kw2>`）；redis 不可用时
 *   跳过缓存，不抛错。调用方不传 redis 则不缓存。
 *
 * 重要：返回的是相对热度（0-100），绝不是访问量/搜索量；展示时必须注明。
 */
const TRENDS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CACHE_TTL_SECONDS = 86400;

/** Redis 缓存最小接口（ioredis 的 Redis 满足该结构；测试可用 stub）。 */
export interface TrendsCache {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
}

function cacheKey(keywords: string[], geo: string): string {
  return `traffic:trends:${geo}:${keywords.join(",")}`;
}

/** 剥离 Google API 的 `)]}',` 防 XSSI 前缀。 */
function stripXssiPrefix(text: string): string {
  return text.startsWith(")]}',") ? text.slice(5) : text;
}

async function readCache(
  redis: TrendsCache | undefined,
  key: string
): Promise<number | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    if (cached === null || cached === "") return null;
    const n = Number(cached);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // redis 不可用 → 跳过缓存
  }
}

async function writeCache(
  redis: TrendsCache | undefined,
  key: string,
  value: number
): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, String(value));
  } catch {
    // redis 不可用 → 跳过缓存，不抛错
  }
}

interface TrendsWidget {
  id?: unknown;
  token?: unknown;
}

/** 从 widgetdata 响应计算平均热度：优先 averages，退回 timelineData。 */
function averageInterest(data: unknown, keywordCount: number): number | null {
  const root = data as {
    default?: { averages?: unknown; timelineData?: unknown };
  };
  const averages = root?.default?.averages;
  if (Array.isArray(averages) && averages.length > 0) {
    const nums = averages.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v)
    );
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  const timeline = root?.default?.timelineData;
  if (Array.isArray(timeline) && timeline.length > 0) {
    const sums = new Array<number>(keywordCount).fill(0);
    const counts = new Array<number>(keywordCount).fill(0);
    for (const entry of timeline) {
      const values = (entry as { value?: unknown })?.value;
      if (!Array.isArray(values)) continue;
      for (let i = 0; i < keywordCount; i++) {
        const v = values[i];
        if (typeof v === "number" && Number.isFinite(v)) {
          sums[i] = (sums[i] ?? 0) + v;
          counts[i] = (counts[i] ?? 0) + 1;
        }
      }
    }
    const perKeyword: number[] = [];
    for (let i = 0; i < keywordCount; i++) {
      const c = counts[i] ?? 0;
      if (c > 0) perKeyword.push((sums[i] ?? 0) / c);
    }
    if (perKeyword.length === 0) return null;
    return perKeyword.reduce((a, b) => a + b, 0) / perKeyword.length;
  }
  return null;
}

/** getKeywordInterest 的返回：热度值 + 是否被限流（可区分展示）。 */
export interface TrendsInterestResult {
  /** 平均相对热度（0-100）；null 表示暂无数据 */
  value: number | null;
  /**
   * true = 请求被限流（HTTP 429/403，机房 IP 常见）；
   * false = 其他失败（解析失败/无数据/网络异常）或成功。
   */
  rateLimited: boolean;
}

/** Trends 时间线单点：周粒度，time 为毫秒时间戳，value 为该周相对热度（0-100）。 */
export interface TrendsTimelinePoint {
  time: number;
  value: number;
}

/** getKeywordTimeline 的返回：周粒度时间线 + 是否被限流。 */
export interface TrendsTimelineResult {
  /** 过去 12 个月周粒度时间线（按时间升序）；空 = 无数据 */
  points: TrendsTimelinePoint[];
  rateLimited: boolean;
}

type TrendsFetchOutcome =
  | { ok: true; data: unknown }
  | { ok: false; rateLimited: boolean; detail: string };

/** explore → widgetdata 两步取原始 widgetdata JSON（interest 与 timeline 共用）。 */
async function fetchTrendsWidgetData(
  keywords: string[],
  geo: string,
  fetchImpl: typeof fetch
): Promise<TrendsFetchOutcome> {
  const comparisonItem = keywords.map((keyword) => ({
    keyword,
    geo,
    time: "today 12-m",
  }));

  // 1. explore：拿 TIMESERIES widget 的 token
  const exploreUrl =
    "https://trends.google.com/trends/api/explore?hl=en-US&tz=-240&req=" +
    encodeURIComponent(
      JSON.stringify({ comparisonItem, category: 0, property: "" })
    );
  let exploreRes: Response;
  try {
    exploreRes = await fetchImpl(exploreUrl, {
      headers: { "User-Agent": TRENDS_UA },
    });
  } catch (e) {
    return { ok: false, rateLimited: false, detail: `explore 网络异常：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!exploreRes.ok) {
    if (exploreRes.status === 429 || exploreRes.status === 403) {
      console.warn(
        `[traffic][trends] explore 被限流：HTTP ${exploreRes.status}（疑似机房 IP 被 Google 限流，免费热度不可用）`
      );
      return { ok: false, rateLimited: true, detail: `explore HTTP ${exploreRes.status}` };
    }
    return { ok: false, rateLimited: false, detail: `explore HTTP ${exploreRes.status}` };
  }
  let exploreJson: { widgets?: TrendsWidget[] };
  try {
    exploreJson = JSON.parse(stripXssiPrefix(await exploreRes.text())) as {
      widgets?: TrendsWidget[];
    };
  } catch {
    return { ok: false, rateLimited: false, detail: "explore 响应 JSON 解析失败" };
  }
  const widgets = exploreJson?.widgets;
  if (!Array.isArray(widgets)) return { ok: false, rateLimited: false, detail: "explore 响应无 widgets 数组" };
  const token = widgets.find((w) => w?.id === "TIMESERIES")?.token;
  if (typeof token !== "string" || !token) {
    return { ok: false, rateLimited: false, detail: "explore 响应无 TIMESERIES token" };
  }

  // 2. widgetdata/multiline：拿 timeline 数据
  const widgetUrl =
    "https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-240&req=" +
    encodeURIComponent(
      JSON.stringify({
        time: "today 12-m",
        resolution: "WEEK",
        locale: "en-US",
        comparisonItem,
        requestOptions: { property: "", backend: "IZG", category: 0 },
        token,
      })
    );
  let dataRes: Response;
  try {
    dataRes = await fetchImpl(widgetUrl, {
      headers: { "User-Agent": TRENDS_UA },
    });
  } catch (e) {
    return { ok: false, rateLimited: false, detail: `widgetdata 网络异常：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!dataRes.ok) {
    if (dataRes.status === 429 || dataRes.status === 403) {
      console.warn(
        `[traffic][trends] widgetdata 被限流：HTTP ${dataRes.status}（疑似机房 IP 被 Google 限流，免费热度不可用）`
      );
      return { ok: false, rateLimited: true, detail: `widgetdata HTTP ${dataRes.status}` };
    }
    return { ok: false, rateLimited: false, detail: `widgetdata HTTP ${dataRes.status}` };
  }
  try {
    const data: unknown = JSON.parse(stripXssiPrefix(await dataRes.text()));
    return { ok: true, data };
  } catch {
    return { ok: false, rateLimited: false, detail: "widgetdata 响应 JSON 解析失败" };
  }
}

/** 从 widgetdata 响应取单关键词周粒度时间线（按时间升序；time 可能是秒字符串）。 */
export function parseTrendsTimeline(data: unknown, keywordIndex = 0): TrendsTimelinePoint[] {
  const root = data as { default?: { timelineData?: unknown } };
  const timeline = root?.default?.timelineData;
  if (!Array.isArray(timeline)) return [];
  const points: TrendsTimelinePoint[] = [];
  for (const entry of timeline) {
    const e = entry as { time?: unknown; value?: unknown };
    const rawTime = Number(e?.time);
    const values = e?.value;
    if (!Number.isFinite(rawTime) || !Array.isArray(values)) continue;
    const v = values[keywordIndex];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    // Trends time 是秒级时间戳（字符串或数字）；> 1e12 则已是毫秒。
    const ms = rawTime > 1e12 ? rawTime : rawTime * 1000;
    points.push({ time: ms, value: v });
  }
  points.sort((a, b) => a.time - b.time);
  return points;
}

async function fetchTrendsInterest(
  keywords: string[],
  geo: string,
  fetchImpl: typeof fetch
): Promise<TrendsInterestResult> {
  const outcome = await fetchTrendsWidgetData(keywords, geo, fetchImpl);
  if (!outcome.ok) {
    if (outcome.rateLimited) return { value: null, rateLimited: true };
    console.warn(`[traffic][trends] 获取失败：${outcome.detail}`);
    return { value: null, rateLimited: false };
  }
  return { value: averageInterest(outcome.data, keywords.length), rateLimited: false };
}

/** 取单关键词周粒度时间线（过去 12 个月）。失败 → 空数组，绝不抛错。 */
async function fetchTrendsTimeline(
  keyword: string,
  geo: string,
  fetchImpl: typeof fetch
): Promise<TrendsTimelineResult> {
  const outcome = await fetchTrendsWidgetData([keyword], geo, fetchImpl);
  if (!outcome.ok) {
    if (outcome.rateLimited) return { points: [], rateLimited: true };
    console.warn(`[traffic][trends] 时间线获取失败：${outcome.detail}`);
    return { points: [], rateLimited: false };
  }
  return { points: parseTrendsTimeline(outcome.data, 0), rateLimited: false };
}

/**
 * 取关键词平均相对热度（0-100，多词取各词平均）。
 * 从不抛错：空关键词 / 限流 / 解析失败 / 无数据 / 网络异常
 * → { value: null, rateLimited }。
 */
export async function getKeywordInterest(
  keywords: string[],
  geo = "US",
  fetchImpl: typeof fetch = fetch,
  redis?: TrendsCache
): Promise<TrendsInterestResult> {
  const kws = keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return { value: null, rateLimited: false };
  const key = cacheKey(kws, geo);

  const cached = await readCache(redis, key);
  if (cached !== null) return { value: cached, rateLimited: false };

  try {
    const result = await fetchTrendsInterest(kws, geo, fetchImpl);
    if (result.value !== null) await writeCache(redis, key, result.value);
    return result;
  } catch (e) {
    console.warn(
      `[traffic][trends] 未预期异常：${e instanceof Error ? e.message : String(e)}`
    );
    return { value: null, rateLimited: false };
  }
}

function timelineCacheKey(keyword: string, geo: string): string {
  return `traffic:trends:timeline:${geo}:${keyword}`;
}

async function readTimelineCache(
  redis: TrendsCache | undefined,
  key: string
): Promise<TrendsTimelinePoint[] | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    if (cached === null || cached === "") return null;
    const parsed: unknown = JSON.parse(cached);
    if (!Array.isArray(parsed)) return null;
    const points = parsed.filter(
      (p): p is TrendsTimelinePoint =>
        typeof (p as TrendsTimelinePoint)?.time === "number" &&
        typeof (p as TrendsTimelinePoint)?.value === "number"
    );
    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

async function writeTimelineCache(
  redis: TrendsCache | undefined,
  key: string,
  points: TrendsTimelinePoint[]
): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(points));
  } catch {
    // redis 不可用 → 跳过缓存，不抛错
  }
}

/**
 * 取单关键词周粒度时间线（过去 12 个月，相对热度 0-100）。
 * 从不抛错：空关键词 / 限流 / 解析失败 / 无数据 / 网络异常
 * → { points: [], rateLimited }。结果缓存 24h。
 */
export async function getKeywordTimeline(
  keyword: string,
  geo = "US",
  fetchImpl: typeof fetch = fetch,
  redis?: TrendsCache
): Promise<TrendsTimelineResult> {
  const kw = keyword.trim();
  if (!kw) return { points: [], rateLimited: false };
  const key = timelineCacheKey(kw, geo);

  const cached = await readTimelineCache(redis, key);
  if (cached !== null) return { points: cached, rateLimited: false };

  try {
    const result = await fetchTrendsTimeline(kw, geo, fetchImpl);
    if (result.points.length > 0) await writeTimelineCache(redis, key, result.points);
    return result;
  } catch (e) {
    console.warn(
      `[traffic][trends] 时间线未预期异常：${e instanceof Error ? e.message : String(e)}`
    );
    return { points: [], rateLimited: false };
  }
}
