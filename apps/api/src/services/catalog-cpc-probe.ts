/**
 * 绫荤洰 CPC 鎺㈤拡锛?026-10-30锛夈€? *
 * 鍏ㄧ珯浣撴鍗″湪銆屾病鏈夌被鐩?CPC銆嶁€斺€斿巻鍙叉姇鏀炬牱鏈负绌猴紝鍩虹嚎閫€鍒?assumed 0锛? * 浜庢槸浠讳綍浣ｉ噾閮?鑳借鐩?0"锛屽叏閮ㄥ垽鍙姇銆? *
 * 杩欓噷鐢?DataForSEO 鐨勬壒閲?Keyword Overview 琛ヤ笂鍩虹嚎锛? *   鍙栦剑閲戦檷搴忓墠 N 涓晢鍝?鈫?浠庢爣棰樻彁鍙栨牳蹇冭瘝 鈫?涓€娆℃壒閲忔煡 CPC
 *   鈫?鎸夌被鐩彇涓綅鏁?鈫?浣滀负璇ョ被鐩殑 CPC 鍩虹嚎
 *
 * 鍙煡涓€娆℃壒閲忔帴鍙ｏ紙50 涓瘝 鈮?1 娆¤皟鐢級锛屾垚鏈害 $0.001銆? */
import { inferCategory } from "./catalog-audit.js";
import type { CpcSample } from "./cpc-baseline.js";

/** 鎻愯瘝鏃惰璺宠繃鐨勪慨楗般€?*/
const SKIP = new Set([
  "new", "latest", "updated", "the", "a", "an", "and", "or", "for", "with",
  "of", "in", "on", "by", "to", "from", "set", "pack",
]);

/** 閬囧埌鍝佺被璇嶅氨鎴柇锛氬瀷鍙峰悕閫氬父鍒版涓烘銆?*/
const STOP = new Set([
  "robot", "vacuum", "vacuums", "mop", "mopping", "cleaner", "machine",
  "heater", "sealer", "station", "kitchen", "appliance", "cleaners",
  "washer", "dryer", "purifier", "humidifier", "pool", "poolsauger",
  "poolroboter", "camera", "speaker", "charger", "desk", "cabinet",
]);

/**
 * 浠庡晢鍝佹爣棰樻彁鍙栦竴涓彲鏌ョ殑鏍稿績璇嶃€? * 渚嬶細roborock 2026 New Qrevo Edge 3 Pro Robot Vacuum and Mop, 36000 Pa
 *     鈫?roborock qrevo edge 3 pro
 */
export function extractProbeKeyword(name: string): string | null {
  const raw = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const core: string[] = [];
  for (const t of raw) {
    if (/^\d{4}$/.test(t)) continue; // 骞翠唤
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
}

export interface ProbeResult {
  /** 鍙洿鎺ュ杺缁?auditCatalog 鐨勬牱鏈€?*/
  samples: CpcSample[];
  /** 绫荤洰 鈫?鍙備笌璁＄畻鐨勫叧閿瘝鏁般€?*/
  perCategory: Record<string, number>;
  /** 鏌ヤ簡浣嗘病杩斿洖 CPC 鐨勮瘝鏁帮紙鐢ㄤ簬鍛婅瘔鐢ㄦ埛鏁版嵁缂哄彛锛夈€?*/
  misses: number;
}


/**
 * 鎸夌被鐩帰娴?CPC銆? *
 * @param topPerCategory 姣忎釜绫荤洰鏈€澶氭煡鍑犱釜鍟嗗搧锛堟帶鍒舵垚鏈紝榛樿 6锛? * @param fetchCpc       鎵归噺鏌ヨ瘝鍣細涓€娆′紶鍏ュ涓叧閿瘝锛岃繑鍥?璇嶁啋CPC锛堢編鍏冿級
 */
export async function probeCategoryCpc(
  products: ProbeInput[],
  fetchCpc: (keywords: string[]) => Promise<Map<string, number>>,
  opts: { topPerCategory?: number } = {}
): Promise<ProbeResult> {
  const topN = Math.max(1, opts.topPerCategory ?? 6);

  // 绫荤洰 鈫?璇ョ被鍒笅浣ｉ噾鏈€楂樼殑鍑犱釜鍟嗗搧
  const byCat = new Map<string, ProbeInput[]>();
  for (const p of products) {
    if (p.payoutUsd == null || p.payoutUsd <= 0) continue;
    const cat = inferCategory(p.name);
    const arr = byCat.get(cat) ?? [];
    arr.push(p);
    byCat.set(cat, arr);
  }

  const keywordToCat = new Map<string, string>();
  for (const [cat, items] of byCat) {
    items.sort((a, b) => (b.payoutUsd ?? 0) - (a.payoutUsd ?? 0));
    for (const it of items.slice(0, topN)) {
      const kw = extractProbeKeyword(it.name);
      if (!kw) continue;
      // 鍚屼竴涓瘝鍙綊灞炵涓€涓被鐩紝閬垮厤閲嶅璁¤垂
      if (!keywordToCat.has(kw)) keywordToCat.set(kw, cat);
    }
  }

  const keywords = [...keywordToCat.keys()];
  if (keywords.length === 0) {
    return { samples: [], perCategory: {}, misses: 0 };
  }

  const cpcByKeyword = await fetchCpc(keywords);

  const cpcByCat = new Map<string, number[]>();
  let misses = 0;
  for (const [kw, cat] of keywordToCat) {
    const cpc = cpcByKeyword.get(kw);
    if (cpc == null || !Number.isFinite(cpc) || cpc <= 0) {
      misses += 1;
      continue;
    }
    const arr = cpcByCat.get(cat) ?? [];
    arr.push(cpc);
    cpcByCat.set(cat, arr);
  }

  // 每个关键词一条样本，而不是每个类目一条中位数。
  // resolveCpcBaseline 要求同类目 ≥3 条样本才认「精确基线」；
  // 若每类只给一条，样本数永远不够，基线会退回 assumed 0。
  const samples: CpcSample[] = [];
  const perCategory: Record<string, number> = {};
  for (const [cat, values] of cpcByCat) {
    for (const v of values) {
      samples.push({
        category: cat,
        cpcUsd: Math.round(v * 10000) / 10000,
        clicks: 1,
      });
    }
    perCategory[cat] = values.length;
  }

  return { samples, perCategory, misses };
}
