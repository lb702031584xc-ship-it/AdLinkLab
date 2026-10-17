"use client";

import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import { DataQualityBadge } from "@/components/data-quality-badge";
import type { AiAnalysis } from "@/lib/api/ai";

function riskBadgeClasses(level: "low" | "medium" | "high"): string {
  if (level === "low") return "bg-green-100 text-green-800";
  if (level === "medium") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function riskBarClasses(level: "low" | "medium" | "high"): string {
  if (level === "low") return "bg-green-500";
  if (level === "medium") return "bg-amber-500";
  return "bg-red-500";
}

function severityDot(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "bg-red-500";
  if (severity === "medium") return "bg-amber-500";
  return "bg-green-500";
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink/70">{label}</span>
        <span className="font-mono text-ink">{v}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-signal"
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

/** Shared renderer for a full AI analysis report (analyze page + detail page). */
export function AnalysisReport({ analysis }: { analysis: AiAnalysis }) {
  const t = useDict();
  const r = analysis.analysis;
  const p = analysis.profitability;

  const severityOrder: Array<"high" | "medium" | "low"> = [
    "high",
    "medium",
    "low",
  ];
  const grouped = severityOrder
    .map((sev) => ({
      sev,
      items: r.findings.filter((f) => f.severity === sev),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold text-ink">
            {t.ai.analyze.report.title}
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${riskBadgeClasses(r.riskLevel)}`}
          >
            {t.ai.analyze.report.riskLevels[r.riskLevel]}
          </span>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink/70">{t.ai.analyze.report.overallRisk}</span>
            <span className="font-mono text-lg font-semibold text-ink">
              {Math.round(r.overallRisk)}
              <span className="text-sm text-ink/50">/100</span>
            </span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-ink/10">
            <div
              className={`h-full rounded-full ${riskBarClasses(r.riskLevel)}`}
              style={{
                width: `${Math.max(0, Math.min(100, Math.round(r.overallRisk)))}%`,
              }}
            />
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <ScoreBar
            label={t.ai.analyze.report.scores.merchant}
            value={r.scores.merchant}
          />
          <ScoreBar
            label={t.ai.analyze.report.scores.policy}
            value={r.scores.policy}
          />
          <ScoreBar
            label={t.ai.analyze.report.scores.network}
            value={r.scores.network}
          />
        </div>
        <p className="mt-4 text-xs text-ink/50">
          {t.ai.analyze.report.analyzedAt(formatDateTime(analysis.analyzedAt))}
        </p>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
        <h3 className="text-lg font-semibold text-ink">
          {t.ai.analyze.report.findings}
        </h3>
        {grouped.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">
            {t.ai.analyze.report.noFindings}
          </p>
        ) : (
          <div className="mt-3 space-y-5">
            {grouped.map((g) => (
              <div key={g.sev}>
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${severityDot(g.sev)}`}
                  />
                  {t.ai.analyze.severity[g.sev]}
                </p>
                <ul className="mt-2 space-y-3">
                  {g.items.map((f, i) => (
                    <li
                      key={`${g.sev}-${i}`}
                      className="rounded-lg bg-ink/[0.03] p-3"
                    >
                      <p className="text-sm font-medium text-ink">{f.title}</p>
                      <p className="mt-1 text-sm text-ink/65">{f.detail}</p>
                      {f.area ? (
                        <p className="mt-1 text-xs text-ink/45">{f.area}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
        <h3 className="text-lg font-semibold text-ink">
          {t.ai.analyze.report.suggestions}
        </h3>
        {r.suggestions.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">
            {t.ai.analyze.report.noSuggestions}
          </p>
        ) : (
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink/80">
            {r.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
        <h3 className="text-lg font-semibold text-ink">
          {t.ai.analyze.report.profitability}
        </h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-ink/[0.03] p-3">
            <dt className="text-xs text-ink/55">
              {t.ai.analyze.report.payout}
            </dt>
            <dd className="mt-1 font-mono text-ink">
              {p.payout !== null && p.payoutCurrency
                ? `${p.payoutCurrency} ${p.payout}`
                : t.ai.analyze.report.missingData}
            </dd>
          </div>
          <div className="rounded-lg bg-ink/[0.03] p-3">
            <dt className="text-xs text-ink/55">
              {t.ai.analyze.report.estCpc}
            </dt>
            <dd className="mt-1 font-mono text-ink">
              {p.estimatedCpc !== null
                ? `${p.payoutCurrency ?? ""} ${p.estimatedCpc}`.trim()
                : t.ai.analyze.report.missingData}
            </dd>
          </div>
          <div className="rounded-lg bg-ink/[0.03] p-3">
            <dt className="text-xs text-ink/55">
              {t.ai.analyze.report.breakEvenCvr}
            </dt>
            <dd className="mt-1 font-mono text-ink">
              {p.breakEvenCvrPct !== null
                ? `${p.breakEvenCvrPct}%`
                : t.ai.analyze.report.missingData}
            </dd>
          </div>
        </dl>
      </section>

      {r.keywords.length > 0 ? (
        <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
          <h3 className="text-lg font-semibold text-ink">
            {t.ai.analyze.report.keywords}{" "}
            <DataQualityBadge quality="PREDICTED" />
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {r.keywords.map((k, i) => (
              <span
                key={i}
                className="rounded-full bg-signal/10 px-3 py-1 text-sm text-signal"
              >
                {k}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {r.adAngles.length > 0 ? (
        <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
          <h3 className="text-lg font-semibold text-ink">
            {t.ai.analyze.report.adAngles}
          </h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink/80">
            {r.adAngles.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* P1-9：评估扩展维度（可选；模型无依据时省略，不渲染编造的维度）。 */}
      {r.dimensions && Object.keys(r.dimensions).length > 0 ? (
        <section className="rounded-xl border border-ink/10 bg-white/70 p-6">
          <h3 className="text-lg font-semibold text-ink">
            {t.ai.analyze.report.dimensions}
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              Object.keys(r.dimensions) as Array<keyof NonNullable<typeof r.dimensions>>
            ).map((k) => {
              const dim = r.dimensions![k];
              if (!dim) return null;
              return (
                <div key={k} className="rounded-lg bg-ink/[0.03] p-3">
                  <dt className="text-xs text-ink/55">
                    {t.ai.analyze.report.dimensionLabels[k]} · {dim.score}/100
                  </dt>
                  <dd className="mt-1 text-sm text-ink/80">{dim.note}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
