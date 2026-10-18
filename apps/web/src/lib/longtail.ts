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
}

export interface LongtailCandidate extends LongtailCandidateInput {}

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
  snapshotRows: Array<{ keyword?: string; volume?: string | number }>;
  serverCandidates: Array<{
    keyword: string;
    volume: number | null;
    source: "autocomplete" | "dataforseo";
  }>;
  planKeywords: string[];
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
    });
  }
  for (const c of opts.serverCandidates) {
    const keyword = (c.keyword ?? "").trim();
    if (!keyword) continue;
    all.push({ keyword, volume: c.volume, source: c.source });
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
    const prevHasVol = prev.volume != null;
    const curHasVol = c.volume != null;
    if (!prevHasVol && curHasVol) byKey.set(key, { ...c });
    else if (
      prevHasVol === curHasVol &&
      SOURCE_PRIORITY[c.source] < SOURCE_PRIORITY[prev.source]
    )
      byKey.set(key, { ...c });
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.volume != null && b.volume != null) {
      if (b.volume !== a.volume) return b.volume - a.volume;
    } else if (a.volume != null) return -1;
    else if (b.volume != null) return 1;
    return a.keyword.localeCompare(b.keyword);
  });
}
