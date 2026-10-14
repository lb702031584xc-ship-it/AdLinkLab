/**
 * 关键词数据抓取解析：把插件抓到的 SEMrush / Google Keyword Planner
 * 页面正文解析成关键词表。
 *
 * 两层：
 * 1. 单词概览（标题词 + 页面级 Volume/CPC/Planner 出价）——旧行为；
 * 2. 关键词表格（SEMrush「关键词变化」/ Keyword Magic / Planner 列表）——
 *    多行：关键词 / 搜索量 / KD 或 CPC / 竞争度。
 *
 * 纯启发式，找不到的字段为 null（前端只填解析到的，用户复核）。
 * 绝不编造：没匹配到就是 null。
 */
export interface ParsedKeywordRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  /** SEMrush KD 原值（0-100）。 */
  kd: number | null;
  competition: "Low" | "Medium" | "High" | null;
}

export interface ParsedKeywordData {
  keyword: string | null;
  volume: number | null;
  cpc: number | null;
  plannerLow: number | null;
  plannerHigh: number | null;
  competition: "Low" | "Medium" | "High" | null;
  /** 解析到的表格行（为空时前端回落到上面 6 个单值字段）。 */
  rows: ParsedKeywordRow[];
}

const EMPTY: ParsedKeywordData = {
  keyword: null,
  volume: null,
  cpc: null,
  plannerLow: null,
  plannerHigh: null,
  competition: null,
  rows: [],
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

const HEADER_WORDS = /关键词|keyword|搜索量|volume|竞争度|competition|意图|intent|\bkd\b|cpc|结果|results|serp/i;

function looksLikeKeyword(v: string): boolean {
  const t = v.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (!/[a-zA-Z\u4e00-\u9fa5]/.test(t)) return false;
  if (/^https?:\/\//i.test(t) || /@/.test(t)) return false;
  if (HEADER_WORDS.test(t)) return false;
  if (/^[\d.,\s%$]+$/.test(t)) return false;
  if (t.split(/\s+/).length > 10) return false;
  return true;
}

/** 搜索量 token：14.8K / 5,400；裸数字 <100 很可能是 KD 不是搜索量。 */
function parseVolumeToken(tok: string): number | null {
  const m = tok.trim().match(/^([\d,.]+)\s*([KMB])?$/i);
  if (!m) return null;
  if (!m[2] && Number(m[1]!.replace(/,/g, "")) < 100) return null;
  return parseVolume(m[1]!, m[2]);
}

/** KD token：49 / 49%。 */
function parseKdToken(tok: string): number | null {
  const m = tok.trim().match(/^(\d{1,3})\s*%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** SEMrush KD 分段 → 竞争度（Easy 0-29 / Medium 30-69 / Hard 70+）。 */
function kdToCompetition(kd: number): "Low" | "Medium" | "High" {
  return kd < 30 ? "Low" : kd < 70 ? "Medium" : "High";
}

function parseCompetitionToken(tok: string): "Low" | "Medium" | "High" | null {
  const m = tok.trim().match(/^(Low|Medium|High)$/i);
  if (!m) return null;
  const v = m[1]!.toLowerCase();
  return v === "low" ? "Low" : v === "medium" ? "Medium" : "High";
}

/** 从一行的剩余 token 里认 volume / CPC / KD / 竞争度。 */
function parseRowTokens(
  tokens: string[]
): Omit<ParsedKeywordRow, "keyword"> | null {
  let volume: number | null = null;
  let cpc: number | null = null;
  let kd: number | null = null;
  let competition: "Low" | "Medium" | "High" | null = null;
  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;
    if (volume == null) {
      const v = parseVolumeToken(t);
      if (v != null) {
        volume = v;
        continue;
      }
    }
    if (cpc == null && t.startsWith("$")) {
      const v = parseMoney(t.slice(1));
      if (v != null) {
        cpc = v;
        continue;
      }
    }
    if (kd == null) {
      const v = parseKdToken(t);
      if (v != null) {
        kd = v;
        competition = kdToCompetition(v);
        continue;
      }
    }
    if (competition == null) {
      const v = parseCompetitionToken(t);
      if (v) {
        competition = v;
        continue;
      }
    }
  }
  // 至少要有搜索量，否则这行不算关键词数据行
  if (volume == null) return null;
  return { volume, cpc, kd, competition };
}

/**
 * 解析关键词表格。innerText 里表格有两种排版：
 * A. 制表符分隔：`max and lily\t14.8K\t49`（SEMrush 表格的常见形态）；
 * B. 逐行排列：关键词行 / 搜索量行 / KD 行（要求连续 ≥2 组或有表头才采信，防误认）。
 */
export function parseKeywordTable(text: string): ParsedKeywordRow[] {
  const lines = (text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedKeywordRow[] = [];
  const seen = new Set<string>();
  const push = (row: ParsedKeywordRow) => {
    const key = row.keyword.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  // A. 制表符 / 竖线 / 多空格分隔的行
  for (const line of lines) {
    if (!/[\t|]/.test(line) && !/\s{2,}/.test(line)) continue;
    const tokens = line.split(/[\t|]|\s{2,}/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length < 2) continue;
    const kw = tokens[0]!;
    if (!looksLikeKeyword(kw)) continue;
    const rest = parseRowTokens(tokens.slice(1));
    if (rest) push({ keyword: kw, ...rest });
  }
  if (out.length > 0) return out.slice(0, 50);

  // B. 逐行排列的三元组
  const hasHeader = lines.some(
    (l) => /关键词|keyword/i.test(l) && /搜索量|volume|\bkd\b/i.test(l)
  );
  const seq: ParsedKeywordRow[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const kw = lines[i]!;
    const vol = parseVolumeToken(lines[i + 1]!);
    if (!looksLikeKeyword(kw) || vol == null) continue;
    const third = lines[i + 2]!;
    const kd = parseKdToken(third);
    const cpc = third.startsWith("$") ? parseMoney(third.slice(1)) : null;
    const comp = parseCompetitionToken(third);
    if (kd == null && cpc == null && comp == null) continue;
    seq.push({
      keyword: kw,
      volume: vol,
      cpc,
      kd,
      competition: kd != null ? kdToCompetition(kd) : comp,
    });
  }
  if (seq.length >= 2 || (hasHeader && seq.length >= 1)) {
    for (const r of seq) push(r);
  }
  return out.slice(0, 50);
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

  // 表格行：SEMrush 关键词变化表等
  out.rows = parseKeywordTable(text);
  // 页面级 CPC 补给首行（仅当首行就是标题词，即概览主词）
  if (
    out.rows.length > 0 &&
    out.keyword &&
    out.rows[0]!.keyword.toLowerCase() === out.keyword.toLowerCase() &&
    out.rows[0]!.cpc == null &&
    out.cpc != null
  ) {
    out.rows[0]!.cpc = out.cpc;
  }

  return out;
}
