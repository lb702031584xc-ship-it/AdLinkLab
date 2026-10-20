/**
 * 广告投放数量（对标 AutoAds）：按品牌+国家查 Google SERP 付费广告数。
 *
 * - 数据源：DataForSEO SERP `google/organic/live/advanced`（凭证复用流量信号
 *   凭证：AiSetting `traffic.dataforseoLogin` / `traffic.dataforseoPassword`，
 *   加密存储）。凭证缺失 → 抛错（明确提示未配置），不静默返回假数据。
 * - 口径：keyword = 品牌名，数 SERP items 里 type === "paid" 的条数。
 *   广告落地页域名含品牌名 → 自投（self）；其余 → 他投（others）。
 *   落地页是 Amazon 的商品分不清自投/他投（谁投落地页都是 amazon.com），
 *   只记 total，self/others 记 null。
 * - 缓存：同一（品牌，国家）组内任一商品 14 天内查过 → 整组跳过，不重复花钱。
 * - 单组 SERP 失败不中断整批：跳过该组并把原因记入返回值 errors。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  DATAFORSEO_LOGIN_SETTING,
  DATAFORSEO_PASSWORD_SETTING,
} from "../traffic/dataforseo.js";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";

export const AD_COUNT_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const SERP_API_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

/** 国家 → DataForSEO location_code。未知国家默认美国。 */
const LOCATION_CODES: Record<string, number> = {
  US: 2840,
  UK: 2826,
  GB: 2826,
  DE: 2276,
  CA: 2124,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  MX: 2484,
  AU: 2036,
};

/** 国家 → 搜索语言（仅非英语国家覆盖，其余 en）。 */
const LANGUAGE_CODES: Record<string, string> = {
  DE: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  NL: "nl",
};

export interface AdCountClassification {
  total: number;
  self: number;
  others: number;
}

/** 品牌名归一化：小写 + 只留字母数字（去空格/符号），用于域名包含判断。 */
function normalizeBrand(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAmazonDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return d === "amazon" || d.startsWith("amazon.") || d.includes(".amazon.");
}

/**
 * 把付费广告按落地页域名分类：域名含品牌名 → 自投；其余（含 amazon.*）→ 他投。
 * 纯函数，无副作用。
 */
export function classifyAds(
  brand: string,
  ads: Array<{ domain?: string }>
): AdCountClassification {
  const needle = normalizeBrand(brand);
  let self = 0;
  let others = 0;
  for (const ad of ads) {
    const domain = (ad.domain ?? "").toLowerCase().trim();
    const host = domain.replace(/^www\./, "");
    if (
      needle &&
      host &&
      !isAmazonDomain(host) &&
      host.replace(/[^a-z0-9]/g, "").includes(needle)
    ) {
      self += 1;
    } else {
      others += 1;
    }
  }
  return { total: ads.length, self, others };
}

export interface BrandAdCountResult {
  groupsQueried: number;
  groupsSkippedCache: number;
  productsUpdated: number;
  errors: Array<{ brand: string; countryCode: string | null; message: string }>;
}

