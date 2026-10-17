"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { calcProfit } from "@/lib/profit-calc";
import { getLastOfferId, setLastOfferId } from "@/lib/current-offer";
import {
  listWorkStateHistoryAction,
  loadWorkStateAction,
  saveWorkStateAction,
  type WorkStateHistoryItem,
} from "@/lib/api/work-state-actions";
import { TermsClient } from "./terms-client";
import { ComplianceClient } from "./compliance-client";
import { TrafficPlannerClient, type PlannerOffer } from "./traffic-planner-client";
import { OfferPipelineNav } from "./offer-pipeline-nav";
import { BrandBiddingClient } from "./brand-bidding-client";
import type { AiUrlCheckResult, TrafficPlanResult } from "@/lib/api/ai";

export type WorksheetSource = "affiliate" | "amazon" | "cashback";
export type StepStatus = "pass" | "warn" | "fail" | null;

export interface WorksheetOffer {
  id: string;
  name: string;
  network: string;
  destinationUrl: string;
  commissionValue?: string | number | null;
  commissionType?: string | null;
  avgPrice?: string | number | null;
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

export type ProfitMode = "ecommerce" | "other";

export interface ProfitStepState {
  status: StepStatus;
  summary: string;
  /** ③ 的输入（用于快照恢复 + 往 ④ 投流模块同步 payout/CVR/退款率）。 */
  inputs?: {
    /** 电商：payout = 均价 × 佣金率（算出后存这里，供 ④ 同步）；其他：手填固定 payout。 */
    payout: string;
    cpc: string;
    cvrPct: string;
    /** 电商 = 退货率；其他 = 不用（扣量代替）。 */
    refundPct: string;
    /** 其他 = 扣量假设；电商 = 不用（退货代替）。 */
    shavePct: string;
    mode: ProfitMode;
    avgPrice: string;
    commissionRate: string;
    targetRoiPct: string;
  };
}

function ProfitStep({
  onChange,
  initialPayout,
  initialMode,
  initialAvgPrice,
  initialCommissionRate,
  initialValues,
  offerId,
}: {
  onChange: (s: ProfitStepState | null) => void;
  initialPayout?: string;
  /** 按 offer 自动判的模式（Amazon/按比例佣金 → 电商；固定佣金 → 其他）。 */
  initialMode?: ProfitMode;
  initialAvgPrice?: string;
  initialCommissionRate?: string;
  /** 快照恢复的输入（刷新后不丢手改值）。 */
  initialValues?: ProfitStepState["inputs"];
  /** 当前 offer：用于从投放选词快照取参考 CPC。 */
  offerId?: string | null;
}) {
  const t = useDict();
  const d = t.ai.profit;
  const w = t.ai.worksheet.profitStep;

  const [mode, setMode] = useState<ProfitMode>(initialValues?.mode ?? initialMode ?? "ecommerce");
  const [avgPrice, setAvgPrice] = useState(initialValues?.avgPrice ?? initialAvgPrice ?? "");
  const [commissionRate, setCommissionRate] = useState(
    initialValues?.commissionRate ?? initialCommissionRate ?? ""
  );
  const [targetRoiPct, setTargetRoiPct] = useState(initialValues?.targetRoiPct ?? "100");
  const [payout, setPayout] = useState(initialValues?.payout ?? initialPayout ?? "");
  const [cpc, setCpc] = useState(initialValues?.cpc ?? "");
  const [cvrPct, setCvrPct] = useState(initialValues?.cvrPct ?? "");
  const [refundPct, setRefundPct] = useState(initialValues?.refundPct ?? "");
  const [shavePct, setShavePct] = useState(initialValues?.shavePct ?? "");
  const [cpcFromKeywords, setCpcFromKeywords] = useState(false);
  /** 模式/期望 ROI 是否已由快照恢复过（晚到快照只应用一次，不覆盖手改）。 */
  const snapshotAppliedRef = useRef(false);

  /* 快照晚到时：只填空字段，不覆盖手改；模式/期望 ROI 只应用一次 */
  useEffect(() => {
    if (!initialValues) return;
    if (!snapshotAppliedRef.current) {
      snapshotAppliedRef.current = true;
      if (initialValues.mode) setMode(initialValues.mode);
      if (initialValues.targetRoiPct) setTargetRoiPct(initialValues.targetRoiPct);
    }
    if (!payout && initialValues.payout) setPayout(initialValues.payout);
    if (!cpc && initialValues.cpc) setCpc(initialValues.cpc);
    if (!cvrPct && initialValues.cvrPct) setCvrPct(initialValues.cvrPct);
    if (!refundPct && initialValues.refundPct) setRefundPct(initialValues.refundPct);
    if (!shavePct && initialValues.shavePct) setShavePct(initialValues.shavePct);
    if (!avgPrice && initialValues.avgPrice) setAvgPrice(initialValues.avgPrice);
    if (!commissionRate && initialValues.commissionRate)
      setCommissionRate(initialValues.commissionRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  /* CPC 联动：为空时从该 offer 的投放选词快照取参考 CPC 均值 */
  useEffect(() => {
    if (cpc || !offerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await loadWorkStateAction("keyword-launch", offerId);
        if (cancelled || !res.ok || !res.data.state) return;
        const rows = (res.data.state.rows ?? []) as Array<{ refCpc?: string }>;
        const nums = rows
          .map((r) => Number(r.refCpc))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length === 0) return;
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        setCpc(String(Math.round(avg * 100) / 100));
        setCpcFromKeywords(true);
      } catch {
        /* 取不到就不填 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);

  /* 转化率/退款率/payout 联动：为空时从该 offer 的投流决策（④）快照取——
     前面在 ④ 填过的不用在 ③ 重填。只填空字段，不覆盖手改（函数式 setState 防竞态）。 */
  useEffect(() => {
    if (!offerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await loadWorkStateAction("traffic-planner", offerId);
        if (cancelled || !res.ok || !res.data.state) return;
        const s = res.data.state as Record<string, unknown>;
        const str = (v: unknown) => (v == null ? "" : String(v).trim());
        const cvr = str(s.networkCvr);
        if (cvr) setCvrPct((prev) => (prev.trim() ? prev : cvr));
        const refund = str(s.refundRate);
        if (refund) setRefundPct((prev) => (prev.trim() ? prev : refund));
        // offer 佣金算不出 payout 时（按比例缺均价等），取 ④ 里手填过的 payout
        if (!initialPayout) {
          const p = str(s.payout);
          if (p) setPayout((prev) => (prev.trim() ? prev : p));
        }
      } catch {
        /* 取不到就不填 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  /* 电商：payout = 均价 × 佣金率（算不出时沿用上次/④填过的 payout，不丢旧数据）。 */
  const derivedPayout = useMemo(() => {
    if (mode !== "ecommerce") return payout;
    const ap = parseFloat(avgPrice);
    const rate = parseFloat(commissionRate);
    if (ap > 0 && rate > 0) {
      return String(Math.round(((ap * rate) / 100) * 100) / 100);
    }
    return payout;
  }, [mode, avgPrice, commissionRate, payout]);

  const result = useMemo(() => {
    const p = parseFloat(derivedPayout);
    const c = parseFloat(cpc);
    const cvr = parseFloat(cvrPct);
    if (!(p > 0) || !(c > 0) || !(cvr > 0) || cvr >= 100) return null;
    const pct = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 0;
    };
    const roi = parseFloat(targetRoiPct);
    return calcProfit({
      payout: p,
      cpc: c,
      cvrF: cvr / 100,
      // 电商扣退货、不扣量；其他扣量、不算退货
      refundF: mode === "ecommerce" ? pct(refundPct) : 0,
      shaveF: mode === "other" ? pct(shavePct) : 0,
      targetRoiF: Number.isFinite(roi) && roi >= 0 ? roi / 100 : 1,
    });
  }, [derivedPayout, cpc, cvrPct, refundPct, shavePct, mode, targetRoiPct]);

  /* 按期望 ROI 反推 CPC：不依赖已填 CPC，只用 payout/CVR/退货/扣量/目标 ROI。 */
  const reverseCpc = useMemo(() => {
    const p = parseFloat(derivedPayout);
    const cvr = parseFloat(cvrPct);
    if (!(p > 0) || !(cvr > 0) || cvr >= 100) return null;
    const pct = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 0;
    };
    const roi = parseFloat(targetRoiPct);
    const r = calcProfit({
      payout: p,
      cpc: 0,
      cvrF: cvr / 100,
      refundF: mode === "ecommerce" ? pct(refundPct) : 0,
      shaveF: mode === "other" ? pct(shavePct) : 0,
      targetRoiF: Number.isFinite(roi) && roi >= 0 ? roi / 100 : 1,
    });
    return r.maxCpcAtTargetRoi;
  }, [derivedPayout, cvrPct, refundPct, shavePct, mode, targetRoiPct]);

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
      inputs: {
        payout: derivedPayout,
        cpc,
        cvrPct,
        refundPct,
        shavePct,
        mode,
        avgPrice,
        commissionRate,
        targetRoiPct,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const derivedFromPrice =
    parseFloat(avgPrice) > 0 && parseFloat(commissionRate) > 0;

  return (
    <div>
      {/* 电商 / 其他：两套表单。电商按订单佣金 %、扣退货；其他固定 payout、扣量。 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink/80">{w.modeLabel}</span>
        <div className="flex overflow-hidden rounded-lg border border-ink/15">
          {(
            [
              ["ecommerce", w.modeEcommerce],
              ["other", w.modeOther],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                // 切到其他时把电商算出的 payout 带过去，别让框变空
                if (m === "other" && mode === "ecommerce" && derivedPayout) {
                  setPayout(derivedPayout);
                }
                setMode(m);
              }}
              className={`px-3 py-1.5 text-sm ${mode === m ? "bg-ink text-white" : "bg-white text-ink/70 hover:bg-ink/5"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink/45">
          {mode === "ecommerce" ? w.modeEcommerceHint : w.modeOtherHint}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mode === "ecommerce" ? (
          <>
            <div>
              <label className={labelClass} htmlFor="ws-avg-price">{w.avgPriceLabel}</label>
              <input id="ws-avg-price" inputMode="decimal" value={avgPrice}
                onChange={(e) => setAvgPrice(e.target.value)} placeholder="49.99" className={inputClass} />
              {initialAvgPrice && avgPrice === initialAvgPrice && (
                <p className="mt-1 text-xs text-ink/45">✨ {w.avgPriceFromOffer}</p>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="ws-commission-rate">{w.commissionRateLabel}</label>
              <input id="ws-commission-rate" inputMode="decimal" value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)} placeholder="10" className={inputClass} />
              {initialCommissionRate && commissionRate === initialCommissionRate && (
                <p className="mt-1 text-xs text-ink/45">✨ {w.commissionRateFromOffer}</p>
              )}
            </div>
            <div>
              <p className={labelClass}>{w.derivedPayoutLabel}</p>
              <p className="rounded-lg border border-ink/15 bg-ink/[0.03] px-3 py-2 text-sm text-ink">
                {derivedFromPrice
                  ? `${fmt(parseFloat(avgPrice))} × ${fmt(parseFloat(commissionRate))}% = ${fmt(parseFloat(derivedPayout))}`
                  : derivedPayout
                    ? `${w.derivedPayoutFallback} ${fmt(parseFloat(derivedPayout))}`
                    : "—"}
              </p>
            </div>
          </>
        ) : (
          <div>
            <label className={labelClass} htmlFor="ws-payout">{d.payoutLabel}</label>
            <input id="ws-payout" inputMode="decimal" value={payout}
              onChange={(e) => setPayout(e.target.value)} placeholder="12.50" className={inputClass} />
            {initialPayout && payout === initialPayout && (
              <p className="mt-1 text-xs text-ink/45">✨ {w.payoutFromOffer}</p>
            )}
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="ws-cpc">{d.cpcLabel}</label>
          <input id="ws-cpc" inputMode="decimal" value={cpc}
            onChange={(e) => { setCpc(e.target.value); setCpcFromKeywords(false); }} placeholder="0.80" className={inputClass} />
          {cpcFromKeywords && (
            <p className="mt-1 text-xs text-ink/45">✨ {w.cpcFromKeywords}</p>
          )}
          {reverseCpc != null && (
            <button type="button" className="mt-1 text-xs text-sky-700 underline underline-offset-2"
              onClick={() => { setCpc(reverseCpc.toFixed(4)); setCpcFromKeywords(false); }}>
              {w.deriveCpcFromRoi}：{fmt(reverseCpc, 4)}
            </button>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-cvr">{w.cvrLabel}</label>
          <input id="ws-cvr" inputMode="decimal" value={cvrPct}
            onChange={(e) => setCvrPct(e.target.value)} placeholder="2" className={inputClass} />
        </div>
        {mode === "ecommerce" ? (
          <div>
            <label className={labelClass} htmlFor="ws-refund">{w.returnRateLabel}</label>
            <input id="ws-refund" inputMode="decimal" value={refundPct}
              onChange={(e) => setRefundPct(e.target.value)} placeholder="5" className={inputClass} />
          </div>
        ) : (
          <div>
            <label className={labelClass} htmlFor="ws-shave">{d.shaveLabel}</label>
            <input id="ws-shave" inputMode="decimal" value={shavePct}
              onChange={(e) => setShavePct(e.target.value)} placeholder="10" className={inputClass} />
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="ws-target-roi">{w.targetRoiLabel}</label>
          <input id="ws-target-roi" inputMode="decimal" value={targetRoiPct}
            onChange={(e) => setTargetRoiPct(e.target.value)} placeholder="100" className={inputClass} />
        </div>
      </div>

      {result ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["EPC", `EPC = payout × CVR`, fmt(result.epc)],
              [w.breakEvenCpc, w.breakEvenCpcFormula, result.breakEvenCpc !== null ? fmt(result.breakEvenCpc, 4) : "—"],
              [w.maxCpcAtTargetRoi, w.maxCpcAtTargetRoiFormula, result.maxCpcAtTargetRoi !== null ? fmt(result.maxCpcAtTargetRoi, 4) : "—"],
              [w.perClickProfit, w.perClickProfitFormula, `${result.perClickProfit > 0 ? "+" : ""}${fmt(result.perClickProfit)}`],
              [d.results.breakEvenCvr, d.formulas.breakEvenCvr, result.breakEvenCvrPct !== null ? `${fmt(result.breakEvenCvrPct)}%` : "—"],
              [w.currentRoi, w.currentRoiFormula, result.roiAtCpc !== null ? `${result.roiAtCpc >= 0 ? "+" : ""}${fmt(result.roiAtCpc * 100)}%` : "—"],
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
        <p className="mt-4 text-sm text-ink/55">
          {mode === "ecommerce" ? w.needInputEcommerce : w.needInput}
        </p>
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
  offers,
}: {
  isAdmin: boolean;
  showSetupNudge: boolean;
  initialOwnedDomains: string[];
  initialOffer: WorksheetOffer | null;
  initialSource: WorksheetSource;
  offers: WorksheetOffer[];
}) {
  const t = useDict();
  const w = t.ai.worksheet;

  const [source, setSource] = useState<WorksheetSource>(initialSource);
  const [openStep, setOpenStep] = useState<number>(1);

  // 分析对象：可从 offer 库选择，或手动输入
  const [offer, setOffer] = useState<WorksheetOffer | null>(initialOffer);
  const [manualOpen, setManualOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mNetwork, setMNetwork] = useState("");
  const [mUrl, setMUrl] = useState("");

  const applyManualOffer = () => {
    const name = mName.trim();
    if (!name) return;
    setOffer({
      id: "",
      name,
      network: mNetwork.trim(),
      destinationUrl: mUrl.trim(),
    });
    setManualOpen(false);
  };

  const [termsVerdict, setTermsVerdict] = useState<"go" | "caution" | "stop" | null>(null);
  const [complianceResults, setComplianceResults] = useState<AiUrlCheckResult[] | null>(null);
  const [complianceCounted, setComplianceCounted] = useState(true);
  const [profitState, setProfitState] = useState<ProfitStepState | null>(null);
  // offer 盈利字段 → 盈利测算 payout 预填：固定佣金直接用；按比例则 平均价×比例
  const initialPayout = (() => {
    if (!offer) return undefined;
    const cv = Number(offer.commissionValue);
    if (!Number.isFinite(cv) || cv <= 0) return undefined;
    if (offer.commissionType === "fixed") return String(cv);
    const ap = Number(offer.avgPrice);
    if (offer.commissionType === "percentage" && Number.isFinite(ap) && ap > 0) {
      return String(Math.round(((ap * cv) / 100) * 100) / 100);
    }
    return undefined;
  })();
  /* ③ 模式自动判：按比例佣金 → 电商（均价 × 佣金率）；固定佣金 → 其他（固定 payout）。 */
  const initialProfitMode: ProfitMode =
    offer?.commissionType === "fixed" ? "other" : "ecommerce";
  const initialAvgPrice =
    offer?.avgPrice != null && Number(offer.avgPrice) > 0
      ? String(offer.avgPrice)
      : undefined;
  const initialCommissionRate =
    offer?.commissionType === "percentage" &&
    offer.commissionValue != null &&
    Number(offer.commissionValue) > 0
      ? String(offer.commissionValue)
      : undefined;
  const [trafficResult, setTrafficResult] = useState<TrafficPlanResult | null>(null);

  /* ----- 工作台自动保存：刷新/隔夜后可恢复（租户隔离，存 work_states 表） ----- */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<WorkStateHistoryItem[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const lastSavedRef = useRef("");

  const buildSnapshot = (): Record<string, unknown> => ({
    version: 1,
    source,
    openStep,
    offer,
    manual: { name: mName, network: mNetwork, url: mUrl },
    termsVerdict,
    complianceResults,
    complianceCounted,
    profitState,
    trafficResult,
  });

  const snapshotMeaningful = (s: Record<string, unknown>): boolean =>
    s.offer != null ||
    s.termsVerdict != null ||
    s.complianceResults != null ||
    s.profitState != null ||
    s.trafficResult != null;

  const applySnapshot = (s: Record<string, unknown>) => {
    if (s.source === "affiliate" || s.source === "amazon" || s.source === "cashback") {
      setSource(s.source);
    }
    if (typeof s.openStep === "number") setOpenStep(s.openStep);
    if (s.offer && typeof s.offer === "object") setOffer(s.offer as WorksheetOffer);
    const m = s.manual as { name?: string; network?: string; url?: string } | undefined;
    if (m) {
      if (typeof m.name === "string") setMName(m.name);
      if (typeof m.network === "string") setMNetwork(m.network);
      if (typeof m.url === "string") setMUrl(m.url);
    }
    if (s.termsVerdict === "go" || s.termsVerdict === "caution" || s.termsVerdict === "stop") {
      setTermsVerdict(s.termsVerdict);
    }
    if (Array.isArray(s.complianceResults)) {
      setComplianceResults(s.complianceResults as AiUrlCheckResult[]);
    }
    if (typeof s.complianceCounted === "boolean") setComplianceCounted(s.complianceCounted);
    if (s.profitState && typeof s.profitState === "object") {
      setProfitState(s.profitState as ProfitStepState);
    }
    if (s.trafficResult && typeof s.trafficResult === "object") {
      setTrafficResult(s.trafficResult as TrafficPlanResult);
    }
  };

  // 挂载时恢复：?offerId= 明确选了 offer 时恢复该 offer 的快照；
  // 没带 offerId 时用上次选的 offer 回落（选一次，到处带）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let oid: string | null = initialOffer?.id ?? null;
        if (oid) {
          setLastOfferId(oid);
        } else {
          const last = getLastOfferId();
          const found = last ? offers.find((o) => o.id === last) : undefined;
          if (found) {
            oid = found.id;
            setOffer(found);
          }
        }
        if (!oid) return;
        const res = await loadWorkStateAction("ai-worksheet", oid);
        if (cancelled || !res.ok || !res.data.state) return;
        if (!snapshotMeaningful(res.data.state)) return;
        applySnapshot(res.data.state);
        setRestoredAt(res.data.updatedAt);
        lastSavedRef.current = JSON.stringify(res.data.state);
      } catch {
        /* 恢复失败不打断页面 */
      } finally {
        if (!cancelled) loadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防抖自动保存（2.5s）：只在有实质内容且变化时保存
  useEffect(() => {
    if (!loadedRef.current) return;
    const snap = buildSnapshot();
    if (!snapshotMeaningful(snap)) return;
    const json = JSON.stringify(snap);
    if (json === lastSavedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        const oid = (snap.offer as WorksheetOffer | null)?.id || null;
        const res = await saveWorkStateAction("ai-worksheet", snap, {
          offerId: oid,
          label: (snap.offer as WorksheetOffer | null)?.name ?? null,
        });
        if (res.ok) lastSavedRef.current = json;
      } catch {
        /* 自动保存失败静默 */
      }
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, openStep, offer, mName, mNetwork, mUrl, termsVerdict, complianceResults, complianceCounted, profitState, trafficResult]);

  const openHistory = async () => {
    setHistoryOpen((o) => !o);
    if (!historyOpen && historyItems.length === 0) {
      const res = await listWorkStateHistoryAction("ai-worksheet", { limit: 20 });
      if (res.ok) setHistoryItems(res.data);
    }
  };

  const restoreFromHistory = async (item: WorkStateHistoryItem) => {
    // history 列表不返回 state 全量，这里按 offerId 取最新快照
    const res = await loadWorkStateAction("ai-worksheet", item.offerId);
    if (res.ok && res.data.state && snapshotMeaningful(res.data.state)) {
      applySnapshot(res.data.state);
      setRestoredAt(res.data.updatedAt);
      lastSavedRef.current = JSON.stringify(res.data.state);
    }
    setHistoryOpen(false);
  };

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

      <OfferPipelineNav
        current="analyze"
        offerId={offer?.id ?? null}
        offerName={offer?.name ?? (mName || null)}
        offerNetwork={offer?.network ?? (mNetwork || null)}
        picker={
          <span className="text-xs text-ink/50">（上方已选）</span>
        }
      />

      {/* 自动保存状态 + 历史记录入口 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={openHistory}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          🕘 {w.history} {historyOpen ? "▾" : "▸"}
        </button>
        {restoredAt && (
          <span className="text-xs text-emerald-700">
            ✓ {w.restoredNote.replace("{time}", new Date(restoredAt).toLocaleString())}
          </span>
        )}
        <span className="text-xs text-ink/45">{w.autosaveHint}</span>
      </div>
      {historyOpen && (
        <div className="rounded-xl border border-ink/10 bg-white/70 p-3">
          {historyItems.length === 0 ? (
            <p className="text-sm text-ink/55">{w.historyEmpty}</p>
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
                      {h.label || w.historyUntitled}
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
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink/55">{w.offerTitle}</p>
            {offer ? (
              <>
                <p className="mt-1 truncate text-lg font-semibold text-ink">{offer.name}</p>
                <p className="mt-0.5 text-sm text-ink/60">
                  {offer.network}
                  {offer.destinationUrl ? (
                    <>
                      {" · "}
                      <span className="break-all font-mono text-xs">{offer.destinationUrl}</span>
                    </>
                  ) : null}
                </p>
                {offer.id && (
                  <Link
                    href={`/offers/${offer.id}`}
                    className="mt-1 inline-block text-xs text-signal underline-offset-2 hover:underline"
                  >
                    {w.openOffer}
                  </Link>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-ink/60">{w.noOffer}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
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

        {/* Offer 选择器 + 手动输入 */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
          <select
            value={offer?.id ?? ""}
            onChange={async (e) => {
              const sel = offers.find((o) => o.id === e.target.value) ?? null;
              // 切 offer：先清空旧 offer 的步骤结果，避免残留/污染新 offer
              setTermsVerdict(null);
              setComplianceResults(null);
              setComplianceCounted(true);
              setProfitState(null);
              setTrafficResult(null);
              setOffer(sel);
              setLastOfferId(sel?.id ?? null);
              setManualOpen(false);
              // 再加载新 offer 的快照（有则恢复）
              if (sel) {
                try {
                  const res = await loadWorkStateAction("ai-worksheet", sel.id);
                  if (res.ok && res.data.state && snapshotMeaningful(res.data.state)) {
                    applySnapshot(res.data.state);
                    setRestoredAt(res.data.updatedAt);
                  }
                } catch {
                  /* 恢复失败不打断 */
                }
              }
            }}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-signal"
          >
            <option value="">{w.selectOffer ?? "从 offer 库选择…"}</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}（{o.network}）
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setManualOpen((o) => !o)}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            {w.manualOffer ?? "手动输入 offer"}
          </button>
          {offer && (
            <button
              type="button"
              onClick={() => {
                setOffer(null);
                setLastOfferId(null);
              }}
              className="text-xs text-ink/40 hover:text-red-600"
            >
              {w.clearOffer ?? "清除"}
            </button>
          )}
        </div>
        {manualOpen && (
          <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-ink/[0.03] p-3 sm:grid-cols-3">
            <input
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              placeholder={w.offerNamePh ?? "Offer 名称 *"}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
            />
            <input
              value={mNetwork}
              onChange={(e) => setMNetwork(e.target.value)}
              placeholder={w.offerNetworkPh ?? "渠道/网络"}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
            />
            <input
              value={mUrl}
              onChange={(e) => setMUrl(e.target.value)}
              placeholder={w.offerUrlPh ?? "目标 URL"}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
            />
            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={applyManualOffer}
                disabled={!mName.trim()}
                className="rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {w.useOffer ?? "使用这个 offer 分析"}
              </button>
            </div>
          </div>
        )}
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
        <TermsClient
          isAdmin={isAdmin}
          showSetupNudge={false}
          hideHeader
          onVerdict={setTermsVerdict}
          initialOffer={
            offer
              ? { id: offer.id, name: offer.name, network: offer.network }
              : null
          }
        />
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
          initialOffer={
            offer
              ? {
                  id: offer.id,
                  name: offer.name,
                  network: offer.network,
                  destinationUrl: offer.destinationUrl,
                }
              : null
          }
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
        <ProfitStep
          onChange={setProfitState}
          initialPayout={initialPayout}
          initialMode={initialProfitMode}
          initialAvgPrice={initialAvgPrice}
          initialCommissionRate={initialCommissionRate}
          initialValues={profitState?.inputs}
          offerId={offer?.id ?? null}
          key={offer?.id ?? "manual"}
        />
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
        <TrafficPlannerClient
          showSetupNudge={false}
          hideHeader
          onResult={setTrafficResult}
          initialInputs={
            profitState?.inputs
              ? {
                  payout: profitState.inputs.payout,
                  cvr: profitState.inputs.cvrPct,
                  refundRate: profitState.inputs.refundPct,
                  avgPrice: profitState.inputs.avgPrice,
                  commissionRate: profitState.inputs.commissionRate,
                }
              : undefined
          }
          initialOffer={
            offer
              ? (offer as PlannerOffer)
              : mName.trim()
                ? {
                    id: "",
                    name: mName.trim(),
                    network: mNetwork.trim(),
                  }
                : null
          }
        />
        <BrandBiddingClient
          initialKeyword={offer?.name ?? mName}
          initialDomain={(() => {
            try {
              const u = offer?.destinationUrl || mUrl;
              return u ? new URL(u).hostname.replace(/^www\./, "") : "";
            } catch {
              return "";
            }
          })()}
        />
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
        {/* 下一步：带着当前 offer 跳到物料/投流 */}
        {offer && (verdict === "go" || verdict === "goWithWarn") && (
          <div className="mt-4 border-t border-ink/10 pt-4">
            <p className="text-sm font-semibold text-ink">{w.verdict.nextSteps}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href={
                  offer.id
                    ? `/keywords/starter?tab=research&offerId=${encodeURIComponent(offer.id)}`
                    : "/keywords/starter?tab=research"
                }
                className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                🔍 {w.verdict.toKeywords}
              </Link>
              {offer.id && (
                <Link
                  href={`/landing-pages?offerId=${encodeURIComponent(offer.id)}`}
                  className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
                >
                  📄 {w.verdict.toLanding}
                </Link>
              )}
              {offer.destinationUrl && (
                <Link
                  href={`/ads/auto-create?urls=${encodeURIComponent(offer.destinationUrl)}&offerId=${encodeURIComponent(offer.id)}`}
                  className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
                >
                  📢 {w.verdict.toAds}
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
