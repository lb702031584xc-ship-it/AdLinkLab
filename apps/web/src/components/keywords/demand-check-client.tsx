"use client";

/**
 * 需求验证清单（关键词启动包 · 需求验证 Tab）：
 * 逐词填写月搜索量 / 趋势 / 竞争度 / 意图 → 自动输出「需求是否存在 / 竞争是否可打」结论。
 * 纯前端，无后端依赖。
 */
import { useEffect, useMemo, useState } from "react";
import type { KeywordStarterDict } from "@/i18n/dict/keyword-starter";
import { useWorkState } from "@/lib/use-work-state";
import { recommendKeywordsAction } from "@/lib/api/ai-actions";
import type { RecommendedKeyword } from "@/lib/api/ai";
import { CapturePicker } from "@/components/ai/capture-picker";

type Trend = "up" | "flat" | "down";
type Competition = "low" | "medium" | "high";
type Intent = "buy" | "review" | "compare" | "info";
type Verdict = "good" | "caution" | "bad";

interface DemandRow {
  id: string;
  keyword: string;
  volume: string; // 手填数字字符串
  trend: Trend;
  competition: Competition;
  intent: Intent;
}

export interface SeedImportSignal {
  words: string[];
  seq: number;
}

let rowSeq = 0;
const newRow = (keyword = ""): DemandRow => ({
  id: `dm-${++rowSeq}`,
  keyword,
  volume: "",
  trend: "flat",
  competition: "medium",
  intent: "buy",
});

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-signal";
const labelCls = "mb-1 block text-xs font-medium text-ink/60";

function plannerUrl(): string {
  return "https://ads.google.com/aw/keywordplanner/home";
}
function trendsUrl(kw: string): string {
  const q = encodeURIComponent(kw.trim());
  return q ? `https://trends.google.com/trends/explore?q=${q}` : "https://trends.google.com/";
}
function semrushUrl(): string {
  return "https://www.semrush.com/";
}

/** 需求强度：按月搜索量分档 */
function demandLevel(volume: string): "strong" | "weak" | "none" {
  const v = Number(volume);
  if (!Number.isFinite(v) || v < 100) return "none";
  if (v < 1000) return "weak";
  return "strong";
}

/** 是否可打：竞争度 × 意图 */
function beatable(
  competition: Competition,
  intent: Intent,
  trend: Trend
): "yes" | "caution" | "no" {
  if (competition === "high") return "no";
  if (competition === "medium") return "caution";
  if (intent === "info") return "caution";
  if (trend === "down") return "caution";
  return "yes";
}

function verdictOf(row: DemandRow): Verdict {
  const dl = demandLevel(row.volume);
  if (dl === "none") return "bad";
  const b = beatable(row.competition, row.intent, row.trend);
  if (b === "no") return "bad";
  if (b === "caution" || dl === "weak") return "caution";
  return "good";
}

/**
 * 真实数据综合评分 0-100（透明公式，所有输入均为用户填入的真实数据）：
 * - 搜索量 30 分：≥10000=30, ≥5000=25, ≥1000=18, ≥500=10, ≥100=5, <100=0
 * - 意图 30 分：buy=30, review=24, compare=16, info=4
 * - 竞争 25 分：low=25, medium=13, high=3
 * - 趋势 15 分：up=15, flat=9, down=3
 */
export function scoreOf(row: DemandRow): { total: number; parts: string } {
  const v = Number(row.volume);
  const volumeScore = !Number.isFinite(v) || v < 100 ? 0
    : v >= 10000 ? 30 : v >= 5000 ? 25 : v >= 1000 ? 18 : v >= 500 ? 10 : 5;
  const intentScore = { buy: 30, review: 24, compare: 16, info: 4 }[row.intent];
  const compScore = { low: 25, medium: 13, high: 3 }[row.competition];
  const trendScore = { up: 15, flat: 9, down: 3 }[row.trend];
  const total = volumeScore + intentScore + compScore + trendScore;
  const parts = `搜索量${volumeScore}+意图${intentScore}+竞争${compScore}+趋势${trendScore}`;
  return { total, parts };
}

