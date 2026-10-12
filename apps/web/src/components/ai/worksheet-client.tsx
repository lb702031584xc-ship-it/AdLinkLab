"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { calcProfit } from "@/lib/profit-calc";
import { TermsClient } from "./terms-client";
import { ComplianceClient } from "./compliance-client";
import { TrafficPlannerClient } from "./traffic-planner-client";
import type { AiUrlCheckResult, TrafficPlanResult } from "@/lib/api/ai";

export type WorksheetSource = "affiliate" | "amazon" | "cashback";
export type StepStatus = "pass" | "warn" | "fail" | null;

export interface WorksheetOffer {
  id: string;
  name: string;
  network: string;
  destinationUrl: string;
}

function statusBadge(s: StepStatus): string {
  if (s === "pass") return "bg-green-100 text-green-800";
  if (s === "warn") return "bg-amber-100 text-amber-800";
  if (s === "fail") return "bg-red-100 text-red-800";
  return "bg-ink/10 text-ink/50";
}

function fmt(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/* ---------------- Step ③: compact profitability calculator ---------------- */
/* Uses the shared @/lib/profit-calc — no duplicated formulas. */

export interface ProfitStepState {
  status: StepStatus;
  summary: string;
}

function ProfitStep({ onChange }: { onChange: (s: ProfitStepState | null) => void }) {
  const t = useDict();
  const d = t.ai.profit;
  const w = t.ai.worksheet.profitStep;

  const [payout, setPayout] = useState("");
  const [cpc, setCpc] = useState("");
  const [cvrPct, setCvrPct] = useState("");
  const [refundPct, setRefundPct] = useState("");
  const [shavePct, setShavePct] = useState("");

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  const result = useMemo(() => {
    const p = parseFloat(payout);
    const c = parseFloat(cpc);
    const cvr = parseFloat(cvrPct);
    if (!(p > 0) || !(c > 0) || !(cvr > 0) || cvr >= 100) return null;
    const pct = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 0;
    };
    return calcProfit({
      payout: p,
      cpc: c,
      cvrF: cvr / 100,
      refundF: pct(refundPct),
      shaveF: pct(shavePct),
    });
  }, [payout, cpc, cvrPct, refundPct, shavePct]);

  useEffect(() => {
    if (!result) {
      onChange(null);
      return;
    }
    const p = result.perClickProfit;
    const status: StepStatus =
      p > 1e-9 ? "pass" : p < -1e-9 ? "fail" : "warn";
    onChange({
      status,
      summary: `EPC ${fmt(result.epc)} · ${d.results.breakEvenCvr} ${result.breakEvenCvrPct !== null ? `${fmt(result.breakEvenCvrPct)}%` : "—"} · ${w.perClickProfit} ${p > 0 ? "+" : ""}${fmt(p)}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="ws-payout">{d.payoutLabel}</label>
          <input id="ws-payout" inputMode="decimal" value={payout}
            onChange={(e) => setPayout(e.target.value)} placeholder="12.50" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-cpc">{d.cpcLabel}</label>
          <input id="ws-cpc" inputMode="decimal" value={cpc}
            onChange={(e) => setCpc(e.target.value)} placeholder="0.80" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-cvr">{w.cvrLabel}</label>
          <input id="ws-cvr" inputMode="decimal" value={cvrPct}
            onChange={(e) => setCvrPct(e.target.value)} placeholder="2" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-refund">{d.refundRateLabel}</label>
          <input id="ws-refund" inputMode="decimal" value={refundPct}
            onChange={(e) => setRefundPct(e.target.value)} placeholder="5" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-shave">{d.shaveLabel}</label>
          <input id="ws-shave" inputMode="decimal" value={shavePct}
            onChange={(e) => setShavePct(e.target.value)} placeholder="10" className={inputClass} />
        </div>
      </div>

      {result ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(
            [
              ["EPC", `EPC = payout × CVR`, fmt(result.epc)],
              [d.results.breakEvenCvr, d.formulas.breakEvenCvr, result.breakEvenCvrPct !== null ? `${fmt(result.breakEvenCvrPct)}%` : "—"],
              [d.results.maxCpc30, d.formulas.maxCpc30, result.maxCpc30 !== null ? fmt(result.maxCpc30, 4) : "—"],
              [w.perClickProfit, w.perClickProfitFormula, `${result.perClickProfit > 0 ? "+" : ""}${fmt(result.perClickProfit)}`],
            ] as const
          ).map(([label, formula, value]) => (
            <div key={label} className="rounded-xl border border-ink/10 bg-white px-5 py-4">
              <p className="text-sm font-medium text-ink">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
              <p className="mt-1 font-mono text-xs text-ink/45">{formula}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink/55">{w.needInput}</p>
      )}
    </div>
  );
}

/* ---------------- Step card shell ---------------- */

function StepCard({
  n,
  title,
  hint,
  status,
  statusLabel,
  open,
  onToggle,
  extraBadge,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  status: StepStatus;
  statusLabel: string;
  open: boolean;
  onToggle: () => void;
  extraBadge?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-ink/10 bg-white/70">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-ink/[0.03]"
        aria-expanded={open}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            status === "pass"
              ? "bg-green-600 text-white"
              : status === "fail"
                ? "bg-red-600 text-white"
                : status === "warn"
                  ? "bg-amber-500 text-white"
                  : "bg-ink/10 text-ink/60"
          }`}
        >
          {status === "pass" ? "✓" : status === "fail" ? "✕" : status === "warn" ? "!" : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{title}</span>
          <span className="block truncate text-xs text-ink/55">{hint}</span>
        </span>
        {extraBadge ? (
          <span className="hidden rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60 sm:inline">
            {extraBadge}
          </span>
        ) : null}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge(status)}`}>
          {statusLabel}
        </span>
        <span className="text-ink/40">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="border-t border-ink/10 px-5 py-5">{children}</div> : null}
    </section>
  );
}

/* ---------------- Worksheet ---------------- */

export function WorksheetClient({
  isAdmin,
  showSetupNudge,
  initialOwnedDomains,
  initialOffer,
  initialSource,
}: {
  isAdmin: boolean;
  showSetupNudge: boolean;
  initialOwnedDomains: string[];
  initialOffer: WorksheetOffer | null;
  initialSource: WorksheetSource;
}) {
  const t = useDict();
  const w = t.ai.worksheet;

  const [source, setSource] = useState<WorksheetSource>(initialSource);
  const [openStep, setOpenStep] = useState<number>(1);

  const [termsVerdict, setTermsVerdict] = useState<"go" | "caution" | "stop" | null>(null);
  const [complianceResults, setComplianceResults] = useState<AiUrlCheckResult[] | null>(null);
  const [complianceCounted, setComplianceCounted] = useState(true);
  const [profitState, setProfitState] = useState<ProfitStepState | null>(null);
  const [trafficResult, setTrafficResult] = useState<TrafficPlanResult | null>(null);

  const termsStatus: StepStatus =
    termsVerdict === "go" ? "pass" : termsVerdict === "caution" ? "warn" : termsVerdict === "stop" ? "fail" : null;

  const complianceStatus: StepStatus = !complianceResults
    ? null
    : complianceResults.some((r) => r.verdict === "affiliate_direct")
      ? "fail"
      : complianceResults.some((r) => r.verdict === "suspicious")
        ? "warn"
        : "pass";

  const profitStatus: StepStatus = profitState?.status ?? null;
  const trafficDone = trafficResult !== null;

  const statusText = (s: StepStatus) =>
    s === "pass" ? w.status.pass : s === "warn" ? w.status.warn : s === "fail" ? w.status.fail : w.status.pending;

  /* Final verdict: gates are terms / compliance (if counted) / profit.
     Traffic planning is informational — done counts as pass, never blocks. */
  const gateStatuses: StepStatus[] = [
    termsStatus,
    complianceCounted ? complianceStatus : null,
    profitStatus,
  ];
  const allDone =
    termsStatus !== null &&
    profitStatus !== null &&
    trafficDone &&
    (complianceStatus !== null || !complianceCounted);
  const anyFail = gateStatuses.some((s) => s === "fail");
  const anyWarn = gateStatuses.some((s) => s === "warn");
  const verdict: "incomplete" | "go" | "goWithWarn" | "noGo" =
    !allDone ? "incomplete" : anyFail ? "noGo" : anyWarn ? "goWithWarn" : "go";

  const termsReason =
    termsVerdict === "go"
      ? `${w.steps.terms} — ${w.status.pass}`
      : termsVerdict === "caution"
        ? `${w.steps.terms} — ${w.status.warn}`
        : termsVerdict === "stop"
          ? `${w.steps.terms} — ${w.status.fail}`
          : `${w.steps.terms} — ${w.status.pending}`;

  const complianceReason = !complianceResults
    ? `${w.steps.compliance} — ${w.status.pending}`
    : !complianceCounted
      ? `${w.steps.compliance} — ${w.complianceExcluded}`
      : (() => {
          const direct = complianceResults.filter((r) => r.verdict === "affiliate_direct").length;
          const susp = complianceResults.filter((r) => r.verdict === "suspicious").length;
          return `${w.steps.compliance} — ${statusText(complianceStatus)} (${complianceResults.length} URL, ${direct} 直链 / ${susp} 可疑)`;
        })();

  const profitReason = profitState
    ? `${w.steps.profit} — ${statusText(profitStatus)} (${profitState.summary})`
    : `${w.steps.profit} — ${w.status.pending}`;

  const trafficReason = trafficDone
    ? `${w.steps.traffic} — ${trafficResult.math.epcVerdict ?? w.verdict.trafficDone}`
    : `${w.steps.traffic} — ${w.status.pending}`;

  const verdictStyle =
    verdict === "go"
      ? "border-green-300 bg-green-50"
      : verdict === "goWithWarn"
        ? "border-amber-300 bg-amber-50"
        : verdict === "noGo"
          ? "border-red-300 bg-red-50"
          : "border-ink/10 bg-white/70";
  const verdictTitle =
    verdict === "go"
      ? w.verdict.go
      : verdict === "goWithWarn"
        ? w.verdict.goWithWarn
        : verdict === "noGo"
          ? w.verdict.noGo
          : w.verdict.incomplete;

  const toggleStep = (n: number) => setOpenStep((o) => (o === n ? 0 : n));

  return (
    <div className="space-y-5">
      <EntityPageHeader title={w.title} description={w.description} />

      {showSetupNudge ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-medium text-amber-900">{t.ai.analyze.setupNudge.title}</p>
          <p className="mt-1 text-sm text-amber-800">{t.ai.analyze.setupNudge.description}</p>
          <Link
            href="/admin/ai-settings"
            className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
          >
            {t.ai.analyze.setupNudge.goSettings}
          </Link>
        </div>
      ) : null}

      {/* Offer header */}
      <div className="rounded-xl border border-ink/10 bg-white/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-ink/55">{w.offerTitle}</p>
            {initialOffer ? (
              <>
                <p className="mt-1 truncate text-lg font-semibold text-ink">{initialOffer.name}</p>
                <p className="mt-0.5 text-sm text-ink/60">
                  {initialOffer.network}
                  {initialOffer.destinationUrl ? (
                    <>
                      {" · "}
                      <span className="break-all font-mono text-xs">{initialOffer.destinationUrl}</span>
                    </>
                  ) : null}
                </p>
                <Link
                  href={`/offers/${initialOffer.id}`}
                  className="mt-1 inline-block text-xs text-signal underline-offset-2 hover:underline"
                >
                  {w.openOffer}
                </Link>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink/60">{w.noOffer}</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs text-ink/55">{w.sourceLabel}</p>
            <div className="inline-flex rounded-lg bg-ink/5 p-1" role="group" aria-label={w.sourceLabel}>
              {(["affiliate", "amazon", "cashback"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    source === s ? "bg-white text-ink shadow-sm" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  {w.sources[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stepper */}
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          [
            { n: 1, title: w.steps.terms, status: termsStatus },
            { n: 2, title: w.steps.compliance, status: complianceStatus },
            { n: 3, title: w.steps.profit, status: profitStatus },
            { n: 4, title: w.steps.traffic, status: trafficDone ? ("pass" as StepStatus) : null },
          ]
        ).map((s) => (
          <li key={s.n}>
            <button
              type="button"
              onClick={() => toggleStep(s.n)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                openStep === s.n ? "border-signal bg-signal/5" : "border-ink/10 bg-white/70 hover:border-ink/25"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s.status === "pass"
                    ? "bg-green-600 text-white"
                    : s.status === "fail"
                      ? "bg-red-600 text-white"
                      : s.status === "warn"
                        ? "bg-amber-500 text-white"
                        : "bg-ink/10 text-ink/60"
                }`}
              >
                {s.status === "pass" ? "✓" : s.n}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{s.title}</span>
                <span className={`text-xs ${s.status ? "font-medium" : "text-ink/45"}`}>
                  <span className={`rounded-full px-1.5 py-0.5 ${statusBadge(s.status)}`}>
                    {statusText(s.status)}
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/* Step ① terms */}
      <StepCard
        n={1}
        title={`① ${w.steps.terms}`}
        hint={w.stepHint.terms}
        status={termsStatus}
        statusLabel={statusText(termsStatus)}
        open={openStep === 1}
        onToggle={() => toggleStep(1)}
      >
        {source === "cashback" ? (
          <p className="mb-4 rounded-lg border border-signal/25 bg-signal/5 px-3 py-2 text-sm text-ink/75">
            {w.cashbackTermsHint}
          </p>
        ) : null}
        <TermsClient isAdmin={isAdmin} showSetupNudge={false} hideHeader onVerdict={setTermsVerdict} />
      </StepCard>

      {/* Step ② compliance */}
      <StepCard
        n={2}
        title={`② ${w.steps.compliance}`}
        hint={w.stepHint.compliance}
        status={complianceStatus}
        statusLabel={statusText(complianceStatus)}
        open={openStep === 2}
        onToggle={() => toggleStep(2)}
        extraBadge={complianceCounted ? null : w.complianceExcluded}
      >
        <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink/10 bg-white px-3 py-2.5">
          <input
            type="checkbox"
            checked={complianceCounted}
            onChange={(e) => setComplianceCounted(e.target.checked)}
            className="mt-1 h-4 w-4 accent-ink"
          />
          <span>
            <span className="block text-sm font-medium text-ink">{w.complianceToggle}</span>
            <span className="block text-xs text-ink/55">{w.complianceToggleHint}</span>
          </span>
        </label>
        <ComplianceClient
          isAdmin={isAdmin}
          initialOwnedDomains={initialOwnedDomains}
          hideHeader
          onResult={setComplianceResults}
        />
      </StepCard>

      {/* Step ③ profit */}
      <StepCard
        n={3}
        title={`③ ${w.steps.profit}`}
        hint={w.stepHint.profit}
        status={profitStatus}
        statusLabel={statusText(profitStatus)}
        open={openStep === 3}
        onToggle={() => toggleStep(3)}
      >
        <ProfitStep onChange={setProfitState} />
      </StepCard>

      {/* Step ④ traffic */}
      <StepCard
        n={4}
        title={`④ ${w.steps.traffic}`}
        hint={w.stepHint.traffic}
        status={trafficDone ? "pass" : null}
        statusLabel={trafficDone ? w.status.pass : w.status.pending}
        open={openStep === 4}
        onToggle={() => toggleStep(4)}
      >
        <TrafficPlannerClient showSetupNudge={false} hideHeader onResult={setTrafficResult} />
      </StepCard>

      {/* Final verdict */}
      <section className={`rounded-xl border p-5 ${verdictStyle}`}>
        <h2 className="text-base font-semibold text-ink">{w.verdict.title}</h2>
        <p
          className={`mt-1 text-xl font-bold ${
            verdict === "go"
              ? "text-green-700"
              : verdict === "goWithWarn"
                ? "text-amber-700"
                : verdict === "noGo"
                  ? "text-red-700"
                  : "text-ink/60"
          }`}
        >
          {verdictTitle}
        </p>
        <h3 className="mt-4 text-sm font-semibold text-ink">{w.verdict.reasons}</h3>
        <ul className="mt-2 space-y-1.5">
          {[termsReason, complianceReason, profitReason, trafficReason].map((r, i) => (
            <li key={i} className="text-sm text-ink/75">
              {r}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
