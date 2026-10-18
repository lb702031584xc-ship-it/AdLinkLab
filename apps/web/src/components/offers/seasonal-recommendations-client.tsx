"use client";

/**
 * 季节推荐（Offer 列表 → 季节推荐页签）。
 *
 * 按国家查季节信号：Trends 时间线（相对热度，绝不是销量）+ DataForSEO 绝对搜索量（付费）+ 节日窗口。
 * 国家/提前量变化时只刷节日窗口（不调外部接口，不花钱）；点“查询/批量查”才调 Trends/DataForSEO。
 * 不做“冲高评分”：信号并排展示，由用户判断；去年模式仅供参考。
 */
import { useEffect, useMemo, useState } from "react";
import {
  checkSeasonalityAction,
  checkSeasonalityAiAction,
  type SeasonalKeywordResult,
  type SeasonalWindow,
  type SeasonalityJudgment,
} from "@/lib/api/traffic-actions";
import { CapturePicker } from "@/components/ai/capture-picker";

export interface SeasonalDict {
  title: string;
  hint: string;
  country: string;
  countries: Record<string, string>;
  habitsTitle: string;
  habitsTraits: string;
  habitsFit: string;
  habits: Record<string, { traits: string[]; fit: string[] }>;
  leadDays: string;
  leadDaysHint: string;
  keyword: string;
  keywordPlaceholder: string;
  check: string;
  checkBatch: string;
  checkOffer: string;
  checking: string;
  windowsTitle: string;
  windowsEmpty: string;
  withinLead: string;
  resultsTitle: string;
  resultsEmpty: string;
  verdict: Record<string, string>;
  current: string;
  yoy: string;
  daysToPeak: string;
  days: string;
  volume: string;
  volumeYoy: string;
  noData: string;
  rateLimited: string;
  offerColumn: string;
  network: string;
  sparkline: string;
  dataNote: string;
  score: string;
  scoreItems: Record<string, string>;
  scoreNote: string;
  aiJudge: string;
  aiJudging: string;
  aiSuggestion: Record<string, string>;
  aiConfidence: string;
  sourcesTrends: string;
  sourcesDataforseo: string;
  captureKeyword: string;
  trendsLinkHint: string;
  dataforseoLinkHint: string;
}

const COUNTRIES = [
  "US",
  "GB",
  "DE",
  "CA",
  "AU",
  "FR",
  "SG",
  "MY",
  "TH",
  "ID",
  "VN",
  "PH",
] as const;

function verdictRank(v: string): number {
  switch (v) {
    case "approaching":
      return 0;
    case "upcoming":
      return 1;
    case "rising":
      return 2;
    case "justPassed":
      return 3;
    case "flat":
      return 4;
    case "past":
      return 5;
    default:
      return 6;
  }
}

