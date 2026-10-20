"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NoviceMode } from "./novice-mode";
import { DenylistManager } from "./denylist-manager";
import { CreateComboModal } from "./create-combo-modal";
import { WatchButton } from "./watch-button";
import { SurgeBadge } from "./surge-badge";
import { ClickProfitLine } from "../offers/click-profit-card";
import type { AmazonPipelineDict } from "@/i18n/dict/amazon-pipeline";
import {
  getPipelineRunAction,
  listPipelineRunsAction,
  runPipelineAction,
  type PipelineItemResult,
  type PipelineRunResponse,
  type PipelineRunSummary,
} from "@/lib/api/amazon-pipeline-actions";

/** discovery 页"送入流水线"时写入的 sessionStorage key。 */
export const PIPELINE_IMPORT_KEY = "adlinklab-pipeline-input";

export interface PipelineImportItem {
  asin?: string;
  title: string;
  brand?: string;
  detailPageUrl?: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  opportunity?: boolean;
}

const GATE_LABEL_KEYS = [
  "gateQuality",
  "gateDemand",
  "gateMetrics",
  "gateProfit",
  "gateRisk",
  "gateDenylist",
] as const;

function GateBadge({
  status,
  d,
}: {
  status: "pass" | "fail" | "unknown";
  d: AmazonPipelineDict;
}) {
  const map = {
    pass: { text: d.statusPass, cls: "bg-emerald-100 text-emerald-800" },
    fail: { text: d.statusFail, cls: "bg-red-100 text-red-800" },
    unknown: { text: d.statusUnknown, cls: "bg-ink/10 text-ink/60" },
  } as const;
  const s = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.text}
    </span>
  );
}

