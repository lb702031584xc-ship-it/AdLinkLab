"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { calcProfit, ASSUMED_CLICKS_TO_ORDER, clicksToOrderFromCvr, suggestCpcByClicksToOrder } from "@/lib/profit-calc";
import { getLastOfferId, getManualOffer, setLastOfferId, setManualOffer } from "@/lib/current-offer";
import {
  evaluateDemandGate,
  type DemandGateKeyword,
} from "@/lib/demand-gate";
import { judgeKeywordRelevanceAction } from "@/lib/api/ai-actions";
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
import { TrafficGateCard } from "@/components/traffic/traffic-gate-card";
import { checkTrafficGateAction } from "@/lib/api/traffic-actions";
import type { TrafficGate } from "@/lib/api/amazon-types";
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
  /** Offer 来源：affiliate | amazon | cashback（亚马逊 offer 才显示销量/评论门槛）。 */
  source?: string | null;
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

/* ---------------- Step ④: compact profitability calculator ---------------- */
/* Uses the shared @/lib/profit-calc — no duplicated formulas. */

export type ProfitMode = "ecommerce" | "other";

export interface ProfitStepState {
  status: StepStatus;
  summary: string;
  /** P0-2：本次测算是否基于估算输入（true = 估算值，未实测）。来源不明时默认 true。 */
  isEstimated?: boolean;
  /** ④ 的输入（用于快照恢复 + 往 ⑤ 投流模块同步 payout/CVR/退款率）。 */
  inputs?: {
    /** 电商：payout = 均价 × 佣金率（算出后存这里，供 ⑤ 同步）；其他：手填固定 payout。 */
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
  /** P1-1：公式 A 分母覆盖（用户手改后不再跟随 CVR 联动）。 */
  const [ctoOverride, setCtoOverride] = useState("");
  /** P0-2 输入来源：均价 / 佣金率 / payout / CPC / CVR 各自从哪来。
      来源不明时默认估算（宁可标估算，不把猜测当实测）。
      offer = 库里 Offer 带入；manual = 用户手填；keywords = 投放选词快照；
      planner = 投流决策（⑤）快照；snapshot = 上次保存的工作表快照；
      derived = 切到“其他”时由均价×佣金率带过去的 payout。 */
  type ProvSource = "offer" | "manual" | "keywords" | "planner" | "snapshot" | "derived" | null;
  type ProvField = "avgPrice" | "commissionRate" | "payout" | "cpc" | "cvrPct";
  const [prov, setProv] = useState<Record<ProvField, ProvSource>>({
    avgPrice: initialValues?.avgPrice ? "snapshot" : initialAvgPrice ? "offer" : null,
    commissionRate: initialValues?.commissionRate ? "snapshot" : initialCommissionRate ? "offer" : null,
    payout: initialValues?.payout ? "snapshot" : initialPayout ? "offer" : null,
    cpc: initialValues?.cpc ? "snapshot" : null,
    cvrPct: initialValues?.cvrPct ? "snapshot" : null,
  });
  const setFieldProv = (field: ProvField, src: Exclude<ProvSource, null>) =>
    setProv((p) => (p[field] === src ? p : { ...p, [field]: src }));
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
    if (!payout && initialValues.payout) { setPayout(initialValues.payout); setFieldProv("payout", "snapshot"); }
    if (!cpc && initialValues.cpc) { setCpc(initialValues.cpc); setFieldProv("cpc", "snapshot"); }
    if (!cvrPct && initialValues.cvrPct) { setCvrPct(initialValues.cvrPct); setFieldProv("cvrPct", "snapshot"); }
    if (!refundPct && initialValues.refundPct) setRefundPct(initialValues.refundPct);
    if (!shavePct && initialValues.shavePct) setShavePct(initialValues.shavePct);
    if (!avgPrice && initialValues.avgPrice) { setAvgPrice(initialValues.avgPrice); setFieldProv("avgPrice", "snapshot"); }
    if (!commissionRate && initialValues.commissionRate) {
      setCommissionRate(initialValues.commissionRate);
      setFieldProv("commissionRate", "snapshot");
    }
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
        setFieldProv("cpc", "keywords");
      } catch {
        /* 取不到就不填 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);

  /* 转化率/退款率/payout 联动：为空时从该 offer 的投流决策（⑤）快照取——
     前面在 ⑤ 填过的不用在 ④ 重填。只填空字段，不覆盖手改（函数式 setState 防竞态）。 */
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
        if (cvr) { setCvrPct((prev) => (prev.trim() ? prev : cvr)); setFieldProv("cvrPct", "planner"); }
        const refund = str(s.refundRate);
        if (refund) setRefundPct((prev) => (prev.trim() ? prev : refund));
        // offer 佣金算不出 payout 时（按比例缺均价等），取 ⑤ 里手填过的 payout
        if (!initialPayout) {
          const p = str(s.payout);
          if (p) { setPayout((prev) => (prev.trim() ? prev : p)); setFieldProv("payout", "planner"); }
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

  /* 电商：payout = 均价 × 佣金率（算不出时沿用上次/⑤填过的 payout，不丢旧数据）。 */
  const derivedPayout = useMemo(() => {
    if (mode !== "ecommerce") return payout;
    const ap = parseFloat(avgPrice);
    const rate = parseFloat(commissionRate);
    if (ap > 0 && rate > 0) {
      return String(Math.round(((ap * rate) / 100) * 100) / 100);
    }
    return payout;
  }, [mode, avgPrice, commissionRate, payout]);

  /* P0-2：均价/CPC/CVR 任一来源不明 → 本次测算为估算。电商 payout 由均价×佣金率
     推导时看两者来源；否则看 payout 字段本身。退款/扣量不参与估算判定。 */
  const isEstimated = useMemo(() => {
    const measured = (s: ProvSource) => s !== null;
    const derivedFromPrice = parseFloat(avgPrice) > 0 && parseFloat(commissionRate) > 0;
    const payoutMeasured =
      mode === "ecommerce"
        ? derivedFromPrice
          ? measured(prov.avgPrice) && measured(prov.commissionRate)
          : measured(prov.payout)
        : prov.payout === "derived"
          ? measured(prov.avgPrice) && measured(prov.commissionRate)
          : measured(prov.payout);
    return !(payoutMeasured && measured(prov.cpc) && measured(prov.cvrPct));
  }, [mode, avgPrice, commissionRate, prov]);

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
      inputsEstimated: isEstimated,
    });
  }, [derivedPayout, cpc, cvrPct, refundPct, shavePct, mode, targetRoiPct, isEstimated]);

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
      inputsEstimated: isEstimated,
    });
    return r.maxCpcAtTargetRoi;
  }, [derivedPayout, cvrPct, refundPct, shavePct, mode, targetRoiPct, isEstimated]);

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
      isEstimated: result.isEstimated,
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

  /* P1-1 — 建议 CPC 双公式并列（补充，不改 K3 公式）：
     A = 价格 × 佣金比例 ÷ 预期点击出单数；分母优先用实测 CVR（1 ÷ CVR），
     无实测时用讲师假设 50 并打估算角标；用户可手改分母。
     B = EPC ÷ (1 + 目标 ROI)，即 result.maxCpcAtTargetRoi（K3 公式本身不动）。 */
  const ctoFromCvr = (() => {
    const cvr = parseFloat(cvrPct);
    return Number.isFinite(cvr) && cvr > 0 && cvr < 100
      ? clicksToOrderFromCvr(cvr / 100)
      : null;
  })();
  const ctoOverrideNum = parseFloat(ctoOverride);
  const effectiveCto =
    Number.isFinite(ctoOverrideNum) && ctoOverrideNum > 0
      ? ctoOverrideNum
      : (ctoFromCvr ?? ASSUMED_CLICKS_TO_ORDER);
  const ctoSource: "manual" | "measured" | "assumed" =
    Number.isFinite(ctoOverrideNum) && ctoOverrideNum > 0
      ? "manual"
      : ctoFromCvr !== null
        ? "measured"
        : "assumed";
  const formulaA =
    mode === "ecommerce"
      ? suggestCpcByClicksToOrder({
          price: parseFloat(avgPrice),
          commissionRatePct: parseFloat(commissionRate),
          clicksToOrder: effectiveCto,
        })
      : null;

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
                  setFieldProv("payout", "derived");
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
                onChange={(e) => { setAvgPrice(e.target.value); setFieldProv("avgPrice", "manual"); }} placeholder="49.99" className={inputClass} />
              {initialAvgPrice && avgPrice === initialAvgPrice && (
                <p className="mt-1 text-xs text-ink/45">✨ {w.avgPriceFromOffer}</p>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="ws-commission-rate">{w.commissionRateLabel}</label>
              <input id="ws-commission-rate" inputMode="decimal" value={commissionRate}
                onChange={(e) => { setCommissionRate(e.target.value); setFieldProv("commissionRate", "manual"); }} placeholder="10" className={inputClass} />
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
              onChange={(e) => { setPayout(e.target.value); setFieldProv("payout", "manual"); }} placeholder="12.50" className={inputClass} />
            {initialPayout && payout === initialPayout && (
              <p className="mt-1 text-xs text-ink/45">✨ {w.payoutFromOffer}</p>
            )}
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="ws-cpc">{d.cpcLabel}</label>
          <input id="ws-cpc" inputMode="decimal" value={cpc}
            onChange={(e) => { setCpc(e.target.value); setCpcFromKeywords(false); setFieldProv("cpc", "manual"); }} placeholder="0.80" className={inputClass} />
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
            onChange={(e) => { setCvrPct(e.target.value); setFieldProv("cvrPct", "manual"); }} placeholder="2" className={inputClass} />
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

      {/* P1-1：建议 CPC 双公式并列（仅电商模式有价格 × 佣金比例）。 */}
      {mode === "ecommerce" ? (
        <div className="mt-4 rounded-xl border border-ink/10 bg-white p-5">
          <p className="text-sm font-semibold text-ink">{w.dualCpcTitle}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-sm font-medium text-ink">{w.formulaALabel}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {formulaA !== null ? fmt(formulaA, 4) : "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-ink/45">{w.formulaAFormula}</p>
              <label className="mt-3 block text-xs font-medium text-ink/70">
                {w.formulaACtoLabel}
              </label>
              <input
                inputMode="decimal"
                value={ctoOverride}
                onChange={(e) => setCtoOverride(e.target.value)}
                placeholder={String(Math.round(effectiveCto))}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink/55">
                {ctoSource === "assumed" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                    {w.formulaAAssumed}
                  </span>
                ) : ctoSource === "measured" ? (
                  w.formulaAMeasured
                ) : (
                  "分母：你手动填写的值"
                )}
              </p>
            </div>
            <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-sm font-medium text-ink">{w.formulaBLabel}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {result?.maxCpcAtTargetRoi !== null && result?.maxCpcAtTargetRoi !== undefined
                  ? fmt(result.maxCpcAtTargetRoi, 4)
                  : "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-ink/45">{w.formulaBFormula}</p>
              <p className="mt-3 text-xs text-ink/55">
                {w.formulaBSource.replace("{roi}", targetRoiPct || "100")}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Step ①: 需求门槛（先看有没有量，没量不用往下走） ---------------- */

export interface DemandGateState {
  status: StepStatus;
  summary: string;
  inputs?: {
    domainEnabled: boolean;
    domainOrganic: string;
    domainPaid: string;
    paidTrend: string;
    amazonSales: string;
    amazonReviews: string;
    amazonRating: string;
    judgments: Array<{ keyword: string; volume: string; relevant: boolean; reason: string }>;
  };
}

function DemandGateStep({
  onChange,
  initialValues,
  offerId,
  offerName,
  offerDescription,
  isAmazon,
}: {
  onChange: (s: DemandGateState | null) => void;
  initialValues?: DemandGateState["inputs"];
  offerId?: string | null;
  offerName: string;
  offerDescription: string;
  isAmazon: boolean;
}) {
  const t = useDict();
  const g = t.ai.worksheet.demandGate;

  const [domainEnabled, setDomainEnabled] = useState(initialValues?.domainEnabled ?? false);
  const [domainOrganic, setDomainOrganic] = useState(initialValues?.domainOrganic ?? "");
  const [domainPaid, setDomainPaid] = useState(initialValues?.domainPaid ?? "");
  const [paidTrend, setPaidTrend] = useState(initialValues?.paidTrend ?? "");
  const [amazonSales, setAmazonSales] = useState(initialValues?.amazonSales ?? "");
  const [amazonReviews, setAmazonReviews] = useState(initialValues?.amazonReviews ?? "");
  const [amazonRating, setAmazonRating] = useState(initialValues?.amazonRating ?? "");
  const [kwList, setKwList] = useState<Array<{ keyword: string; volume: string }>>(
    () => (initialValues?.judgments ?? []).map((j) => ({ keyword: j.keyword, volume: j.volume }))
  );
  const [judgments, setJudgments] = useState<Record<string, { relevant: boolean; reason: string }>>(
    () => {
      const m: Record<string, { relevant: boolean; reason: string }> = {};
      for (const j of initialValues?.judgments ?? []) {
        m[j.keyword.trim().toLowerCase()] = { relevant: j.relevant, reason: j.reason };
      }
      return m;
    }
  );
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const snapshotAppliedRef = useRef(false);

  /* 快照晚到：只填空字段；判断结果只合并未判过的词 */
  useEffect(() => {
    if (!initialValues || snapshotAppliedRef.current) return;
    snapshotAppliedRef.current = true;
    if (initialValues.domainEnabled) setDomainEnabled(true);
    if (!domainOrganic && initialValues.domainOrganic) setDomainOrganic(initialValues.domainOrganic);
    if (!domainPaid && initialValues.domainPaid) setDomainPaid(initialValues.domainPaid);
    if (!paidTrend && initialValues.paidTrend) setPaidTrend(initialValues.paidTrend);
    if (!amazonSales && initialValues.amazonSales) setAmazonSales(initialValues.amazonSales);
    if (!amazonReviews && initialValues.amazonReviews) setAmazonReviews(initialValues.amazonReviews);
    if (!amazonRating && initialValues.amazonRating) setAmazonRating(initialValues.amazonRating);
    setJudgments((prev) => {
      const next = { ...prev };
      for (const j of initialValues.judgments ?? []) {
        const key = j.keyword.trim().toLowerCase();
        if (!next[key]) next[key] = { relevant: j.relevant, reason: j.reason };
      }
      return next;
    });
    setKwList((prev) => {
      const seen = new Set(prev.map((k) => k.keyword.trim().toLowerCase()));
      const add = (initialValues.judgments ?? [])
        .filter((j) => !seen.has(j.keyword.trim().toLowerCase()))
        .map((j) => ({ keyword: j.keyword, volume: j.volume }));
      return add.length ? [...prev, ...add] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  /* 关键词：从需求验证页快照取（SEMrush 数据在那页，page key = keyword-research）。 */
  useEffect(() => {
    if (!offerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await loadWorkStateAction("keyword-research", offerId);
        if (cancelled || !res.ok || !res.data.state) return;
        const rows = (res.data.state.rows ?? []) as Array<{ keyword?: string; volume?: string }>;
        const incoming = rows
          .map((r) => ({ keyword: (r.keyword ?? "").trim(), volume: (r.volume ?? "").trim() }))
          .filter((r) => r.keyword);
        if (incoming.length === 0) return;
        setKwList((prev) => {
          const byKey = new Map(prev.map((k) => [k.keyword.trim().toLowerCase(), k]));
          for (const k of incoming) {
            const key = k.keyword.toLowerCase();
            const cur = byKey.get(key);
            // 需求验证页的量是最新的，覆盖；没量的旧词保留
            byKey.set(key, { keyword: cur?.keyword ?? k.keyword, volume: k.volume || cur?.volume || "" });
          }
          return [...byKey.values()];
        });
      } catch {
        /* 取不到就不填 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  const gateKeywords: DemandGateKeyword[] = useMemo(
    () =>
      kwList.map((k) => ({
        keyword: k.keyword,
        volume: (() => {
          const n = parseFloat(k.volume);
          return Number.isFinite(n) && n >= 0 ? n : null;
        })(),
        relevant: judgments[k.keyword.trim().toLowerCase()]?.relevant ?? null,
      })),
    [kwList, judgments]
  );

  const result = useMemo(() => {
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    return evaluateDemandGate({
      keywords: gateKeywords,
      // 域名是可选区块：没勾“有独立站”就不传域名数据，不产生域名相关提示。
      domainOrganicVolume: domainEnabled ? num(domainOrganic) : null,
      domainPaidVolume: domainEnabled ? num(domainPaid) : null,
      paidTrend: domainEnabled && (paidTrend === "up" || paidTrend === "flat" || paidTrend === "down") ? paidTrend : null,
      amazon: isAmazon
        ? {
            estimatedMonthlySales: num(amazonSales),
            reviewCount: num(amazonReviews),
            rating: num(amazonRating),
          }
        : null,
    });
  }, [gateKeywords, domainEnabled, domainOrganic, domainPaid, paidTrend, amazonSales, amazonReviews, amazonRating, isAmazon]);

  useEffect(() => {
    if (result.verdict === "unknown") {
      onChange(null);
      return;
    }
    const status: StepStatus =
      result.verdict === "pass" ? "pass" : result.verdict === "caution" ? "warn" : "fail";
    const judged = gateKeywords
      .filter((k) => k.relevant !== null)
      .map((k) => {
        const j = judgments[k.keyword.trim().toLowerCase()]!;
        const vol = kwList.find((x) => x.keyword.trim().toLowerCase() === k.keyword.trim().toLowerCase())?.volume ?? "";
        return { keyword: k.keyword, volume: vol, relevant: j.relevant, reason: j.reason };
      });
    onChange({
      status,
      summary: `${g.relevantVolume} ${fmt(result.relevantVolume, 0)} · ${g.estimatedClicks} ${result.estimatedClicks !== null ? fmt(result.estimatedClicks, 0) : "—"} · ${g.relevantRatio} ${result.relevanceRatio !== null ? `${fmt(result.relevanceRatio * 100)}%` : "—"}`,
      inputs: {
        domainEnabled,
        domainOrganic,
        domainPaid,
        paidTrend,
        amazonSales,
        amazonReviews,
        amazonRating,
        judgments: judged,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const judge = async () => {
    const todo = kwList.filter((k) => judgments[k.keyword.trim().toLowerCase()] == null);
    if (todo.length === 0 || judging) return;
    setJudging(true);
    setJudgeError(null);
    try {
      const res = await judgeKeywordRelevanceAction(
        offerName,
        offerDescription,
        todo.map((k) => ({
          keyword: k.keyword,
          volume: (() => {
            const n = parseFloat(k.volume);
            return Number.isFinite(n) && n >= 0 ? n : null;
          })(),
        }))
      );
      if (!res.ok) {
        setJudgeError(res.error);
        return;
      }
      setJudgments((prev) => {
        const next = { ...prev };
        for (const j of res.data.judgments) {
          next[j.keyword.trim().toLowerCase()] = { relevant: j.relevant, reason: j.reason };
        }
        return next;
      });
    } finally {
      setJudging(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  const reasonLines = result.flags.map((f) => {
    switch (f) {
      case "noKeywords":
        return g.flag.noKeywords;
      case "notJudged":
        return g.flag.notJudged;
      case "noRelevant":
        return g.flag.noRelevant;
      case "lowRelevanceRatio":
        return g.flag.lowRelevanceRatio.replace("{ratio}", result.relevanceRatio !== null ? fmt(result.relevanceRatio * 100) : "—");
      case "volumeBelowFloor":
        return g.flag.volumeBelowFloor.replace("{relevant}", fmt(result.relevantVolume, 0));
      case "volumeConditional":
        return g.flag.volumeConditional.replace("{relevant}", fmt(result.relevantVolume, 0));
      case "volumeEnough":
        return g.flag.volumeEnough.replace("{relevant}", fmt(result.relevantVolume, 0));
      case "trendDown":
        return g.flag.trendDown;
      case "trendUp":
        return g.flag.trendUp;
      case "domainLowAccuracy":
        return g.flag.domainLowAccuracy;
      case "domainNoPaid":
        return g.flag.domainNoPaid;
      case "amazonLowRating":
        return g.flag.amazonLowRating.replace("{rating}", amazonRating || "—");
      case "amazonRatingCaution":
        return g.flag.amazonRatingCaution.replace("{rating}", amazonRating || "—");
      case "amazonFewReviews":
        return g.flag.amazonFewReviews.replace("{reviews}", amazonReviews || "—");
      case "amazonReviewsCaution":
        return g.flag.amazonReviewsCaution.replace("{reviews}", amazonReviews || "—");
      default:
        return "";
    }
  }).filter(Boolean);

  const statusCls =
    result.verdict === "pass"
      ? "bg-green-100 text-green-800"
      : result.verdict === "caution"
        ? "bg-amber-100 text-amber-800"
        : result.verdict === "fail"
          ? "bg-red-100 text-red-800"
          : "bg-ink/10 text-ink/50";
  const statusText =
    result.verdict === "pass"
      ? g.verdictPass
      : result.verdict === "caution"
        ? g.verdictCaution
        : result.verdict === "fail"
          ? g.verdictFail
          : g.verdictPending;

  if (!offerId) {
    return <p className="text-sm text-ink/55">{g.needOffer}</p>;
  }

  return (
    <div>
      {/* 域名是可选区块：联盟里很多亚马逊 offer 没有独立站，不勾就不填、不判。 */}
      <label className="mb-2 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={domainEnabled}
          onChange={(e) => setDomainEnabled(e.target.checked)}
          className="mt-1 h-4 w-4 accent-ink"
        />
        <span>
          <span className="block text-sm font-medium text-ink">{g.domainToggle}</span>
          <span className="block text-xs text-ink/55">{g.domainToggleHint}</span>
        </span>
      </label>
      {domainEnabled ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="ws-dg-organic">{g.domainOrganicLabel}</label>
            <input id="ws-dg-organic" inputMode="decimal" value={domainOrganic}
              onChange={(e) => setDomainOrganic(e.target.value)} placeholder="12000" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ws-dg-paid">{g.domainPaidLabel}</label>
            <input id="ws-dg-paid" inputMode="decimal" value={domainPaid}
              onChange={(e) => setDomainPaid(e.target.value)} placeholder="3000" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ws-dg-trend">{g.paidTrendLabel}</label>
            <select id="ws-dg-trend" value={paidTrend} onChange={(e) => setPaidTrend(e.target.value)} className={inputClass}>
              <option value="">{g.paidTrendOptions.none}</option>
              <option value="up">{g.paidTrendOptions.up}</option>
              <option value="flat">{g.paidTrendOptions.flat}</option>
              <option value="down">{g.paidTrendOptions.down}</option>
            </select>
          </div>
        </div>
      ) : null}

      {isAmazon ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-ink">{g.amazonTitle}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="ws-dg-sales">{g.amazonSalesLabel}</label>
              <input id="ws-dg-sales" inputMode="decimal" value={amazonSales}
                onChange={(e) => setAmazonSales(e.target.value)} placeholder="500" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ws-dg-reviews">{g.amazonReviewsLabel}</label>
              <input id="ws-dg-reviews" inputMode="decimal" value={amazonReviews}
                onChange={(e) => setAmazonReviews(e.target.value)} placeholder="1200" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ws-dg-rating">{g.amazonRatingLabel}</label>
              <input id="ws-dg-rating" inputMode="decimal" value={amazonRating}
                onChange={(e) => setAmazonRating(e.target.value)} placeholder="4.5" className={inputClass} />
            </div>
          </div>
          <p className="mt-1 text-xs text-ink/55">{g.amazonSalesHint}</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium text-ink">
          {g.keywordsTitle} ({kwList.length})
        </p>
        <button
          type="button"
          onClick={judge}
          disabled={judging || kwList.length === 0}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/85 disabled:opacity-50"
        >
          {judging ? g.judging : g.judgeButton}
        </button>
        <Link
          href={`/keywords/starter?offerId=${encodeURIComponent(offerId)}`}
          className="text-xs text-signal hover:underline"
        >
          {g.goDemandPage} →
        </Link>
      </div>
      {judgeError ? <p className="mt-1 text-xs text-red-600">{judgeError}</p> : null}
      {kwList.length === 0 ? (
        <p className="mt-2 text-sm text-ink/55">{g.noKeywords}</p>
      ) : (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-ink/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink/[0.03]">
              <tr>
                <th className="px-3 py-1.5 font-medium text-ink/70">{g.colKeyword}</th>
                <th className="px-3 py-1.5 font-medium text-ink/70">{g.colVolume}</th>
                <th className="px-3 py-1.5 font-medium text-ink/70">{g.colRelevant}</th>
              </tr>
            </thead>
            <tbody>
              {kwList.map((k) => {
                const j = judgments[k.keyword.trim().toLowerCase()];
                return (
                  <tr key={k.keyword} className="border-t border-ink/5">
                    <td className="px-3 py-1.5 font-medium text-ink">{k.keyword}</td>
                    <td className="px-3 py-1.5 text-ink/70">{k.volume || "—"}</td>
                    <td className="px-3 py-1.5" title={j?.reason}>
                      {j == null ? (
                        <span className="text-ink/40">{g.notJudged}</span>
                      ) : j.relevant ? (
                        <span className="text-green-700">✅ {g.relevantYes}{j.reason ? ` · ${j.reason}` : ""}</span>
                      ) : (
                        <span className="text-ink/50">❌ {g.relevantNo}{j.reason ? ` · ${j.reason}` : ""}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${statusCls}`}>{statusText}</span>
        {result.verdict !== "unknown" ? (
          <span className="text-sm text-ink/70">
            {g.relevantVolume} <b>{fmt(result.relevantVolume, 0)}</b>
            {" · "}
            {g.floorVolume} <b>3,000</b>
            {" · "}
            {g.scaleVolume} <b>10,000</b>
            {" · "}
            {g.estimatedClicks} <b>{result.estimatedClicks !== null ? fmt(result.estimatedClicks, 0) : "—"}</b>
          </span>
        ) : null}
      </div>
      {reasonLines.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/75">
          {reasonLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {domainOrganic || domainPaid ? (
        <p className="mt-2 text-xs text-ink/45">
          {g.domainContext
            .replace("{organic}", domainOrganic || "—")
            .replace("{paid}", domainPaid || "—")}
        </p>
      ) : null}
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

  /** 手动 Offer 跟随：手动（输入中或已应用，id 为空）与库里 Offer 互斥，当前只有一个。
      库里 Offer 有效（id 非空）时清除手动 Offer；手动有效时存手动 Offer 并清库里记忆。 */
  useEffect(() => {
    if (offer && offer.id) {
      setManualOffer(null);
      return;
    }
    if (offer && !offer.id) {
      // 已应用的手动 Offer：以 offer 里的已应用值为准
      setManualOffer({
        name: offer.name,
        network: offer.network ?? "",
        url: offer.destinationUrl ?? "",
      });
      setLastOfferId(null);
      return;
    }
    if (mName.trim()) {
      // 输入中的手动 Offer：以输入框为准
      setManualOffer({
        name: mName.trim(),
        network: mNetwork.trim(),
        url: mUrl.trim(),
      });
      setLastOfferId(null);
    }
  }, [offer, mName, mNetwork, mUrl]);

  const [termsVerdict, setTermsVerdict] = useState<"go" | "caution" | "stop" | null>(null);
  const [complianceResults, setComplianceResults] = useState<AiUrlCheckResult[] | null>(null);
  const [complianceCounted, setComplianceCounted] = useState(true);
  const [demandGateState, setDemandGateState] = useState<DemandGateState | null>(null);
  const [profitState, setProfitState] = useState<ProfitStepState | null>(null);
  /* P0-1：流量门（TrafficGate，K4）检测结果。passed 三态：true 通过 /
     false 不通过 / null unknown（暂无数据，绝不判 fail）。 */
  const [trafficGate, setTrafficGate] = useState<TrafficGate | null>(null);
  const [trafficGateLoading, setTrafficGateLoading] = useState(false);
  const [trafficGateError, setTrafficGateError] = useState<string | null>(null);
  const gateSeq = useRef(0);
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
  /* ④ 模式自动判：按比例佣金 → 电商（均价 × 佣金率）；固定佣金 → 其他（固定 payout）。 */
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
    demandGateState,
    termsVerdict,
    complianceResults,
    complianceCounted,
    profitState,
    trafficResult,
    trafficGate,
  });

  // 只有 Offer、没有分析结果的快照不算有意义：避免切到新 Offer 时自动保存把旧 Offer 的带结果快照覆盖掉。
  // Offer 本身由 lastOfferId / manualOffer 记忆恢复，不需要靠快照。
  const snapshotMeaningful = (s: Record<string, unknown>): boolean =>
    s.demandGateState != null ||
    s.termsVerdict != null ||
    s.complianceResults != null ||
    s.profitState != null ||
    s.trafficResult != null ||
    s.trafficGate != null;

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
    if (s.demandGateState && typeof s.demandGateState === "object") {
      setDemandGateState(s.demandGateState as DemandGateState);
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
    if (s.trafficGate && typeof s.trafficGate === "object") {
      setTrafficGate(s.trafficGate as TrafficGate);
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
          } else {
            // 手动 Offer 回落：读手动记忆 + 载手动快照（offerId=null）。
            // 只当快照里的 Offer 名与手动记忆一致时才恢复结果，防止换了新手动 Offer 却载回旧结果。
            const manual = getManualOffer();
            if (manual) {
              setOffer({
                id: "",
                name: manual.name,
                network: manual.network,
                destinationUrl: manual.url,
              });
              const res = await loadWorkStateAction("ai-worksheet", null);
              if (!cancelled && res.ok && res.data.state && snapshotMeaningful(res.data.state)) {
                const snapOffer = (res.data.state as { offer?: { name?: string } | null }).offer;
                if (!snapOffer?.name || snapOffer.name === manual.name) {
                  applySnapshot(res.data.state);
                  setRestoredAt(res.data.updatedAt);
                  lastSavedRef.current = JSON.stringify(res.data.state);
                }
              }
            }
            return;
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
  }, [source, openStep, offer, mName, mNetwork, mUrl, demandGateState, termsVerdict, complianceResults, complianceCounted, profitState, trafficResult, trafficGate]);

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
  const demandGateStatus: StepStatus = demandGateState?.status ?? null;
  const trafficDone = trafficResult !== null;

  const statusText = (s: StepStatus) =>
    s === "pass" ? w.status.pass : s === "warn" ? w.status.warn : s === "fail" ? w.status.fail : w.status.pending;

  /* Final verdict: gates are demand / terms / compliance (if counted) / profit.
     Traffic planning is informational — done counts as pass, never blocks. */
  const gateStatuses: StepStatus[] = [
    demandGateStatus,
    termsStatus,
    complianceCounted ? complianceStatus : null,
    profitStatus,
  ];
  const allDone =
    demandGateStatus !== null &&
    termsStatus !== null &&
    profitStatus !== null &&
    trafficDone &&
    (complianceStatus !== null || !complianceCounted);
  const anyFail = gateStatuses.some((s) => s === "fail");
  const anyWarn = gateStatuses.some((s) => s === "warn");
  const verdict: "incomplete" | "go" | "goWithWarn" | "noGo" =
    !allDone ? "incomplete" : anyFail ? "noGo" : anyWarn ? "goWithWarn" : "go";

  const demandReason = demandGateState
    ? `${w.steps.demand} — ${statusText(demandGateStatus)} (${demandGateState.summary})`
    : `${w.steps.demand} — ${w.status.pending}`;

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

  /* P0-1 一票否决汇总条（只展示已有分析结果的合成，不改任何判定逻辑）：
     条款 stop（= DO_NOT_RUN）/ 盈利 EPC ≤ CPC / 流量门 passed=false 任一命中 → 红条；
     仅 unknown（条款/盈利/流量门尚未分析或暂无数据）且无红条 → 黄条；两者都没有 → 不显示。
     流量门 unknown（passed=null，暂无数据）绝不判 fail，只进黄条。
     注意：工作表 ⑤ 是投流决策（TrafficPlanner），与流量门（TrafficGate）是两回事。 */
  const profitVeto = useMemo(() => {
    const inp = profitState?.inputs;
    if (!inp) return null;
    const p = parseFloat(inp.payout);
    const c = parseFloat(inp.cpc);
    const cvr = parseFloat(inp.cvrPct);
    if (!(p > 0) || !(c > 0) || !(cvr > 0) || cvr >= 100) return null;
    const pct = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 0;
    };
    const r = calcProfit({
      payout: p,
      cpc: c,
      cvrF: cvr / 100,
      refundF: inp.mode === "ecommerce" ? pct(inp.refundPct) : 0,
      shaveF: inp.mode === "other" ? pct(inp.shavePct) : 0,
    });
    return Number.isFinite(r.epc) && r.epc <= c ? { epc: r.epc, cpc: c } : null;
  }, [profitState]);

  const vetoReasons: string[] = [];
  if (termsVerdict === "stop") vetoReasons.push(w.vetoBanner.termsStop);
  if (profitVeto) {
    vetoReasons.push(
      w.vetoBanner.profitEpc
        .replace("{epc}", fmt(profitVeto.epc))
        .replace("{cpc}", fmt(profitVeto.cpc)),
    );
  }
  if (trafficGate?.passed === false) {
    vetoReasons.push(
      w.vetoBanner.trafficGateFail.replace("{reason}", trafficGate.reason),
    );
  }
  const vetoUnknowns: string[] = [];
  if (termsVerdict === null) vetoUnknowns.push(w.vetoBanner.termsUnknown);
  if (profitState === null) vetoUnknowns.push(w.vetoBanner.profitUnknown);
  if (trafficGate === null || trafficGate.passed === null) {
    vetoUnknowns.push(w.vetoBanner.trafficGateUnknown);
  }

  const toggleStep = (n: number) => setOpenStep((o) => (o === n ? 0 : n));

  /* P0-1：流量门检测（第 ① 步内）。brand 取 Offer 名；domain 取 Offer URL 的
     hostname；keywords 取需求验证里已填的 SEMrush 关键词（前 5 个）。 */
  const runTrafficGateCheck = (extra?: {
    brand?: string;
    manualMonthlyVisits?: number;
  }) => {
    const seq = ++gateSeq.current;
    setTrafficGateLoading(true);
    setTrafficGateError(null);
    const brand =
      (extra?.brand ?? offer?.name ?? mName ?? "").trim() || undefined;
    const domain = (() => {
      try {
        const u = offer?.destinationUrl || mUrl;
        return u ? new URL(u).hostname.replace(/^www\./, "") : undefined;
      } catch {
        return undefined;
      }
    })();
    const keywords = (demandGateState?.inputs?.judgments ?? [])
      .map((j) => j.keyword)
      .filter(Boolean)
      .slice(0, 5);
    void checkTrafficGateAction({
      brand,
      domain,
      keywords,
      manualMonthlyVisits: extra?.manualMonthlyVisits,
    }).then((g) => {
      if (seq !== gateSeq.current) return;
      setTrafficGateLoading(false);
      if (g.ok) {
        setTrafficGate(g.data);
      } else {
        setTrafficGateError(`${w.trafficGate.checkFailed}：${g.error}`);
      }
    });
  };

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

      {/* P0-1 一票否决汇总条；P2-2 口径：判定 = min(条款门禁, 盈利, 流量门)，三条腿中最弱的一条决定判定。 */}
      {vetoReasons.length > 0 ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-5" role="alert">
          <p className="text-base font-bold text-red-800">{w.vetoBanner.titleRed}</p>
          <p className="mt-1 text-xs text-red-700">{w.vetoBanner.caliber}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
            {vetoReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : vetoUnknowns.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <p className="text-base font-bold text-amber-800">{w.vetoBanner.titleYellow}</p>
          <p className="mt-1 text-xs text-amber-700">{w.vetoBanner.caliber}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {vetoUnknowns.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

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

      {/* Step ① demand gate: 先看有没有量，没量不用往下走 */}
      <StepCard
        n={1}
        title={`① ${w.steps.demand}`}
        hint={w.stepHint.demand}
        status={demandGateStatus}
        statusLabel={statusText(demandGateStatus)}
        open={openStep === 1}
        onToggle={() => toggleStep(1)}
      >
        <DemandGateStep
          onChange={setDemandGateState}
          initialValues={demandGateState?.inputs}
          offerId={offer?.id ?? null}
          offerName={offer?.name ?? ""}
          offerDescription={offer ? `${offer.name} ${offer.network}` : ""}
          isAmazon={offer?.source === "amazon"}
          key={offer?.id ?? "manual"}
        />

        {/* P0-1：流量门检测（与需求验证同属第 ① 步“有没有量”，但判定口径不同：
            流量门看官网/品牌/关键词热度三信号，unknown 不判 fail）。 */}
        <div className="mt-5 border-t border-ink/10 pt-4">
          {!trafficGate && !trafficGateLoading ? (
            <div>
              <button
                type="button"
                onClick={() => runTrafficGateCheck()}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/85"
              >
                {w.trafficGate.checkButton}
              </button>
              <p className="mt-1.5 text-xs text-ink/55">{w.trafficGate.checkHint}</p>
            </div>
          ) : null}
          {trafficGateError ? (
            <p className="mt-2 text-sm text-red-600">{trafficGateError}</p>
          ) : null}
          {trafficGate || trafficGateLoading ? (
            <TrafficGateCard
              gate={trafficGate}
              loading={trafficGateLoading}
              dict={w.trafficGate}
              onRecheck={(input) => runTrafficGateCheck(input)}
              recheckBusy={trafficGateLoading}
            />
          ) : null}
        </div>
      </StepCard>

      {/* Step ② terms */}
      <StepCard
        n={2}
        title={`② ${w.steps.terms}`}
        hint={w.stepHint.terms}
        status={termsStatus}
        statusLabel={statusText(termsStatus)}
        open={openStep === 2}
        onToggle={() => toggleStep(2)}
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

      {/* Step ③ compliance */}
      <StepCard
        n={3}
        title={`③ ${w.steps.compliance}`}
        hint={w.stepHint.compliance}
        status={complianceStatus}
        statusLabel={statusText(complianceStatus)}
        open={openStep === 3}
        onToggle={() => toggleStep(3)}
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

      {/* Step ④ profit */}
      <StepCard
        n={4}
        title={`④ ${w.steps.profit}`}
        hint={w.stepHint.profit}
        status={profitStatus}
        statusLabel={statusText(profitStatus)}
        open={openStep === 4}
        onToggle={() => toggleStep(4)}
        extraBadge={
          profitState && profitState.isEstimated !== false
            ? t.ai.profit.estimatedBadge
            : null
        }
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

      {/* Step ⑤ traffic */}
      <StepCard
        n={5}
        title={`⑤ ${w.steps.traffic}`}
        hint={w.stepHint.traffic}
        status={trafficDone ? "pass" : null}
        statusLabel={trafficDone ? w.status.pass : w.status.pending}
        open={openStep === 5}
        onToggle={() => toggleStep(5)}
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
          {[demandReason, termsReason, complianceReason, profitReason, trafficReason].map((r, i) => (
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
