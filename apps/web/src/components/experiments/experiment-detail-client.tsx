"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  cancelExperimentAction,
  completeExperimentAction,
  getExperimentAction,
  graduateExperimentAction,
  startExperimentAction,
  submitMetricsAction,
} from "@/lib/api/experiments-actions";
import type {
  Experiment,
  ExperimentMetrics,
} from "@/lib/api/experiments";
import type { ExperimentDict } from "@/i18n/dict/experiment";
import {
  MetricsCompareTable,
  PreconditionList,
  StatusBadge,
  VariantCard,
  WinnerPanel,
} from "./experiment-views";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";
const buttonClass =
  "rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50";
const primaryClass =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50";
const dangerClass =
  "rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

const METRIC_FIELDS = [
  "clicks",
  "ctr",
  "cpc",
  "lpViews",
  "affiliateClicks",
  "cvr",
  "cpa",
  "revenue",
  "profit",
  "approvalRate",
  "refundRate",
] as const;

/** Experiment detail: config, precondition evidence, metrics compare, actions. */
export function ExperimentDetailClient({
  experimentId,
  dict,
}: {
  experimentId: string;
  dict: ExperimentDict;
}) {
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [metricsVariant, setMetricsVariant] = useState<"A" | "B">("A");
  const [metricValues, setMetricValues] = useState<Record<string, string>>({});
  /** P1-12：毕业提示（pause_loser 的 Script 指引）。 */
  const [graduateMsg, setGraduateMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await getExperimentAction(experimentId);
    if (res.ok) setExperiment(res.data);
    else setError(res.error);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [experimentId]);

  async function run<T>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    map: (d: T) => Experiment
  ) {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    if (res.ok) setExperiment(map(res.data));
    else setActionError(res.error);
    setBusy(false);
  }

  function parsedMetrics(): ExperimentMetrics {
    const out: ExperimentMetrics = {};
    for (const f of METRIC_FIELDS) {
      const raw = (metricValues[f] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) out[f] = n;
    }
    return out;
  }

  if (loading) return <p className="py-10 text-center text-sm text-ink/60">…</p>;
  if (error || !experiment) {
    return (
      <div className="space-y-4">
        <Link href="/experiments" className="text-sm text-ink/70 hover:underline">
          ← {dict.detail.back}
        </Link>
        <p className="text-sm text-red-700">{error ?? dict.detail.loadFailed}</p>
      </div>
    );
  }

  const e = experiment;
  const canStart = e.status === "DRAFT";
  const canRecord = e.status === "RUNNING";
  const canComplete = e.status === "RUNNING";
  const canCancel = e.status === "DRAFT" || e.status === "RUNNING";
  /** P1-12：毕业（COMPLETED + 已分胜负；pause_loser 只返回 Script 指引）。 */
  const canGraduate =
    e.status === "COMPLETED" && (e.winner === "A" || e.winner === "B");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/experiments" className="text-sm text-ink/70 hover:underline">
          ← {dict.detail.back}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{e.name}</h1>
          <StatusBadge status={e.status} dict={dict} />
        </div>
        <p className="mt-1 font-mono text-xs text-ink/50">offer: {e.offerId}</p>
      </div>

      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {graduateMsg && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-4 py-2 text-sm text-ink/80">
          {graduateMsg}
        </p>
      )}

      <WinnerPanel experiment={e} dict={dict} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">{dict.detail.config}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <VariantCard
            side="A"
            variant={e.variantA}
            trafficShare={e.trafficSplitA}
            dict={dict}
          />
          <VariantCard
            side="B"
            variant={e.variantB}
            trafficShare={100 - e.trafficSplitA}
            dict={dict}
          />
        </div>
        <p className="mt-2 text-xs text-ink/60">
          {dict.detail.split}: A {e.trafficSplitA}% / B {100 - e.trafficSplitA}%
          {e.splitSeed && (
            <>
              {" · "}
              {dict.detail.splitSeed}:{" "}
              <span className="font-mono">{e.splitSeed}</span>
            </>
          )}
        </p>
        {/* P1-12：AD_GROUP 创意差异度 + 滥用边界说明。 */}
        {e.creativeDifference != null ? (
          <p className="mt-2 text-sm text-ink/70">
            {dict.detail.creativeDifference}：{(e.creativeDifference * 100).toFixed(1)}%
            {e.creativeDifferenceWarning ? ` — ⚠️ ${e.creativeDifferenceWarning}` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-ink/50">{dict.detail.abuseNote}</p>
      </section>

      <PreconditionList experiment={e} dict={dict} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">{dict.detail.metrics}</h2>
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <MetricsCompareTable experiment={e} dict={dict} />
        </div>
      </section>

      {canRecord && (
        <section className="rounded-lg border border-ink/15 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            {dict.detail.recordMetrics}
          </h2>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm text-ink/60">{dict.detail.variant}</span>
            {(["A", "B"] as const).map((v) => (
              <button
                key={v}
                className={`${buttonClass} ${metricsVariant === v ? "bg-ink/10 font-semibold" : ""}`}
                onClick={() => setMetricsVariant(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {METRIC_FIELDS.map((f) => (
              <label key={f} className="text-xs text-ink/60">
                {dict.detail.field[f]}
                <input
                  className={`${inputClass} font-mono`}
                  type="number"
                  step="any"
                  value={metricValues[f] ?? ""}
                  onChange={(ev) =>
                    setMetricValues((prev) => ({
                      ...prev,
                      [f]: ev.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            className={`${primaryClass} mt-3`}
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  submitMetricsAction(
                    e.id,
                    metricsVariant,
                    parsedMetrics()
                  ),
                (d) => d
              )
            }
          >
            {busy ? "…" : dict.detail.recordMetrics}
          </button>
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        {canStart && (
          <button
            className={primaryClass}
            disabled={busy}
            onClick={() => run(() => startExperimentAction(e.id), (d) => d)}
          >
            {busy ? dict.detail.starting : dict.detail.start}
          </button>
        )}
        {canComplete && (
          <button
            className={primaryClass}
            disabled={busy}
            onClick={() => run(() => completeExperimentAction(e.id), (d) => d)}
          >
            {busy ? dict.detail.completing : dict.detail.complete}
          </button>
        )}
        {canGraduate && (
          <button
            className={primaryClass}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setActionError(null);
              const res = await graduateExperimentAction(e.id);
              setBusy(false);
              if (res.ok) {
                const g = res.data.graduation as { scriptInstructions?: string } | undefined;
                setGraduateMsg(g?.scriptInstructions ?? dict.detail.graduated);
                void load();
              } else {
                setActionError(res.error);
              }
            }}
          >
            {busy ? dict.detail.graduating : dict.detail.graduate}
          </button>
        )}
        {canCancel && (
          <button
            className={dangerClass}
            disabled={busy}
            onClick={() => {
              if (!window.confirm(dict.detail.cancelConfirm)) return;
              run(() => cancelExperimentAction(e.id), (d) => d);
            }}
          >
            {busy ? dict.detail.cancelling : dict.detail.cancel}
          </button>
        )}
      </section>
    </div>
  );
}