function ItemCard({
  item,
  d,
}: {
  item: PipelineItemResult;
  d: AmazonPipelineDict;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-ink/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-lg px-2.5 py-1 text-sm font-bold ${
            item.killed
              ? "bg-red-100 text-red-800"
              : item.worthIndex >= 80
                ? "bg-emerald-100 text-emerald-800"
                : item.worthIndex >= 60
                  ? "bg-sky-100 text-sky-800"
                  : "bg-ink/10 text-ink/70"
          }`}
        >
          {item.worthIndex}
        </span>
        <span className="font-medium text-ink">{item.input.title}</span>
        {item.input.asin ? (
          <span className="text-xs text-ink/50">{item.input.asin}</span>
        ) : null}
        {item.killed ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
            {d.killed}
          </span>
        ) : null}
        {item.input.opportunity === true ? (
          <span className="rounded-full bg-amber-400/80 px-2 py-0.5 text-xs font-semibold text-amber-950">
            🔥 {d.opportunityBonus}
          </span>
        ) : null}
        <WatchButton
          asin={item.input.asin}
          title={item.input.title}
          dict={{ watch: d.watch, watching: d.watching, watched: d.watched }}
        />
        <Link
          href={`/offers/new?source=amazon&name=${encodeURIComponent(item.input.title)}${item.input.price != null ? `&price=${item.input.price}` : ""}${item.input.asin ? `&asin=${encodeURIComponent(item.input.asin)}` : ""}`}
          className="rounded-lg border border-signal/40 px-2.5 py-1 text-xs font-medium text-signal hover:bg-signal/5"
        >
          ➕ {d.createOffer}
        </Link>
        <button
          type="button"
          className="ml-auto text-xs text-signal hover:underline"
          onClick={() => setOpen(!open)}
        >
          {open ? "▲" : "▼"}
        </button>
      </div>
      {item.killed ? (
        <p className="mt-1 text-xs text-red-700">{d.killedReason}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.gates.map((g, i) => (
          <span
            key={g.key}
            className="inline-flex items-center gap-1 rounded-full bg-ink/[0.04] px-2 py-0.5 text-xs text-ink/70"
            title={g.reason}
          >
            {d[GATE_LABEL_KEYS[i] ?? "gateQuality"]}
            <GateBadge status={g.status} d={d} />
          </span>
        ))}
      </div>
      {open ? (
        <ul className="mt-2 space-y-1 text-xs text-ink/70">
          {item.gates.map((g, i) => (
            <li key={g.key}>
              <span className="font-medium text-ink/80">
                {d[GATE_LABEL_KEYS[i] ?? "gateQuality"]}：
              </span>
              {g.reason}
              {g.key === "profit" ? (
                <ClickProfitLine
                  detail={(g.detail ?? {}) as Record<string, unknown>}
                  dict={d.clickProfit}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AmazonPipelineClient({
  dict: d,
  lang,
}: {
  dict: AmazonPipelineDict;
  lang: "zh" | "en";
}) {
  const [rawInput, setRawInput] = useState("");
  const [imported, setImported] = useState<PipelineImportItem[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [minRating, setMinRating] = useState("4.0");
  const [minReviews, setMinReviews] = useState("100");
  const [minMetricsScore, setMinMetricsScore] = useState("60");
  const [estimatedCpc, setEstimatedCpc] = useState("1");
  const [commission, setCommission] = useState("");
  const [maxBe, setMaxBe] = useState("15");
  const [riskCheck, setRiskCheck] = useState(true);
  // 批次5追加：否定清单内置规则开关
  const [denyLowRating, setDenyLowRating] = useState(true);
  const [denyBrandWord, setDenyBrandWord] = useState(true);
  const [denyPolicyCategory, setDenyPolicyCategory] = useState(true);
  const [country, setCountry] = useState("US");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineRunResponse | null>(null);
  const [history, setHistory] = useState<PipelineRunSummary[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PipelineRunResponse | null>(null);

  useEffect(() => {
    void listPipelineRunsAction(1, 10).then((r) => {
      if (r.ok) setHistory(r.data.items);
    });
  }, []);

  function onImport() {
    try {
      const raw = sessionStorage.getItem(PIPELINE_IMPORT_KEY);
      if (!raw) {
        setImportMsg(d.noImported);
        return;
      }
      const arr = JSON.parse(raw) as PipelineImportItem[];
      if (!Array.isArray(arr) || arr.length === 0) {
        setImportMsg(d.noImported);
        return;
      }
      setImported(arr.slice(0, 10));
      setImportMsg(`${d.imported} ${arr.length}`);
    } catch {
      setImportMsg(d.noImported);
    }
  }

  function buildItems(): Array<Record<string, unknown>> {
    const fromText = rawInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((line) =>
        /^[Bb]0[A-Z0-9]{8}$/.test(line.replace(/[^A-Za-z0-9]/g, ""))
          ? {
              asin: line.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
              title: line,
            }
          : { title: line }
      );
    const fromImport = imported.map((p) => ({
      asin: p.asin,
      title: p.title,
      brand: p.brand,
      detailPageUrl: p.detailPageUrl,
      price: p.price ?? undefined,
      rating: p.rating ?? undefined,
      reviewCount: p.reviewCount ?? undefined,
      opportunity: p.opportunity === true,
    }));
    // 去重（按 asin/title）
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    for (const it of [...fromImport, ...fromText]) {
      const key = String(it.asin ?? it.title);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out.slice(0, 10);
  }

  async function onRun() {
    const items = buildItems();
    if (items.length === 0) {
      setError(d.inputHint);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const num = (v: string): number | undefined => {
        const n = Number(v);
        return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
      };
      const r = await runPipelineAction(
        items,
        {
          minRating: num(minRating),
          minReviews: num(minReviews),
          minMetricsScore: num(minMetricsScore),
          estimatedCpc: num(estimatedCpc),
          commission: num(commission),
          maxBreakEvenCvrPct: num(maxBe),
          riskCheck,
          denyLowRating,
          denyBrandWord,
          denyPolicyCategory,
          country,
        },
        name.trim() || undefined
      );
      if (r.ok) {
        setResult(r.data);
        void listPipelineRunsAction(1, 10).then((h) => {
          if (h.ok) setHistory(h.data.items);
        });
      } else {
        setError(r.error);
      }
    } finally {
      setRunning(false);
    }
  }

  async function onViewDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    const r = await getPipelineRunAction(id);
    if (r.ok) {
      setDetail({
        runId: r.data.id,
        createdAt: r.data.createdAt,
        items: r.data.results.items,
        weights: r.data.results.weights,
        evaluatedAt: r.data.results.evaluatedAt,
      });
    }
  }

  const shown = detail ?? result;
  // 第九批：组合测试勾选（5-10 个）
  const [comboSelected, setComboSelected] = useState<Set<number>>(new Set());
  const [comboOpen, setComboOpen] = useState(false);

  function toggleCombo(i: number) {
    setComboSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <NoviceMode dict={d.novice} lang={lang} />

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-ink">{d.title}</h1>
          <SurgeBadge label={d.surgeBadge} />
        </div>
        <p className="mt-1 text-sm text-ink/60">{d.description}</p>
        <p className="mt-1 text-xs text-ink/50">{d.weightsNote}</p>
      </section>

      {/* 输入 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.inputTitle}</h2>
        <p className="mt-1 text-sm text-ink/60">{d.inputHint}</p>
        <div className="mt-3">
          <button
            type="button"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
            onClick={onImport}
          >
            {d.importFromDiscovery}
          </button>
          {importMsg ? (
            <span className="ml-2 text-xs text-ink/60">{importMsg}</span>
          ) : null}
        </div>
        <textarea
          className="mt-3 h-28 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          placeholder={d.inputPlaceholder}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
        />
        {imported.length > 0 ? (
          <p className="mt-1 text-xs text-ink/60">
            {d.imported}: {imported.length}
          </p>
        ) : null}
      </section>

      {/* 阈值 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.optionsTitle}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: d.minRating, value: minRating, set: setMinRating },
            { label: d.minReviews, value: minReviews, set: setMinReviews },
            { label: d.minMetricsScore, value: minMetricsScore, set: setMinMetricsScore },
            { label: d.estimatedCpc, value: estimatedCpc, set: setEstimatedCpc },
            { label: d.commission, value: commission, set: setCommission },
            { label: d.maxBreakEvenCvrPct, value: maxBe, set: setMaxBe },
          ].map((f) => (
            <div key={f.label}>
              <label className="mb-1 block text-xs text-ink/60">{f.label}</label>
              <input
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                inputMode="decimal"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs text-ink/60">{d.country}</label>
            <select
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {["US", "UK", "DE", "FR", "IT", "ES", "CA", "AU", "JP"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="riskCheck"
              type="checkbox"
              checked={riskCheck}
              onChange={(e) => setRiskCheck(e.target.checked)}
            />
            <label htmlFor="riskCheck" className="text-xs text-ink/70">
              {d.riskCheck}
            </label>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="denyLowRating"
              type="checkbox"
              checked={denyLowRating}
              onChange={(e) => setDenyLowRating(e.target.checked)}
            />
            <label htmlFor="denyLowRating" className="text-xs text-ink/70">
              {d.denyLowRating}
            </label>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="denyBrandWord"
              type="checkbox"
              checked={denyBrandWord}
              onChange={(e) => setDenyBrandWord(e.target.checked)}
            />
            <label htmlFor="denyBrandWord" className="text-xs text-ink/70">
              {d.denyBrandWord}
            </label>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="denyPolicyCategory"
              type="checkbox"
              checked={denyPolicyCategory}
              onChange={(e) => setDenyPolicyCategory(e.target.checked)}
            />
            <label htmlFor="denyPolicyCategory" className="text-xs text-ink/70">
              {d.denyPolicyCategory}
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
            placeholder={d.runNamePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={running}
            onClick={onRun}
          >
            {running ? d.running : d.run}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </section>

      {/* 别碰清单（批次5追加） */}
      <DenylistManager dict={d.denylist} />

      {comboOpen && shown ? (
        <CreateComboModal
          dict={d.combo}
          items={shown.items
            .filter((_, i) => comboSelected.has(i))
            .map((it) => ({
              asin: it.input.asin,
              title: it.input.title,
              brand: it.input.brand,
              detailPageUrl: it.input.detailPageUrl,
              price: it.input.price ?? null,
              rating: it.input.rating ?? null,
              reviewCount: it.input.reviewCount ?? null,
            }))}
          onClose={() => setComboOpen(false)}
        />
      ) : null}

      {/* 结果 */}
      {shown ? (
        <section className="rounded-xl border border-ink/10 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">
              {d.resultsTitle}（{shown.items.length} {d.itemsCount}）
            </h2>
            <button
              type="button"
              onClick={() => setComboOpen(true)}
              disabled={comboSelected.size < 5 || comboSelected.size > 10}
              title={d.comboHint}
              className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-40"
            >
              {d.comboButton}（{comboSelected.size}）
            </button>
          </div>
          <p className="mt-1 text-xs text-ink/50">{d.formulaNote}</p>
          <p className="mt-1 text-xs text-ink/50">{d.comboHint}</p>
          <div className="mt-3 space-y-3">
            {shown.items.map((item, i) => (
              <div key={`${item.input.asin ?? item.input.title}-${i}`} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={comboSelected.has(i)}
                  onChange={() => toggleCombo(i)}
                  title={d.comboHint}
                  className="mt-5 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <ItemCard item={item} d={d} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 历史 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.historyTitle}</h2>
        {detailId && detail ? (
          <div className="mt-2">
            <button
              type="button"
              className="text-xs text-signal hover:underline"
              onClick={() => {
                setDetailId(null);
                setDetail(null);
              }}
            >
              ← {d.backToList}
            </button>
          </div>
        ) : history.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-ink/80">
                <span>{h.name || h.id.slice(0, 8)}</span>
                <span className="text-xs text-ink/50">
                  {h.itemCount} {d.itemsCount} · {h.createdAt.slice(0, 10)}
                </span>
                <button
                  type="button"
                  className="text-xs text-signal hover:underline"
                  onClick={() => onViewDetail(h.id)}
                >
                  {d.viewDetail}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/50">{d.historyEmpty}</p>
        )}
      </section>
    </div>
  );
}