const scoreCls = (s: number) =>
  s >= 75
    ? "bg-emerald-100 text-emerald-800"
    : s >= 50
      ? "bg-amber-100 text-amber-800"
      : "bg-ink/10 text-ink/60";

const verdictCls: Record<Verdict, string> = {
  good: "bg-emerald-100 text-emerald-800",
  caution: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-700",
};

export function DemandCheckClient({
  dict: d,
  importSignal,
  aiProduct,
  onValidatedReady,
  offerId,
  offerName,
}: {
  dict: KeywordStarterDict;
  importSignal: SeedImportSignal | null;
  aiProduct?: string;
  onValidatedReady?: (words: string[]) => void;
  offerId?: string | null;
  offerName?: string | null;
}) {
  const [rows, setRows] = useState<DemandRow[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  // AI 推荐关键词
  const [aiProductInput, setAiProductInput] = useState(aiProduct ?? "");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiKeywords, setAiKeywords] = useState<RecommendedKeyword[]>([]);

  /* 自动保存：刷新/隔夜后可恢复（租户隔离） */
  const { historyOpen, historyItems, restoredAt, toggleHistory, restoreFromHistory } =
    useWorkState({
      page: "keyword-research",
      offerId: offerId ?? null,
      label: offerName ?? aiProductInput.trim() ?? null,
      buildSnapshot: () => ({ version: 1, rows, aiProductInput, aiKeywords }),
      isMeaningful: (s) => {
        const rs = s.rows as DemandRow[] | undefined;
        const ks = s.aiKeywords as unknown[] | undefined;
        return (
          (Array.isArray(rs) && rs.some((r) => r.keyword?.trim())) ||
          (Array.isArray(ks) && ks.length > 0)
        );
      },
      applySnapshot: (s) => {
        // 合并语义：已有的行不丢，快照里的词去重追加
        const rs = s.rows as DemandRow[] | undefined;
        const ks = s.aiKeywords as RecommendedKeyword[] | undefined;
        if (Array.isArray(rs) && rs.length > 0) {
          const clean = rs.filter((r) => r && typeof r.keyword === "string" && r.keyword.trim());
          if (clean.length > 0) {
            setRows((cur) => {
              const have = new Set(
                cur.map((r) => r.keyword.trim().toLowerCase()).filter(Boolean)
              );
              const fresh = clean
                .filter((r) => !have.has(r.keyword.trim().toLowerCase()))
                .map((r) => ({ ...newRow(), ...r }));
              return [...cur, ...fresh];
            });
          }
        }
        if (Array.isArray(ks) && ks.length > 0) {
          setAiKeywords((cur) => {
            const have = new Set(cur.map((k) => k.keyword?.trim().toLowerCase()).filter(Boolean));
            return [...cur, ...ks.filter((k) => k && !have.has(k.keyword?.trim().toLowerCase()))];
          });
        }
        if (typeof s.aiProductInput === "string" && s.aiProductInput.trim() && !aiProductInput.trim()) {
          setAiProductInput(s.aiProductInput);
        }
      },
      watch: [offerId, rows, aiProductInput, aiKeywords],
    });

  // offer 选择变化时同步到 AI 输入框
  useEffect(() => {
    if (aiProduct) setAiProductInput(aiProduct);
  }, [aiProduct]);

  const onAiRecommend = async () => {
    const p = aiProductInput.trim();
    if (!p || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await recommendKeywordsAction(p, 10);
      if (res.ok) {
        setAiKeywords(res.data.keywords);
      } else {
        setAiError(res.error || d.aiFailed);
      }
    } catch {
      setAiError(d.aiFailed);
    } finally {
      setAiLoading(false);
    }
  };

  const importAiKeyword = (kw: string) => {
    const t = kw.trim();
    if (!t) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      if (have.has(t.toLowerCase())) return rs;
      return [...rs, newRow(t)];
    });
  };

  const importAllAi = () => {
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = aiKeywords
        .map((k) => k.keyword.trim())
        .filter((w) => w && !have.has(w.toLowerCase()))
        .map((w) => newRow(w));
      return [...rs, ...fresh];
    });
  };

  // 上方种子词一键导入（去重）
  useEffect(() => {
    if (!importSignal || importSignal.seq === 0) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = importSignal.words
        .map((w) => w.trim())
        .filter((w) => w && !have.has(w.toLowerCase()))
        .map((w) => newRow(w));
      return fresh.length ? [...rs, ...fresh] : rs;
    });
  }, [importSignal]);

  const update = (id: string, patch: Partial<DemandRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (!kw) return;
    setRows((rs) => [...rs, newRow(kw)]);
    setKwInput("");
  };

  const doBulkImport = () => {
    const words = bulkText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!words.length) {
      setBulkOpen(false);
      return;
    }
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = words
        .filter((w) => !have.has(w.toLowerCase()))
        .map((w) => newRow(w));
      return [...rs, ...fresh];
    });
    setBulkText("");
    setBulkOpen(false);
  };

  const summary = useMemo(() => {
    let good = 0, caution = 0, bad = 0;
    for (const r of rows) {
      const v = verdictOf(r);
      if (v === "good") good++;
      else if (v === "caution") caution++;
      else bad++;
    }
    return { total: rows.length, good, caution, bad };
  }, [rows]);

  const summaryText = d.summaryLine
    .replace("{total}", String(summary.total))
    .replace("{good}", String(summary.good))
    .replace("{caution}", String(summary.caution))
    .replace("{bad}", String(summary.bad));

  const exportValidated = () => {
    const words = rows
      .filter((r) => {
        const v = verdictOf(r);
        return v === "good" || v === "caution";
      })
      .map((r) => r.keyword.trim())
      .filter(Boolean);
    if (words.length && onValidatedReady) onValidatedReady(words);
  };

  return (
    <div className="mt-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink">📊 {d.demandTitle}</h2>
        <p className="mt-1 text-sm text-ink/60">{d.demandSubtitle}</p>
      </div>

      {/* 自动保存 + 历史记录 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleHistory}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          🕘 {d.history} {historyOpen ? "▾" : "▸"}
        </button>
        {restoredAt && (
          <span className="text-xs text-emerald-700">
            ✓ {d.restoredNote.replace("{time}", new Date(restoredAt).toLocaleString())}
          </span>
        )}
        <span className="text-xs text-ink/45">{d.autosaveHint}</span>
      </div>
      {historyOpen && (
        <div className="rounded-xl border border-ink/10 bg-white/70 p-3">
          {historyItems.length === 0 ? (
            <p className="text-sm text-ink/55">{d.historyEmpty}</p>
          ) : (
            <ul className="divide-y divide-ink/5">
              {historyItems.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => restoreFromHistory(h)}
                    className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-ink/[0.03]"
                  >
                    <span className="truncate text-sm font-medium text-ink">
                      {h.label || d.historyUntitled}
                    </span>
                    <span className="shrink-0 text-xs text-ink/50">
                      {new Date(h.updatedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* AI 推荐关键词 */}
      <div className="rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">🤖 {d.aiRecommendTitle}</h3>
        </div>
        <p className="mt-1 text-xs text-ink/50">{d.aiRecommendHint}</p>
        <CapturePicker
          onPick={(c) => {
            const v = [c.title, c.description].filter(Boolean).join(" ").slice(0, 500);
            if (v) setAiProductInput(v);
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={aiProductInput}
            onChange={(e) => setAiProductInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAiRecommend()}
            placeholder={d.aiProductPlaceholder}
            className={`${inputCls} max-w-xs`}
          />
          <button
            type="button"
            onClick={onAiRecommend}
            disabled={aiLoading || !aiProductInput.trim()}
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {aiLoading ? d.aiRecommending : d.aiRecommendBtn}
          </button>
          {aiKeywords.length > 0 && (
            <button
              type="button"
              onClick={importAllAi}
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {d.aiImportAll} ({aiKeywords.length})
            </button>
          )}
        </div>
        {aiError && (
          <p className="mt-2 text-xs text-red-600">{aiError}</p>
        )}
        {aiKeywords.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs text-ink/50">{d.aiNoScoreHint}</p>
            {aiKeywords.map((k) => (
              <div
                key={k.keyword}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{k.keyword}</span>
                  {k.reason && (
                    <p className="truncate text-xs text-ink/50">{k.reason}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => importAiKeyword(k.keyword)}
                  className="shrink-0 text-xs text-signal hover:underline"
                >
                  {d.aiImportOne}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKeyword()}
          placeholder={d.kwPlaceholder}
          className={`${inputCls} max-w-xs`}
        />
        <button
          type="button"
          onClick={addKeyword}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          + {d.addKeyword}
        </button>
        <button
          type="button"
          onClick={() => setBulkOpen((o) => !o)}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          {d.importKeywords}
        </button>
      </div>

      {bulkOpen && (
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={d.bulkPlaceholder}
            rows={5}
            className={inputCls}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={doBulkImport}
              className="rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {d.doImport}
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(false)}
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {d.cancel}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 bg-white/50 p-6 text-center text-sm text-ink/50">
          {d.emptyDemand}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const v = verdictOf(r);
            const dl = demandLevel(r.volume);
            const b = beatable(r.competition, r.intent, r.trend);
            const score = scoreOf(r);
            const hasData = r.volume.trim() !== "";
            return (
              <div key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-ink">{r.keyword}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {hasData && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${scoreCls(score.total)}`}
                        title={`${d.aiScore}：${score.parts}（基于你填的真实数据）`}
                      >
                        {score.total}分
                      </span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictCls[v]}`}>
                      {d.verdictOptions[v]}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      className="text-xs text-ink/40 hover:text-red-600"
                    >
                      {d.remove}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className={labelCls}>{d.thVolume}</label>
                    <input
                      value={r.volume}
                      onChange={(e) => update(r.id, { volume: e.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      placeholder="1000"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{d.thTrend}</label>
                    <select
                      value={r.trend}
                      onChange={(e) => update(r.id, { trend: e.target.value as Trend })}
                      className={inputCls}
                    >
                      {(Object.keys(d.trendOptions) as Trend[]).map((k) => (
                        <option key={k} value={k}>{d.trendOptions[k]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{d.thCompetition}</label>
                    <select
                      value={r.competition}
                      onChange={(e) => update(r.id, { competition: e.target.value as Competition })}
                      className={inputCls}
                    >
                      {(Object.keys(d.competitionOptions) as Competition[]).map((k) => (
                        <option key={k} value={k}>{d.competitionOptions[k]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{d.thIntent}</label>
                    <select
                      value={r.intent}
                      onChange={(e) => update(r.id, { intent: e.target.value as Intent })}
                      className={inputCls}
                    >
                      {(Object.keys(d.intentOptions) as Intent[]).map((k) => (
                        <option key={k} value={k}>{d.intentOptions[k]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60">
                  <span>{d.demandLabel}：<b className="text-ink/80">{d.demandLevels[dl]}</b></span>
                  <span>{d.beatableLabel}：<b className="text-ink/80">{d.beatableLevels[b]}</b></span>
                  <span className="ml-auto flex gap-2">
                    <a href={plannerUrl()} target="_blank" rel="noreferrer" className="text-signal hover:underline">{d.openPlanner} ↗</a>
                    <a href={trendsUrl(r.keyword)} target="_blank" rel="noreferrer" className="text-signal hover:underline">{d.openTrends} ↗</a>
                    <a href={semrushUrl()} target="_blank" rel="noreferrer" className="text-signal hover:underline">{d.openSemrush} ↗</a>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-signal/30 bg-signal/[0.06] p-4">
          <p className="text-sm font-bold text-ink">✅ {d.summaryTitle}</p>
          <p className="mt-1 text-sm text-ink/80">{summaryText}</p>
          {onValidatedReady && summary.good + summary.caution > 0 && (
            <button
              type="button"
              onClick={exportValidated}
              className="mt-2 rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              🚀 {d.importValidatedBtn.replace("{n}", String(summary.good + summary.caution))}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
