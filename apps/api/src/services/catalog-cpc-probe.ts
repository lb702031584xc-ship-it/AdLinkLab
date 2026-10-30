/**
 * 类目 CPC 探针（2026-10-30）。
 *
 * 全站体检卡在「没有类目 CPC」——历史投放样本为空，基线退到 assumed 0，
 * 于是任何佣金都能覆盖 0，全部判可投。
 *
 * 这里用 DataForSEO 的批量 Keyword Overview 补上基线：
 *   佣金降序取每类前 N 个 → 从标题提核心词 → 按商品所在国家分组查 CPC
 *   → 每个关键词一条样本 → 由 resolveCpcBaseline 自己加权取中位数
 *
 * 为什么按国家分组：欧洲商品的型号词在美国库里查不到。只用 2840(US)
 * 查 beatbot aquasense 会大面积 miss，样本凑不够，基线又退回 global。
 */
import { inferCategory } from "./catalog-audit.js";
import type { CpcSample } from "./cpc-baseline.js";

/** 提词时要跳过的纯修饰词（pro / max / plus 是型号词，不能删）。 */
const SKIP = new Set([
  "new", "latest", "updated", "the", "a", "an", "and", "or", "for", "with",
  "of", "in", "on", "by", "to", "from", "set", "pack",
]);

/** 遇到品类词就截断：型号名通常到此为止。 */
const STOP = new Set([
  "robot", "vacuum", "vacuums", "mop", "mopping", "cleaner", "machine",
  "heater", "sealer", "station", "kitchen", "appliance", "cleaners",
  "washer", "dryer", "purifier", "humidifier", "pool", "poolsauger",
  "poolroboter", "camera", "speaker", "charger", "desk", "cabinet",
]);

/**
 * 国家 → DataForSEO 的 location_code 与语言。
 * 未收录的国家退回美国 + 英语。
 */
export const COUNTRY_LOCALE: Record<
  string,
  { locationCode: number; languageCode: string }
> = {
  US: { locationCode: 2840, languageCode: "en" },
  CA: { locationCode: 2124, languageCode: "en" },
  UK: { locationCode: 2826, languageCode: "en" },
  GB: { locationCode: 2826, languageCode: "en" },
  AU: { locationCode: 2036, languageCode: "en" },
  DE: { locationCode: 2276, languageCode: "de" },
  FR: { locationCode: 2250, languageCode: "fr" },
  IT: { locationCode: 2380, languageCode: "it" },
  ES: { locationCode: 2724, languageCode: "es" },
  NL: { locationCode: 2528, languageCode: "nl" },
  BE: { locationCode: 2056, languageCode: "nl" },
  SE: { locationCode: 2752, languageCode: "sv" },
  PL: { locationCode: 2616, languageCode: "pl" },
};

export function localeForCountry(
  country: string | null | undefined
): { locationCode: number; languageCode: string } {
  const key = (country ?? "US").toUpperCase();
  return COUNTRY_LOCALE[key] ?? COUNTRY_LOCALE.US;
}

/**
 * 从商品标题提取一个可查的核心词。
 * 例：roborock 2026 New Qrevo Edge 3 Pro Robot Vacuum and Mop, 36000 Pa
 *     → roborock qrevo edge 3 pro
 */
export function extractProbeKeyword(name: string): string | null {
  const raw = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const core: string[] = [];
  for (const t of raw) {
    if (/^\d{4}$/.test(t)) continue; // 年份
    if (SKIP.has(t)) continue;
    if (STOP.has(t)) break;
    core.push(t);
    if (core.length >= 6) break;
  }
  if (core.length < 2) return null;
  return core.join(" ");
}

export interface ProbeInput {
  productId: string;
  name: string;
  payoutUsd: number | null;
  priceUsd: number | null;
  countryCode?: string | null;
}

export interface ProbeResult {
  /** 每个关键词一条样本，直接喂给 auditCatalog。 */
  samples: CpcSample[];
  /** 类目 → 命中 CPC 的关键词数。 */
  perCategory: Record<string, number>;
  /** 查了但没返回 CPC 的词数。 */
  misses: number;
  /** 实际发起的国家批次数量（= API 调用次数）。 */
  countries: number;
}

export type FetchCpc = (
  keywords: string[],
  locale: { locationCode: number; languageCode: string }
) => Promise<Map<string, number>>;

/**
 * 按「国家 + 类目」探测 CPC。
 *
 * @param topPerCategory 每个类目最多查几个商品（默认 12：给足样本余量）
 * @param fetchCpc       批量查词器：传入词表与国家 locale，返回 词→CPC(美元)
 */
export async function probeCategoryCpc(
  products: ProbeInput[],
  fetchCpc: FetchCpc,
  opts: { topPerCategory?: number } = {}
): Promise<ProbeResult> {
  const topN = Math.max(1, opts.topPerCategory ?? 12);

  // 类目 → 该类别下佣金最高的几个商品
  const byCat = new Map<string, ProbeInput[]>();
  for (const p of products) {
    if (p.payoutUsd == null || p.payoutUsd <= 0) continue;
    const cat = inferCategory(p.name);
    const arr = byCat.get(cat) ?? [];
    arr.push(p);
    byCat.set(cat, arr);
  }

  // 国家 → 该批要查的词（词 → 类目）
  const byCountry = new Map<string, Map<string, string>>();
  for (const [cat, items] of byCat) {
    items.sort((a, b) => (b.payoutUsd ?? 0) - (a.payoutUsd ?? 0));
    for (const it of items.slice(0, topN)) {
      const kw = extractProbeKeyword(it.name);
      if (!kw) continue;
      const country = (it.countryCode ?? "US").toUpperCase();
      const bucket = byCountry.get(country) ?? new Map<string, string>();
      if (!bucket.has(kw)) bucket.set(kw, cat);
      byCountry.set(country, bucket);
    }
  }

  const samples: CpcSample[] = [];
  const perCategory: Record<string, number> = {};
  let misses = 0;
  let countries = 0;

  for (const [country, keywordToCat] of byCountry) {
    const keywords = [...keywordToCat.keys()];
    if (keywords.length === 0) continue;

    let cpcByKeyword: Map<string, number>;
    try {
      cpcByKeyword = await fetchCpc(keywords, localeForCountry(country));
      countries += 1;
    } catch {
      // 某个国家失败不影响其它国家
      misses += keywords.length;
      continue;
    }

    for (const [kw, cat] of keywordToCat) {
      const cpc = cpcByKeyword.get(kw);
      if (cpc == null || !Number.isFinite(cpc) || cpc <= 0) {
        misses += 1;
        continue;
      }
      samples.push({
        category: cat,
        cpcUsd: Math.round(cpc * 10000) / 10000,
        clicks: 1,
      });
      perCategory[cat] = (perCategory[cat] ?? 0) + 1;
    }
  }

  return { samples, perCategory, misses, countries };
}
