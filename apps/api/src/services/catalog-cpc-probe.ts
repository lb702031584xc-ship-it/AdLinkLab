/**
 * 类目 CPC 探针（2026-10-30）。
 *
 * 全站体检卡在「没有类目 CPC」——历史投放样本为空，基线退到 assumed 0，
 * 于是任何佣金都能覆盖 0，全部判可投。
 *
 * 这里用 DataForSEO 的批量 Keyword Overview 补上基线。
 *
 * 关键教训：**要查的是品类词，不是型号词。**
 * 型号全称（beatbot aquasense 2）月搜接近 0，Keyword Overview 不会给 CPC；
 * 实测 48 个型号词只命中 4 个。而「pool cleaner」「robot vacuum」这类品类词
 * 有稳定的 CPC 数据，而且正好回答「这个类目打一次点击要多少钱」。
 */
import { inferCategory } from "./catalog-audit.js";
import type { CpcSample } from "./cpc-baseline.js";

/**
 * 商品标题 → 品类查询词。
 * 顺序即优先级（先匹配更具体的）。
 */
const PHRASE_RULES: Array<[RegExp, string]> = [
  [/robot ?vacuum|saugroboter|aspirapolvere|robot aspirador|robot aspirateur|trockensauger/i, "robot vacuum"],
  [/mop|wet ?dry vacuum|nass ?trocken/i, "robot mop"],
  [/pool ?(cleaner|robot|sauger|roboter|reiniger)|poolsauger|poolroboter/i, "pool cleaner"],
  [/mini ?split|air conditioner|portable ac|klimaanlage|climatiseur/i, "portable air conditioner"],
  [/vacuum sealer|chamber ?sealer|vakuumierer/i, "vacuum sealer"],
  [/leaf ?blower|laubbläser/i, "leaf blower"],
  [/dehumidifier|luftentfeuchter/i, "dehumidifier"],
  [/humidifier|luftbefeuchter/i, "humidifier"],
  [/air ?purifier|luftreiniger/i, "air purifier"],
  [/gps ?tracker|gps ?traqueur/i, "gps tracker"],
  [/power ?station|solar ?generator/i, "portable power station"],
  [/espresso machine|kaffeemaschine/i, "espresso machine"],
  [/standing desk|schreibtisch|schreibtische/i, "standing desk"],
  [/tv ?(cabinet|stand|mount)/i, "tv stand"],
  [/dash ?cam|dashcam/i, "dash cam"],
  [/voice recorder|diktiergerät/i, "voice recorder"],
  [/luggage|suitcase|koffer/i, "luggage set"],
  [/dog clipper|pet clipper|cortacésped|pelar caballos|tierhaarschneider/i, "dog clippers"],
  [/litter box|arenero|katzenklo/i, "cat litter box"],
  [/electric grill|hot dog roller/i, "electric grill"],
  [/slant|seasoning|salt set/i, "seasoning gift set"],
  [/humidor|cigar/i, "cigar humidor"],
  [/3d printer/i, "3d printer"],
];

/** 兜底时用来找品类词的表。 */
const STOP = new Set([
  "robot", "vacuum", "vacuums", "mop", "mopping", "cleaner", "machine",
  "heater", "sealer", "station", "kitchen", "appliance", "cleaners",
  "washer", "dryer", "purifier", "humidifier", "pool", "poolsauger",
  "poolroboter", "camera", "speaker", "charger", "desk", "cabinet",
  "luggage", "printer", "tracker", "grill", "flosser",
]);

/**
 * 从商品标题提取一个「品类查询词」（不是型号词）。
 * 例：roborock 2026 New Qrevo Edge 3 Pro Robot Vacuum and Mop
 *     → robot vacuum
 */
export function extractProbeKeyword(name: string): string | null {
  const n = name ?? "";
  for (const [re, phrase] of PHRASE_RULES) {
    if (re.test(n)) return phrase;
  }
  // 兜底：品牌 + 第一个品类词
  const tokens = n
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const idx = tokens.findIndex((t) => STOP.has(t));
  if (idx > 0) return tokens[0] + " " + tokens[idx];
  if (idx === 0) return tokens[0];
  return null;
}

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

export interface ProbeInput {
  productId: string;
  name: string;
  payoutUsd: number | null;
  priceUsd: number | null;
  countryCode?: string | null;
}

export interface ProbeResult {
  /** 每个命中词一条样本，直接喂给 auditCatalog。 */
  samples: CpcSample[];
  /** 类目 → 命中 CPC 的词数。 */
  perCategory: Record<string, number>;
  /** 查了但没返回 CPC 的词数。 */
  misses: number;
  /** 实际发起的国家批次数量（= API 调用次数）。 */
  countries: number;
  /** 实际查询的品类词（去重后），用于诊断。 */
  queried: string[];
}

export type FetchCpc = (
  keywords: string[],
  locale: { locationCode: number; languageCode: string }
) => Promise<Map<string, number>>;

/**
 * 按「国家 + 类目」探测品类 CPC。
 *
 * @param topPerCategory 每个类目最多取几个商品（只为去重，默认 12）
 * @param fetchCpc       批量查词器：传入词表与国家 locale，返回 词→CPC(美元)
 */
export async function probeCategoryCpc(
  products: ProbeInput[],
  fetchCpc: FetchCpc,
  opts: { topPerCategory?: number } = {}
): Promise<ProbeResult> {
  const topN = Math.max(1, opts.topPerCategory ?? 12);

  const byCat = new Map<string, ProbeInput[]>();
  for (const p of products) {
    if (p.payoutUsd == null || p.payoutUsd <= 0) continue;
    const cat = inferCategory(p.name);
    const arr = byCat.get(cat) ?? [];
    arr.push(p);
    byCat.set(cat, arr);
  }

  // 国家 → (品类词 → 类目)。品类词高度重复，去重后每国只需查十来个词。
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
  const queried: string[] = [];
  let misses = 0;
  let countries = 0;

  for (const [country, keywordToCat] of byCountry) {
    const keywords = [...keywordToCat.keys()];
    if (keywords.length === 0) continue;
    queried.push(...keywords);

    let cpcByKeyword: Map<string, number>;
    try {
      cpcByKeyword = await fetchCpc(keywords, localeForCountry(country));
      countries += 1;
    } catch {
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

  return { samples, perCategory, misses, countries, queried };
}
