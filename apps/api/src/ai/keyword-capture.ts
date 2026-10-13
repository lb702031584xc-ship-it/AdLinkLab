/**
 * 关键词数据抓取解析：把插件抓到的 SEMrush / Google Keyword Planner
 * 页面正文，尽力解析成关键词表的一行（关键词/月搜索量/CPC/竞争度/Planner 出价）。
 *
 * 纯启发式，找不到的字段为 null（前端只填解析到的，用户复核）。
 * 绝不编造：没匹配到就是 null。
 */
export interface ParsedKeywordData {
  keyword: string | null;
  volume: number | null;
  cpc: number | null;
  plannerLow: number | null;
  plannerHigh: number | null;
  competition: "Low" | "Medium" | "High" | null;
}

const EMPTY: ParsedKeywordData = {
  keyword: null,
  volume: null,
  cpc: null,
  plannerLow: null,
  plannerHigh: null,
  competition: null,
};

function parseVolume(raw: string, suffix: string | undefined): number | null {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult =
    suffix?.toUpperCase() === "M"
      ? 1_000_000
      : suffix?.toUpperCase() === "K"
        ? 1_000
        : suffix?.toUpperCase() === "B"
          ? 1_000_000_000
          : 1;
  const v = Math.round(n * mult);
  return v > 0 ? v : null;
}

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 从标题提取关键词：SEMrush 标题形如 "best vpn 2026 - Keyword Overview | SEMrush"。 */
export function extractKeywordFromTitle(title: string | null): string | null {
  if (!title) return null;
  const t = title.trim();
  // 去掉常见的站点后缀
  const cut = t.split(/\s[—–\-|]\s/)[0] ?? t;
  const kw = cut
    .replace(/\s*[-–—|]\s*(Keyword Overview|SEMrush|Google Ads|Keyword Planner).*$/i, "")
    .trim();
  if (!kw || kw.length > 100) return null;
  // 标题本身就是 "Keyword Planner" 之类时放弃
  if (/^(keyword planner|keyword overview|semrush)$/i.test(kw)) return null;
  return kw;
}

export function parseKeywordCapture(
  title: string | null,
  text: string
): ParsedKeywordData {
  const t = ` ${text ?? ""} `;
  const out: ParsedKeywordData = { ...EMPTY };
  out.keyword = extractKeywordFromTitle(title);

  // 月搜索量：Volume 10K / 月搜索量 10000
  let m = t.match(/Volume\s*([\d,.]+)\s*([KMB])?/i);
  if (!m) m = t.match(/月搜索量\D{0,5}([\d,]+)/);
  if (m) out.volume = parseVolume(m[1]!, m[2]);

  // CPC：CPC $1.50
  m = t.match(/CPC\s*(?:USD)?\s*\$?\s*([\d,.]+)/i);
  if (m) out.cpc = parseMoney(m[1]!);

  // 竞争度：Competitive Density 0.82 → 映射；或 Competition: High
  m = t.match(/Competitive\s*Density\s*([\d.]+)/i);
  if (m) {
    const d = Number(m[1]);
    if (Number.isFinite(d)) {
      out.competition = d < 0.34 ? "Low" : d < 0.67 ? "Medium" : "High";
    }
  }
  if (!out.competition) {
    m = t.match(/Competition\D{0,5}(Low|Medium|High)/i);
    if (m) {
      const v = m[1]!.toLowerCase();
      out.competition = v === "low" ? "Low" : v === "medium" ? "Medium" : "High";
    }
  }

  // Planner 出价：Top of page bid (low range) $0.80 / (high range) $2.50
  m = t.match(/top of page bid\s*\(low[^)]*\)\s*\$?\s*([\d,.]+)/i);
  if (m) out.plannerLow = parseMoney(m[1]!);
  m = t.match(/top of page bid\s*\(high[^)]*\)\s*\$?\s*([\d,.]+)/i);
  if (m) out.plannerHigh = parseMoney(m[1]!);

  return out;
}
