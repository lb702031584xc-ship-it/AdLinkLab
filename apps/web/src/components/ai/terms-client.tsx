"use client";

import { useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import { EntityPageHeader } from "@/components/entities/ui";
import { analyzeTermsAction, screenOffersAction, getOfferCaptureAction } from "@/lib/api/ai-actions";
import { CapturePicker } from "@/components/ai/capture-picker";
import type {
  AiScreenResultItem,
  AiTermsResult,
  RestrictionValue,
} from "@/lib/api/ai";

type Verdict = "go" | "caution" | "stop";

function verdictBadge(v: Verdict): string {
  if (v === "go") return "bg-green-100 text-green-800";
  if (v === "caution") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function restrictionBadge(v: RestrictionValue): string {
  if (v === "allowed") return "bg-green-100 text-green-800";
  if (v === "forbidden") return "bg-red-100 text-red-800";
  if (v === "restricted") return "bg-amber-100 text-amber-800";
  return "bg-ink/10 text-ink/60";
}

function severityBadge(s: "high" | "medium" | "low"): string {
  if (s === "high") return "bg-red-100 text-red-800";
  if (s === "medium") return "bg-amber-100 text-amber-800";
  return "bg-ink/10 text-ink/60";
}

const TRAFFIC_KEYS = ["search", "display", "email", "social", "incentivized"] as const;

function TermsReport({ result }: { result: AiTermsResult }) {
  const t = useDict();
  const d = t.ai.terms;
  const terms = result.terms;

  return (
    <div className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink/60">{d.verdictLabel}</span>
        <span
          className={`rounded-full px-4 py-1.5 text-base font-semibold ${verdictBadge(terms.overallVerdict)}`}
        >
          {d.verdict[terms.overallVerdict]}
        </span>
        <span className="text-xs text-ink/45">
          {d.analyzedAt(formatDateTime(result.analyzedAt))}
        </span>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-ink">{d.restrictions}</h3>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          <tr className="border-t border-ink/10">
            <td className="py-2 pr-4 font-medium text-ink/70">{d.traffic}</td>
            <td className="py-2">
              <div className="flex flex-wrap gap-2">
                {TRAFFIC_KEYS.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="text-ink/60">{d.trafficTypes[k]}:</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${restrictionBadge(terms.traffic[k])}`}
                    >
                      {d.restrictionValues[terms.traffic[k]]}
                    </span>
                  </span>
                ))}
              </div>
            </td>
          </tr>
          <tr className="border-t border-ink/10">
            <td className="py-2 pr-4 font-medium text-ink/70">{d.brandBidding}</td>
            <td className="py-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${restrictionBadge(terms.brandBidding)}`}
              >
                {d.restrictionValues[terms.brandBidding]}
              </span>
            </td>
          </tr>
          <tr className="border-t border-ink/10">
            <td className="py-2 pr-4 font-medium text-ink/70">{d.directLinking}</td>
            <td className="py-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${restrictionBadge(terms.directLinking)}`}
              >
                {d.restrictionValues[terms.directLinking]}
              </span>
            </td>
          </tr>
          <tr className="border-t border-ink/10">
            <td className="py-2 pr-4 font-medium text-ink/70">{d.geo}</td>
            <td className="py-2 text-ink/80">
              {terms.geoRestrictions.length > 0
                ? terms.geoRestrictions.join("、")
                : d.noGeo}
            </td>
          </tr>
          <tr className="border-t border-ink/10">
            <td className="py-2 pr-4 font-medium text-ink/70">{d.caps}</td>
            <td className="py-2 text-ink/80">{terms.caps ?? d.notSpecified}</td>
          </tr>
          <tr className="border-t border-b border-ink/10">
            <td className="py-2 pr-4 font-medium text-ink/70">{d.payoutTerms}</td>
            <td className="py-2 text-ink/80">
              {terms.payoutTerms ?? d.notSpecified}
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="mt-6 text-sm font-semibold text-ink">{d.redFlags}</h3>
      {terms.redFlags.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {terms.redFlags.map((f, i) => (
            <li
              key={i}
              className="rounded-lg border border-ink/10 bg-white px-3 py-2"
            >
              <span
                className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(f.severity)}`}
              >
                {t.ai.analyze.severity[f.severity]}
              </span>
              <span className="text-sm font-medium text-ink">{f.title}</span>
              <p className="mt-1 text-sm text-ink/65">{f.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink/50">{d.noRedFlags}</p>
      )}

      <h3 className="mt-6 text-sm font-semibold text-ink">{d.summary}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink/75">{terms.summary}</p>
    </div>
  );
}

function ScreenRow({
  verdict,
  name,
  keyRisks,
  summary,
}: AiScreenResultItem) {
  const t = useDict();
  const d = t.ai.terms;
  return (
    <tr className="border-t border-ink/10">
      <td className="px-3 py-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictBadge(verdict)}`}
        >
          {d.verdict[verdict]}
        </span>
      </td>
      <td className="px-3 py-2 font-medium text-ink">{name}</td>
      <td className="px-3 py-2 text-sm text-ink/70">
        {keyRisks.length > 0 ? (
          <ul className="list-disc pl-4">
            {keyRisks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          d.batch.noRisks
        )}
      </td>
      <td className="px-3 py-2 text-sm text-ink/70">{summary}</td>
    </tr>
  );
}

interface BatchRow {
  key: number;
  name: string;
  text: string;
}

export function TermsClient({
  isAdmin,
  showSetupNudge,
  hideHeader,
  onVerdict,
}: {
  isAdmin: boolean;
  showSetupNudge: boolean;
  /** Worksheet embedding: hide the page header (the step card provides it). */
  hideHeader?: boolean;
  /** Worksheet embedding: report the step verdict upward. */
  onVerdict?: (v: "go" | "caution" | "stop" | null) => void;
}) {
  const t = useDict();
  const d = t.ai.terms;
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([{ key: 0, name: "", text: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [singleResult, setSingleResult] = useState<AiTermsResult | null>(null);
  const [batchResults, setBatchResults] = useState<AiScreenResultItem[] | null>(
    null
  );

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  function handleActionError(res: { error: string; code?: string }) {
    if (res.code === "AI_NOT_CONFIGURED") setNotConfigured(true);
    else setError(res.error);
  }

  async function onSingleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError(d.needInput);
      return;
    }
    setError(null);
    setNotConfigured(false);
    setWorking(true);
    try {
      const res = await analyzeTermsAction(text.trim());
      if (res.ok) {
        setSingleResult(res.data);
        onVerdict?.(res.data.terms.overallVerdict);
      } else handleActionError(res);
    } finally {
      setWorking(false);
    }
  }

  async function onBatchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const items = rows
      .filter((r) => r.text.trim())
      .map((r) => ({ name: r.name.trim() || undefined, text: r.text.trim() }));
    if (items.length === 0) {
      setError(d.batch.needOne);
      return;
    }
    setError(null);
    setNotConfigured(false);
    setWorking(true);
    try {
      const res = await screenOffersAction(items);
      if (res.ok) {
        setBatchResults(res.data.results);
        const vs = res.data.results.map((r) => r.verdict);
        onVerdict?.(
          vs.includes("stop") ? "stop" : vs.includes("caution") ? "caution" : "go"
        );
      } else handleActionError(res);
    } finally {
      setWorking(false);
    }
  }

  function reset() {
    setSingleResult(null);
    setBatchResults(null);
    setError(null);
    setNotConfigured(false);
    onVerdict?.(null);
  }

  function updateRow(key: number, patch: Partial<BatchRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      {hideHeader ? null : (
        <EntityPageHeader title={d.title} description={d.description} />
      )}

      {showSetupNudge ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-medium text-amber-900">
            {t.ai.analyze.setupNudge.title}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {t.ai.analyze.setupNudge.description}
          </p>
          <Link
            href="/admin/ai-settings"
            className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
          >
            {t.ai.analyze.setupNudge.goSettings}
          </Link>
        </div>
      ) : null}

      {notConfigured ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-medium text-amber-900">
            {t.ai.analyze.contactAdmin.title}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {t.ai.analyze.contactAdmin.description}
          </p>
          {isAdmin ? (
            <Link
              href="/admin/ai-settings"
              className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
            >
              {t.ai.analyze.setupNudge.goSettings}
            </Link>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div
        className="mt-6 inline-flex rounded-lg bg-ink/5 p-1"
        role="group"
        aria-label="mode"
      >
        {(["single", "batch"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              reset();
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === m
                ? "bg-white text-ink shadow-sm"
                : "text-ink/60 hover:text-ink"
            }`}
          >
            {m === "single" ? d.modeSingle : d.modeBatch}
          </button>
        ))}
      </div>

      {mode === "single" ? (
        singleResult ? (
          <div>
            <button
              type="button"
              onClick={reset}
              className="mb-4 mt-6 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
            >
              {t.ai.analyze.report.reanalyze}
            </button>
            <TermsReport result={singleResult} />
          </div>
        ) : (
          <form
            onSubmit={onSingleSubmit}
            className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6"
          >
            <label className={labelClass} htmlFor="terms-text">
              {d.textLabel}
            </label>
            <CapturePicker
              onPick={async (c) => {
                const r = await getOfferCaptureAction(c.id);
                if (r.ok && r.data.text) setText(r.data.text);
              }}
            />
            <textarea
              id="terms-text"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={d.textPlaceholder}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={working}
              className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            >
              {working ? d.analyzing : d.submit}
            </button>
          </form>
        )
      ) : batchResults ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={reset}
            className="mb-4 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {t.ai.analyze.report.reanalyze}
          </button>
          <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">{d.verdictLabel}</th>
                  <th className="px-3 py-2">{d.batch.nameLabel}</th>
                  <th className="px-3 py-2">{d.batch.keyRisks}</th>
                  <th className="px-3 py-2">{d.summary}</th>
                </tr>
              </thead>
              <tbody>
                {batchResults.map((r, i) => (
                  <ScreenRow key={i} {...r} />
                ))}
                {batchResults.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-ink/50" colSpan={4}>
                      {d.batch.empty}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form
          onSubmit={onBatchSubmit}
          className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6"
        >
          <div className="space-y-4">
            {rows.map((r, idx) => (
              <div
                key={r.key}
                className="rounded-lg border border-ink/10 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <label className={labelClass} htmlFor={`batch-name-${r.key}`}>
                    {d.batch.nameLabel} #{idx + 1}
                  </label>
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRows((rs) => rs.filter((x) => x.key !== r.key))
                      }
                      className="text-xs font-medium text-red-700 hover:underline"
                    >
                      {d.batch.remove}
                    </button>
                  ) : null}
                </div>
                <input
                  id={`batch-name-${r.key}`}
                  value={r.name}
                  onChange={(e) => updateRow(r.key, { name: e.target.value })}
                  placeholder={d.batch.namePlaceholder}
                  className={inputClass}
                />
                <textarea
                  rows={5}
                  value={r.text}
                  onChange={(e) => updateRow(r.key, { text: e.target.value })}
                  placeholder={d.textPlaceholder}
                  className={`${inputClass} mt-2`}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={rows.length >= 10}
              onClick={() => {
                setRows((rs) => [...rs, { key: nextKey, name: "", text: "" }]);
                setNextKey((k) => k + 1);
              }}
              className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
            >
              {d.batch.add}
            </button>
            <button
              type="submit"
              disabled={working}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            >
              {working ? d.batch.screening : d.batch.submit}
            </button>
          </div>
          {rows.length >= 10 ? (
            <p className="mt-2 text-xs text-ink/50">{d.batch.maxReached}</p>
          ) : null}
        </form>
      )}
    </div>
  );
}
