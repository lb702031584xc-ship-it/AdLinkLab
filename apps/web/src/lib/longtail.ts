/**
 * 长尾词候选合并 / 过滤（纯函数）。
 *
 * 来源（全部真实数据，不 AI 现编）：
 * - snapshot：需求验证快照（SEMrush 数据，带搜索量）；
 * - dataforseo：DataForSEO 关键词建议（付费，带搜索量）；
 * - autocomplete：Google 联想（免费，用户真实搜过的查询，无搜索量数字）。
 *
 * 过滤规则：
 * - 候选包含种子词全部单词（单单词种子 = 包含该词）；
 * - 候选词数 > 种子词词数（更长 = 更具体）；
 * - 去重：同词保留带搜索量的，来源优先 snapshot > dataforseo > autocomplete；
 * - 排除已在投放计划里的词和种子词本身。
 * 排序：搜索量降序（无搜索量排最后），同量按词排序。
 */
export interface LongtailCandidateInput {
  keyword: string;
  volume: number | null;
  source: "snapshot" | "autocomplete" | "dataforseo";
  /** 候选 CPC（可选，现有数据源不提供时缺省；缺失不参与 CPC 过滤） */
  cpc?: number | null;
  /** 竞争度（可选，如 "Low" / "Medium" / "High"；缺失不参与竞争度过滤） */
  competition?: string | null;
}

export interface LongtailCandidate extends LongtailCandidateInput {}

/**
 * 长尾过滤参数（#17，全部可选，保持旧调用兼容）：
 * - minVolume：默认 10。搜索量低于此值的候选被过滤；volume 为 null（无数据）
 *   的候选不因该条被杀，按原排序保留——无数据不编造、不过滤。
 * - maxCpcRatioToBrand：默认 0.6。候选 CPC ≤ 品牌精确词 CPC × 该比例才保留；
 *   需要候选 cpc 与 brandCpc 都有真实数据，缺任一跳过该过滤。
 * - brandCpc：品牌精确词 CPC（入参，通常由 UI 手填或品牌词行数据带入）。
 * - competitionFilter：默认 false（开关）。开启时仅保留 Low/Medium 竞争度；
 *   候选无竞争度数据时保留。
 */
export interface LongtailFilters {
  minVolume?: number;
  maxCpcRatioToBrand?: number;
  brandCpc?: number | null;
  competitionFilter?: boolean;
}

export const LONGTAIL_DEFAULT_MIN_VOLUME = 10;
export const LONGTAIL_DEFAULT_MAX_CPC_RATIO = 0.6;

const KEEP_COMPETITION = new Set(["low", "medium", "低", "中", "低竞争", "中竞争"]);

function passesFilters(c: LongtailCandidate, f: LongtailFilters): boolean {
  const minVolume = f.minVolume ?? LONGTAIL_DEFAULT_MIN_VOLUME;
  if (c.volume != null && c.volume < minVolume) return false;
  const ratio = f.maxCpcRatioToBrand ?? LONGTAIL_DEFAULT_MAX_CPC_RATIO;
  const brandCpc = f.brandCpc ?? null;
  if (c.cpc != null && brandCpc != null && brandCpc > 0) {
    if (c.cpc > brandCpc * ratio) return false;
  }
  if (f.competitionFilter) {
    const comp = (c.competition ?? "").trim().toLowerCase();
    if (comp && !KEEP_COMPETITION.has(comp)) return false;
  }
  return true;
}

const SOURCE_PRIORITY: Record<LongtailCandidateInput["source"], number> = {
  snapshot: 0,
  dataforseo: 1,
  autocomplete: 2,
};

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function mergeLongtailCandidates(opts: {
  seed: string;
  snapshotRows: Array<{
    keyword?: string;
    volume?: string | number;
    cpc?: number | null;
    competition?: string | null;
  }>;
  serverCandidates: Array<{
    keyword: string;
    volume: number | null;
    source: "autocomplete" | "dataforseo";
    cpc?: number | null;
    competition?: string | null;
  }>;
  planKeywords: string[];
  filters?: LongtailFilters;
}): LongtailCandidate[] {
  const seed = opts.seed.trim();
  const seedLower = seed.toLowerCase();
  const seedWords = seedLower.split(/\s+/).filter(Boolean);
  const seedLen = wordCount(seed);
  if (!seed || seedWords.length === 0) return [];
  const excluded = new Set(
    opts.planKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
  );

  const all: LongtailCandidateInput[] = [];
  for (const row of opts.snapshotRows) {
    const keyword = (row.keyword ?? "").trim();
    if (!keyword) continue;
    const raw = row.volume;
    const volume =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? Number(raw)
          : null;
    all.push({
      keyword,
      volume: typeof volume === "number" && Number.isFinite(volume) ? volume : null,
      source: "snapshot",
      cpc: typeof row.cpc === "number" && Number.isFinite(row.cpc) ? row.cpc : null,
      competition: typeof row.competition === "string" ? row.competition : null,
    });
  }
  for (const c of opts.serverCandidates) {
    const keyword = (c.keyword ?? "").trim();
    if (!keyword) continue;
    all.push({
      keyword,
      volume: c.volume,
      source: c.source,
      cpc: typeof c.cpc === "number" && Number.isFinite(c.cpc) ? c.cpc : null,
      competition: typeof c.competition === "string" ? c.competition : null,
    });
  }

  const byKey = new Map<string, LongtailCandidate>();
  for (const c of all) {
    const key = c.keyword.toLowerCase();
    if (key === seedLower) continue;
    if (excluded.has(key)) continue;
    if (!seedWords.every((w) => key.includes(w))) continue;
    if (wordCount(c.keyword) <= seedLen) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...c });
      continue;
    }
    // 去重：优先带搜索量的；都有搜索量时来源优先 snapshot > dataforseo > autocomplete。
    // cpc / competition 是可选附带数据：胜出记录缺失时从被替换记录补齐，不丢真实数据。
    const withExtras = (win: LongtailCandidate, lose: LongtailCandidate): LongtailCandidate => ({
      ...win,
      cpc: win.cpc ?? lose.cpc ?? null,
      competition: win.competition ?? lose.competition ?? null,
    });
    const prevHasVol = prev.volume != null;
    const curHasVol = c.volume != null;
    if (!prevHasVol && curHasVol) byKey.set(key, withExtras({ ...c }, prev));
    else if (
      prevHasVol === curHasVol &&
      SOURCE_PRIORITY[c.source] < SOURCE_PRIORITY[prev.source]
    )
      byKey.set(key, withExtras({ ...c }, prev));
  }

  const filters = opts.filters ?? {};
  return [...byKey.values()]
    .filter((c) => passesFilters(c, filters))
    .sort((a, b) => {
    if (a.volume != null && b.volume != null) {
      if (b.volume !== a.volume) return b.volume - a.volume;
    } else if (a.volume != null) return -1;
    else if (b.volume != null) return 1;
    return a.keyword.localeCompare(b.keyword);
  });
}