export interface BrandAdCountDeps {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

interface ProductRow {
  id: string;
  brand: string | null;
  countryCode: string | null;
  landingPageType: string | null;
  adCountCheckedAt: Date | null;
}

interface SerpItem {
  type?: unknown;
  domain?: unknown;
  url?: unknown;
}

function itemDomain(item: SerpItem): string {
  if (typeof item.domain === "string" && item.domain.trim())
    return item.domain.trim();
  if (typeof item.url === "string" && item.url.trim()) {
    try {
      return new URL(item.url).hostname;
    } catch {
      return "";
    }
  }
  return "";
}

/** 调一次 DataForSEO SERP，返回付费广告的域名列表。失败抛错（调用方捕获跳组）。 */
async function fetchPaidAdDomains(
  fetchImpl: typeof fetch,
  creds: { login: string; password: string },
  keyword: string,
  countryCode: string | null
): Promise<string[]> {
  const cc = (countryCode ?? "").trim().toUpperCase();
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
    "base64"
  );
  const res = await fetchImpl(SERP_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        keyword,
        location_code: LOCATION_CODES[cc] ?? 2840,
        language_code: LANGUAGE_CODES[cc] ?? "en",
        device: "desktop",
        os: "windows",
        depth: 100,
      },
    ]),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO SERP HTTP ${res.status}`);
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
    throw new Error(
      `DataForSEO 任务异常（status_code=${task?.status_code ?? "?"}${task?.status_message ? `：${task.status_message}` : ""}）`
    );
  }
  const items = task.result?.[0]?.items ?? [];
  return items
    .filter((it) => it?.type === "paid")
    .map((it) => itemDomain(it));
}

/**
 * 批量计算广告投放数量（增量）：按（品牌，国家）分组，每组查一次 SERP，
 * 结果写回组内全部商品。productIds 为空/缺省 → 该 tenant 全部商品（仍受
 * 14 天缓存约束，只查过期/未查的组）。
 */
export async function calcBrandAdCounts(
  prisma: PrismaClient,
  tenantId: string,
  productIds?: string[],
  deps: BrandAdCountDeps = {}
): Promise<BrandAdCountResult> {
  const login = await readEncryptedTrafficSetting(
    prisma,
    DATAFORSEO_LOGIN_SETTING
  );
  const password = await readEncryptedTrafficSetting(
    prisma,
    DATAFORSEO_PASSWORD_SETTING
  );
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured");
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  const rows = (await prisma.networkProduct.findMany({
    where: {
      tenantId,
      ...(productIds && productIds.length > 0
        ? { id: { in: productIds } }
        : {}),
    },
    select: {
      id: true,
      brand: true,
      countryCode: true,
      landingPageType: true,
      adCountCheckedAt: true,
    },
  })) as ProductRow[];

  // 按（品牌小写，国家大写首个）分组；brand 为空的商品跳过。
  const groups = new Map<
    string,
    { brand: string; countryCode: string | null; items: ProductRow[] }
  >();
  for (const r of rows) {
    const brand = (r.brand ?? "").trim();
    if (!brand) continue;
    const country = (r.countryCode ?? "").split(",")[0]?.trim().toUpperCase() || null;
    const key = `${brand.toLowerCase()}|${country ?? ""}`;
    const g = groups.get(key);
    if (g) g.items.push(r);
    else groups.set(key, { brand, countryCode: country, items: [r] });
  }

  const result: BrandAdCountResult = {
    groupsQueried: 0,
    groupsSkippedCache: 0,
    productsUpdated: 0,
    errors: [],
  };
  const now = Date.now();

  for (const g of groups.values()) {
    // 14 天缓存：组内任一商品在缓存期内查过 → 整组跳过。
    const fresh = g.items.some(
      (p) =>
        p.adCountCheckedAt instanceof Date &&
        now - p.adCountCheckedAt.getTime() < AD_COUNT_CACHE_TTL_MS
    );
    if (fresh) {
      result.groupsSkippedCache += 1;
      continue;
    }

    let domains: string[];
    try {
      domains = await fetchPaidAdDomains(
        fetchImpl,
        { login, password },
        g.brand,
        g.countryCode
      );
    } catch (e) {
      result.errors.push({
        brand: g.brand,
        countryCode: g.countryCode,
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    result.groupsQueried += 1;

    // Amazon 落地页分不清自投/他投 → 只记 total。
    const isAmazonGroup = g.items.some(
      (p) =>
        p.landingPageType === "amazon_product" ||
        p.landingPageType === "amazon_storefront"
    );
    const counts = classifyAds(
      g.brand,
      domains.map((domain) => ({ domain }))
    );
    const res = await prisma.networkProduct.updateMany({
      where: { id: { in: g.items.map((p) => p.id) }, tenantId },
      data: {
        adCount: counts.total,
        adCountSelf: isAmazonGroup ? null : counts.self,
        adCountOthers: isAmazonGroup ? null : counts.others,
        adCountCheckedAt: new Date(),
      },
    });
    result.productsUpdated += res.count;
  }

  return result;
}
