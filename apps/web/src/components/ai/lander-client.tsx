"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { DataQualityBadge } from "@/components/data-quality-badge";
import {
  analyzeLandingPageAction,
  getLanderAnalysisAction,
  listLanderAnalysesAction,
} from "@/lib/api/lander-actions";
import {
  listOfferCapturesAction,
  getOfferCaptureAction,
} from "@/lib/api/ai-actions";
import type { OfferCaptureItem } from "@/lib/api/ai";
import type { P1ActionResult } from "@/lib/api/p1-actions";
import type {
  LanderAnalysis,
  LanderDimension,
  LanderIssue,
} from "@/lib/api/lander";

const DIMENSION_ORDER: LanderDimension[] = [
  "performance",
  "cta",
  "trust",
  "mobile",
  "copy",
  "bounceRisk",
];

const SEVERITY_STYLES: Record<LanderIssue["severity"], string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-ink/10 text-ink/60",
};

function scoreBarClass(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-amber-400";
  return "bg-red-400";
}

/**
 * Presentational report view (pure props) — unit-tested via
 * renderToStaticMarkup with the English dictionary.
 */
export function LanderDashboard({ analysis }: { analysis: LanderAnalysis }) {
  const t = useDict();
  const d = t.ai.lander;
  return (
    <div className="mt-6 space-y-6">
      {/* Overall score */}
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex items-center gap-3">
          <div className="text-5xl font-bold text-ink">
            {analysis.overallScore}
          </div>
          <div>
            <div className="text-sm font-medium text-ink/70">
              {d.overallScore}
            </div>
            <DataQualityBadge quality="OBSERVED" />
          </div>
        </div>
        <div className="mt-1 text-xs text-ink/50">
          {analysis.url} · {analysis.domain}
        </div>
      </div>

      {/* Dimension bars */}
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {DIMENSION_ORDER.map((dim) => {
            const score = analysis.scores[dim];
            return (
              <div key={dim}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-ink/80">
                    {d.dimensions[dim]}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{score}</span>
                    <DataQualityBadge quality="OBSERVED" />
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className={`h-full rounded-full ${scoreBarClass(
                      dim === "bounceRisk" ? 100 - score : score
                    )}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.issues}</h2>
        {analysis.issues.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">{d.noIssues}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {analysis.issues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-sm"
              >
                <span
                  className={`mt-0.5 inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[issue.severity]}`}
                >
                  {d.severity[issue.severity]}
                </span>
                <span className="text-ink/80">
                  <span className="font-medium">
                    {d.dimensions[issue.dimension]}：
                  </span>
                  {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* AI suggestions */}
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">{d.suggestions}</h2>
          <DataQualityBadge quality="PREDICTED" />
        </div>
        {analysis.suggestions.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">{d.noSuggestions}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {analysis.suggestions.map((s, i) => (
              <li
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-ink/85"
              >
                <span className="mr-2 font-semibold text-amber-700">
                  {i + 1}.
                </span>
                {s.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";

export function LanderClient() {
  const t = useDict();
  const d = t.ai.lander;
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [url, setUrl] = useState("");
  const [manualHtml, setManualHtml] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LanderAnalysis | null>(null);
  const [history, setHistory] = useState<LanderAnalysis[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [captures, setCaptures] = useState<OfferCaptureItem[]>([]);
  const [capturesLoading, setCapturesLoading] = useState(false);
  const [capturesLoaded, setCapturesLoaded] = useState(false);
  const [showCaptures, setShowCaptures] = useState(false);
  const [captureApplying, setCaptureApplying] = useState(false);

  async function loadCaptures() {
    setCapturesLoading(true);
    const res = await listOfferCapturesAction();
    setCapturesLoading(false);
    setCapturesLoaded(true);
    if (res.ok) setCaptures(res.data);
  }

  async function useCapture(c: OfferCaptureItem) {
    if (captureApplying) return;
    setCaptureApplying(true);
    const res = await getOfferCaptureAction(c.id);
    setCaptureApplying(false);
    if (!res.ok || !res.data.html) {
      setError(d.captureNoHtml);
      return;
    }
    setUrl(res.data.finalUrl);
    setManualHtml(res.data.html.slice(0, 500000));
    setMode("manual");
    setShowCaptures(false);
  }

  async function loadHistory() {
    const res: P1ActionResult<{ items: LanderAnalysis[]; total: number }> =
      await listLanderAnalysesAction(1, 20);
    if (res.ok) {
      setHistory(res.data.items);
      setHistoryTotal(res.data.total);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function onAnalyze(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError(d.needUrl);
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setError(d.invalidUrl);
      return;
    }
    if (mode === "manual" && !manualHtml.trim()) {
      setError(d.needManualHtml);
      return;
    }
    setError(null);
    setAnalyzing(true);
    try {
      const res = await analyzeLandingPageAction(
        trimmed,
        mode === "manual" ? manualHtml.trim() : undefined
      );
      if (res.ok) {
        setResult(res.data);
        await loadHistory();
      } else {
        setError(res.error);
        // 自动抓取失败时提示切手动
        if (mode === "auto" && /fetch|network|403/i.test(res.error)) {
          setError(`${res.error} ${d.tryManualHint}`);
        }
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function onViewDetail(id: string) {
    const res = await getLanderAnalysisAction(id);
    if (res.ok) {
      setResult(res.data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setError(res.error);
    }
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {/* 自动抓取 / 手动粘贴 */}
      <div className="mt-6 flex gap-1 rounded-xl bg-ink/[0.05] p-1">
        {(["auto", "manual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              mode === m ? "bg-white text-ink shadow-sm" : "text-ink/50 hover:text-ink/80"
            }`}
          >
            {m === "auto" ? `🌐 ${d.modeAuto}` : `📋 ${d.modeManual}`}
          </button>
        ))}
      </div>
      {mode === "manual" && (
        <p className="mt-2 text-xs text-ink/55">{d.manualHint}</p>
      )}

      {/* 浏览器插件抓取：反爬站点用插件抓真实 HTML，一键填入手动模式 */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => { setShowCaptures((v) => !v); if (!capturesLoaded) loadCaptures(); }}
          className="text-xs text-ink/60 hover:text-ink"
        >
          🧩 {d.capturesToggle} {showCaptures ? "▲" : "▼"}
        </button>
        {showCaptures ? (
          <div className="mt-2 space-y-1.5 rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
            {capturesLoading ? (
              <p className="text-xs text-ink/50">{d.capturesLoading}</p>
            ) : captures.length === 0 ? (
              <p className="text-xs text-ink/50">{d.capturesEmpty}</p>
            ) : captures.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-white/60 px-2 py-1.5">
                <div className="min-w-0 text-xs">
                  <p className="truncate font-medium text-ink">{c.title || c.finalUrl}</p>
                  <p className="truncate text-ink/50">
                    {c.hasHtml ? "📄 HTML ✓ · " : ""}
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => useCapture(c)}
                  disabled={captureApplying || !c.hasHtml}
                  className="shrink-0 rounded-md border border-ink/15 px-2 py-1 text-xs text-ink hover:bg-ink/5 disabled:opacity-40"
                >
                  {d.useCapture}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onAnalyze}
        className="mt-4 flex flex-col gap-3"
      >
        <div>
          <label htmlFor="lander-url" className="sr-only">
            {d.urlLabel}
          </label>
          <input
            id="lander-url"
            className={inputClass}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={d.urlPlaceholder}
            disabled={analyzing}
          />
        </div>
        {mode === "manual" && (
          <textarea
            rows={6}
            className={`${inputClass} font-mono`}
            value={manualHtml}
            onChange={(e) => setManualHtml(e.target.value)}
            placeholder={d.manualPlaceholder}
            disabled={analyzing}
          />
        )}
        <div>
          <button
            type="submit"
            disabled={analyzing}
            className="rounded-lg bg-signal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {analyzing ? d.analyzing : d.analyze}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {result ? <LanderDashboard analysis={result} /> : null}

      {/* History */}
      <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">
          {d.history}
          {historyTotal > 0 ? ` (${historyTotal})` : ""}
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">{d.noHistory}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/10">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{h.url}</div>
                  <div className="text-xs text-ink/50">
                    {d.analyzedAt}:{" "}
                    {new Date(h.analyzedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold text-ink">
                    {h.overallScore}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onViewDetail(h.id)}
                    className="rounded-lg border border-ink/15 px-3 py-1 text-xs font-medium text-ink/70 hover:bg-ink/5"
                  >
                    {d.viewDetail}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