function verdictBadgeClass(v: string): string {
  switch (v) {
    case "approaching":
      return "bg-emerald-100 text-emerald-800";
    case "upcoming":
    case "rising":
      return "bg-sky-100 text-sky-800";
    case "justPassed":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-ink/10 text-ink/70";
  }
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}%`;
}

function fmtNum(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

/** 近 12 个月热度迷你折线（SVG，值 0-100 → 高 40）。 */
function Sparkline({ points }: { points: Array<{ time: number; value: number }> }) {
  if (points.length < 2) return <span className="text-xs text-ink/50">—</span>;
  const w = 120;
  const h = 40;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - 2 - (Math.max(0, Math.min(100, p.value)) / 100) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-signal"
      />
    </svg>
  );
}

export function SeasonalRecommendationsClient({
  offers,
  dict: d,
  lang,
}: {
  offers: Array<{ id: string; name: string; network: string }>;
  dict: SeasonalDict;
  lang: "zh" | "en";
}) {
  const [country, setCountry] = useState<string>("US");
  const [leadDays, setLeadDays] = useState<number>(14);
  const [keyword, setKeyword] = useState("");
  const [windows, setWindows] = useState<SeasonalWindow[]>([]);
  const [results, setResults] = useState<SeasonalKeywordResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [judgments, setJudgments] = useState<Record<string, SeasonalityJudgment>>({});
  const [judging, setJudging] = useState<Set<string>>(new Set());
  const [judgeErrors, setJudgeErrors] = useState<Record<string, string>>({});

  /* 国家/提前量变化时只刷节日窗口（空关键词 = 不调外部接口，不花钱）。 */
  useEffect(() => {
    let cancelled = false;
    checkSeasonalityAction([], country, leadDays).then((res) => {
      if (!cancelled && res.ok) setWindows(res.data.windows);
    });
    return () => {
      cancelled = true;
    };
  }, [country, leadDays]);

  const checked = useMemo(
    () => new Set(results.map((r) => r.keyword.toLowerCase())),
    [results]
  );

  const runQuery = async (keywords: string[]) => {
    const fresh = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 10);
    if (fresh.length === 0 || loading) return;
    setLoading(true);
    setError("");
    const res = await checkSeasonalityAction(fresh, country, leadDays);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setWindows(res.data.windows);
    setResults((prev) => {
      const byKey = new Map(prev.map((r) => [r.keyword.toLowerCase(), r]));
      for (const r of res.data.results) byKey.set(r.keyword.toLowerCase(), r);
      return [...byKey.values()];
    });
  };

  const runJudge = async (r: SeasonalKeywordResult) => {
    const key = r.keyword.toLowerCase();
    if (judging.has(key)) return;
    setJudging((prev) => new Set(prev).add(key));
    setJudgeErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const res = await checkSeasonalityAiAction({
      keyword: r.keyword,
      countryLabel: d.countries[country] ?? country,
      verdict: r.signal.verdict,
      direction: r.signal.direction,
      yoyChangePct: r.signal.yoyChangePct,
      daysToPeak: r.signal.daysToPeak,
      volume: r.volume,
      volumeYoyPct: r.volumeYoyPct,
      score: r.score?.score ?? null,
      language: lang,
    });
    setJudging((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (res.ok) {
      setJudgments((prev) => ({ ...prev, [key]: res.data }));
    } else {
      setJudgeErrors((prev) => ({ ...prev, [key]: res.error }));
    }
  };

  const sorted = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          verdictRank(a.signal.verdict) - verdictRank(b.signal.verdict) ||
          (a.signal.daysToPeak ?? 9999) - (b.signal.daysToPeak ?? 9999)
      ),
    [results]
  );

  const uncheckedOffers = offers.filter((o) => !checked.has(o.name.toLowerCase()));

  return (
    <div>
      <p className="mt-2 text-sm text-ink/60">{d.hint}</p>

      {/* 控制区：国家 + 提前量 + 关键词查询 + 批量查 */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink/70">{d.country}</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {d.countries[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink/70">{d.leadDays}</span>
          <input
            type="number"
            min={1}
            max={60}
            value={leadDays}
            onChange={(e) => setLeadDays(Math.max(1, Math.min(60, Number(e.target.value) || 14)))}
            className="w-24 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal"
          />
        </label>
        <label className="block flex-1 min-w-52">
          <span className="mb-1 block text-sm font-medium text-ink/70">{d.keyword}</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runQuery([keyword]);
            }}
            placeholder={d.keywordPlaceholder}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal"
          />
        </label>
        <button
          type="button"
          onClick={() => void runQuery([keyword])}
          disabled={loading || !keyword.trim()}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:opacity-50"
        >
          {loading ? d.checking : d.check}
        </button>
        <button
          type="button"
          onClick={() => void runQuery(uncheckedOffers.slice(0, 10).map((o) => o.name))}
          disabled={loading || uncheckedOffers.length === 0}
          className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal disabled:opacity-50"
        >
          {d.checkBatch}
        </button>
      </div>
      {/* 参数来源：一键直达（Trends 免费 / DataForSEO 付费）+ 插件抓取填入关键词 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60">
        <CapturePicker
          onPick={(c) => setKeyword(c.title || "")}
          label={d.captureKeyword}
          className=""
        />
        {keyword.trim() ? (
          <a
            href={`https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword.trim())}&geo=${country}`}
            target="_blank"
            rel="noreferrer"
            title={d.trendsLinkHint}
            className="text-signal hover:underline"
          >
            {d.sourcesTrends} ↗
          </a>
        ) : null}
        <a
          href="https://app.dataforseo.com/"
          target="_blank"
          rel="noreferrer"
          title={d.dataforseoLinkHint}
          className="text-signal hover:underline"
        >
          {d.sourcesDataforseo} ↗
        </a>
      </div>
      <p className="mt-1 text-xs text-ink/50">{d.leadDaysHint}</p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      {/* 消费习惯卡：所选国家的通用模式参考（定性过滤，不进评分） */}
      {d.habits[country] ? (
        <section className="mt-4 rounded-lg border border-ink/10 bg-white p-3">
          <h3 className="text-sm font-semibold text-ink">
            {d.habitsTitle}（{d.countries[country] ?? country}）
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-ink/50">{d.habitsTraits}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink/80">
                {d.habits[country]!.traits.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-ink/50">{d.habitsFit}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink/80">
                {d.habits[country]!.fit.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {/* 节日/季节窗口 */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-ink">{d.windowsTitle}</h3>
        {windows.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">{d.windowsEmpty}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {windows.map((w) => (
              <span
                key={`${w.name}-${w.date}`}
                className="inline-flex items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-xs"
              >
                <span className="font-medium text-ink">{w.name}</span>
                <span className="text-ink/60">{w.date}</span>
                <span className="text-ink/60">
                  {w.daysUntil} {d.days}
                </span>
                {w.withinLead ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                    {d.withinLead}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 季节信号结果（按结论优先级排序） */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-ink">{d.resultsTitle}</h3>
        {sorted.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">{d.resultsEmpty}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="text-xs text-ink/50">
                  <th className="py-1 pr-2 font-medium">{d.keyword}</th>
                  <th className="py-1 pr-2 font-medium">{d.resultsTitle}</th>
                  <th className="py-1 pr-2 font-medium">{d.score}</th>
                  <th className="py-1 pr-2 font-medium">{d.current}</th>
                  <th className="py-1 pr-2 font-medium">{d.yoy}</th>
                  <th className="py-1 pr-2 font-medium">{d.daysToPeak}</th>
                  <th className="py-1 pr-2 font-medium">{d.volume}</th>
                  <th className="py-1 pr-2 font-medium">{d.volumeYoy}</th>
                  <th className="py-1 pr-2 font-medium">{d.sparkline}</th>
                  <th className="py-1 pr-2 font-medium">{d.aiJudge}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.keyword.toLowerCase()} className="border-t border-ink/10">
                    <td className="py-1 pr-2 font-medium text-ink">{r.keyword}</td>
                    <td className="py-1 pr-2">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${verdictBadgeClass(r.signal.verdict)}`}
                      >
                        {d.verdict[r.signal.verdict] ?? r.signal.verdict}
                      </span>
                      {r.trendsRateLimited ? (
                        <span className="mt-0.5 block text-xs text-amber-700">{d.rateLimited}</span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2">
                      {r.score?.score == null ? (
                        <span className="text-ink/50">—</span>
                      ) : (
                        <span
                          className="font-semibold text-ink"
                          title={r.score.items
                            .map(
                              (it) =>
                                `${d.scoreItems[it.key] ?? it.key} ${it.points}/${it.max}`
                            )
                            .join(" · ")}
                        >
                          {r.score.score}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">{r.signal.current ?? "—"}</td>
                    <td className="py-1 pr-2">{fmtPct(r.signal.yoyChangePct)}</td>
                    <td className="py-1 pr-2">
                      {r.signal.daysToPeak == null
                        ? "—"
                        : `${r.signal.daysToPeak} ${d.days}`}
                    </td>
                    <td className="py-1 pr-2">{fmtNum(r.volume)}</td>
                    <td className="py-1 pr-2">{fmtPct(r.volumeYoyPct)}</td>
                    <td className="py-1 pr-2">
                      <Sparkline points={r.timeline} />
                    </td>
                    <td className="py-1 pr-2">
                      {judgments[r.keyword.toLowerCase()] ? (
                        <span>
                          <span
                            className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${verdictBadgeClass(
                              judgments[r.keyword.toLowerCase()]!.suggestion === "go"
                                ? "approaching"
                                : judgments[r.keyword.toLowerCase()]!.suggestion === "watch"
                                  ? "upcoming"
                                  : "past"
                            )}`}
                          >
                            {d.aiSuggestion[judgments[r.keyword.toLowerCase()]!.suggestion] ??
                              judgments[r.keyword.toLowerCase()]!.suggestion}
                          </span>
                          <span className="mt-0.5 block max-w-56 text-xs text-ink/70">
                            {judgments[r.keyword.toLowerCase()]!.reason}
                          </span>
                          <span className="block text-xs text-ink/50">
                            {d.aiConfidence}{" "}
                            {judgments[r.keyword.toLowerCase()]!.confidence}%
                          </span>
                        </span>
                      ) : judgeErrors[r.keyword.toLowerCase()] ? (
                        <span className="text-xs text-red-700">
                          {judgeErrors[r.keyword.toLowerCase()]}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void runJudge(r)}
                          disabled={judging.has(r.keyword.toLowerCase())}
                          className="rounded-lg border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink transition hover:border-signal disabled:opacity-50"
                        >
                          {judging.has(r.keyword.toLowerCase())
                            ? d.aiJudging
                            : d.aiJudge}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink/50">
          {d.dataNote} {d.scoreNote}
        </p>
      </section>

      {/* Offer 列表：逐行查季节信号（关键词 = Offer 名） */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold text-ink">
          {d.offerColumn} ({offers.length})
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink/50">
                <th className="py-1 pr-2 font-medium">{d.offerColumn}</th>
                <th className="py-1 pr-2 font-medium">{d.network}</th>
                <th className="py-1 pr-2 font-medium">{d.resultsTitle}</th>
                <th className="py-1 pr-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const res = results.find(
                  (r) => r.keyword.toLowerCase() === o.name.toLowerCase()
                );
                return (
                  <tr key={o.id} className="border-t border-ink/10">
                    <td className="py-1 pr-2 font-medium text-ink">{o.name}</td>
                    <td className="py-1 pr-2 text-ink/70">{o.network}</td>
                    <td className="py-1 pr-2">
                      {res ? (
                        <span
                          className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${verdictBadgeClass(res.signal.verdict)}`}
                        >
                          {d.verdict[res.signal.verdict] ?? res.signal.verdict}
                        </span>
                      ) : (
                        <span className="text-ink/50">—</span>
                      )}
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        onClick={() => void runQuery([o.name])}
                        disabled={loading || checked.has(o.name.toLowerCase())}
                        className="rounded-lg border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink transition hover:border-signal disabled:opacity-50"
                      >
                        {d.checkOffer}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
