"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import OfferLinks from "@/components/entities/offer-links";
import { calcProfit, ASSUMED_CLICKS_TO_ORDER, clicksToOrderFromCvr, normalizeReturnRatio, suggestCpcByClicksToOrder } from "@/lib/profit-calc";
import { getLastOfferId, getManualOffer, setLastOfferId, setManualOffer } from "@/lib/current-offer";
import {
  evaluateDemandGate,
  type DemandGateKeyword,
} from "@/lib/demand-gate";
/* 关键词结论：verdict 口径唯一来源是需求验证页（/keywords/starter），工作表只消费结论。 */
import { verdictOf, type DemandRow } from "@/components/keywords/demand-check-client";
/* 一票否决 min 口径：唯一实现（与 blueprint §7 共用）。 */
import {
  leg,
  synthesizeVerdict,
  type VerdictLegs,
} from "../../../../../packages/shared/src/verdict";
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
/* 初筛（零成本杀法则）：纯逻辑 + server actions。 */
import {
  initialPrescreenRows,
  evaluateCommissionPrescreen,
  evaluatePaidZeroPrescreen,
  prescreenOverall,
  type PrescreenRowId,
  type PrescreenRowState,
  type PrescreenRowStatus,
} from "@/lib/prescreen";
import {
  checkOfferBlacklistAction,
  getPaidZeroThresholdsAction,
} from "@/lib/api/prescreen-actions";
import { useI18n } from "@/i18n/I18nProvider";

export type WorksheetSource = "affiliate" | "amazon" | "cashback";
export type StepStatus = "pass" | "warn" | "fail" | null;

export interface WorksheetOffer {
  id: string;
  name: string;
  network: string;
  destinationUrl: string;
  /** 联盟链接：联盟后台给的带参跟踪链接（可空）。 */
  affiliateUrl?: string | null;
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

/** 初筛行状态徽标：kill 红 / caution 黄 / pass 绿 / unknown 灰 / idle 浅灰。 */
function prescreenBadge(s: PrescreenRowStatus): string {
  if (s === "pass") return "bg-green-100 text-green-800";
  if (s === "kill") return "bg-red-100 text-red-800";
  if (s === "caution") return "bg-amber-100 text-amber-800";
  if (s === "unknown") return "bg-ink/10 text-ink/50";
  return "bg-ink/5 text-ink/40";
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
    /** 目标产出比 r = 产出 / 投入（投 1 产出 r，利润 r − 1）。如 1.5 = 投 1 产出 1.5、利润 0.5；1 = 保平。 */
    targetReturnRatio: string;
    /** 旧快照：目标 ROI %（已废弃，读旧快照时换算：比值 = 1 + ROI% / 100）。 */
    targetRoiPct?: string;
  };
}

/** 旧快照迁移：目标 ROI% → 目标产出比（@/lib/profit-calc 的 normalizeReturnRatio）。 */

function ProfitStep({
  onChange,
  initialPayout,
  initialMode,
  initialAvgPrice,
  initialCommissionRate,
  initialValues,
  offerId,
  syncInputs,
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
  /**
   * ⑤→④ 同步：投流页改了盈利输入后覆盖本步对应字段（最后一次编辑优先）。
   * 与快照恢复的“只补空”不同，这里是显式同步，必须覆盖；seq 变化才应用一次。
   */
  syncInputs?: { inputs: NonNullable<ProfitStepState["inputs"]>; seq: number } | null;
}) {
  const t = useDict();
  const d = t.ai.profit;
  const w = t.ai.worksheet.profitStep;

  const [mode, setMode] = useState<ProfitMode>(initialValues?.mode ?? initialMode ?? "ecommerce");
  const [avgPrice, setAvgPrice] = useState(initialValues?.avgPrice ?? initialAvgPrice ?? "");
  const [commissionRate, setCommissionRate] = useState(
    initialValues?.commissionRate ?? initialCommissionRate ?? ""
  );
  const [targetReturnRatio, setTargetReturnRatio] = useState(() => normalizeReturnRatio(initialValues));
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
      if (initialValues.targetReturnRatio || initialValues.targetRoiPct)
        setTargetReturnRatio(normalizeReturnRatio(initialValues));
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

  /* ⑤→④ 同步：投流页改了盈利输入，覆盖本步对应字段（最后一次编辑优先）。
     CPC / 目标产出比投流页没有，不覆盖；来源标 planner（投流决策 ⑤）。 */
  useEffect(() => {
    if (!syncInputs) return;
    const inp = syncInputs.inputs;
    setMode(inp.mode);
    setAvgPrice(inp.avgPrice);
    setCommissionRate(inp.commissionRate);
    setPayout(inp.payout);
    setCvrPct(inp.cvrPct);
    setRefundPct(inp.refundPct);
    setShavePct(inp.shavePct);
    setFieldProv("avgPrice", "planner");
    setFieldProv("commissionRate", "planner");
    setFieldProv("payout", "planner");
    setFieldProv("cvrPct", "planner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncInputs]);

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
    const ratio = parseFloat(targetReturnRatio);
    return calcProfit({
      payout: p,
      cpc: c,
      cvrF: cvr / 100,
      // 电商扣退货、不扣量；其他扣量、不算退货
      refundF: mode === "ecommerce" ? pct(refundPct) : 0,
      shaveF: mode === "other" ? pct(shavePct) : 0,
      targetReturnRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : 2,
      inputsEstimated: isEstimated,
    });
  }, [derivedPayout, cpc, cvrPct, refundPct, shavePct, mode, targetReturnRatio, isEstimated]);

  /* 按期望 ROI 反推 CPC：不依赖已填 CPC，只用 payout/CVR/退货/扣量/目标 ROI。 */
  const reverseCpc = useMemo(() => {
    const p = parseFloat(derivedPayout);
    const cvr = parseFloat(cvrPct);
    if (!(p > 0) || !(cvr > 0) || cvr >= 100) return null;
    const pct = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 0;
    };
    const ratio = parseFloat(targetReturnRatio);
    const r = calcProfit({
      payout: p,
      cpc: 0,
      cvrF: cvr / 100,
      refundF: mode === "ecommerce" ? pct(refundPct) : 0,
      shaveF: mode === "other" ? pct(shavePct) : 0,
      targetReturnRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : 2,
      inputsEstimated: isEstimated,
    });
    return r.maxCpcAtTargetRatio;
  }, [derivedPayout, cvrPct, refundPct, shavePct, mode, targetReturnRatio, isEstimated]);

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
        targetReturnRatio,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const derivedFromPrice =
    parseFloat(avgPrice) > 0 && parseFloat(commissionRate) > 0;

  /* P1-1 — 建议 CPC 双公式并列（补充，不改 K3 公式）：
     A = 价格 × 佣金比例 ÷ 预期点击出单数；分母优先用实测 CVR（1 ÷ CVR），
     无实测时用讲师假设 50 并打估算角标；用户可手改分母。
     B = EPC ÷ 目标产出比，即 result.maxCpcAtTargetRatio（K3 公式本身不动）。 */
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
              {w.deriveCpcFromRatio}：{fmt(reverseCpc, 4)}
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
          <label className={labelClass} htmlFor="ws-target-ratio">{w.targetReturnRatioLabel}</label>
          <input id="ws-target-ratio" inputMode="decimal" value={targetReturnRatio}
            onChange={(e) => setTargetReturnRatio(e.target.value)} placeholder="2" className={inputClass} />
        </div>
      </div>

      {result ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["EPC", `EPC = payout × CVR`, fmt(result.epc)],
              [w.breakEvenCpc, w.breakEvenCpcFormula, result.breakEvenCpc !== null ? fmt(result.breakEvenCpc, 4) : "—"],
              [w.maxCpcAtTargetRatio, w.maxCpcAtTargetRatioFormula, result.maxCpcAtTargetRatio !== null ? fmt(result.maxCpcAtTargetRatio, 4) : "—"],
              [w.perClickProfit, w.perClickProfitFormula, `${result.perClickProfit > 0 ? "+" : ""}${fmt(result.perClickProfit)}`],
              [d.results.breakEvenCvr, d.formulas.breakEvenCvr, result.breakEvenCvrPct !== null ? `${fmt(result.breakEvenCvrPct)}%` : "—"],
              [w.currentReturnRatio, w.currentReturnRatioFormula, result.returnRatioAtCpc !== null ? `${fmt(result.returnRatioAtCpc, 2)}（赚 ${fmt(result.returnRatioAtCpc - 1, 2)}）` : "—"],
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
                {result?.maxCpcAtTargetRatio !== null && result?.maxCpcAtTargetRatio !== undefined
                  ? fmt(result.maxCpcAtTargetRatio, 4)
                  : "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-ink/45">{w.formulaBFormula}</p>
              <p className="mt-3 text-xs text-ink/55">
                {w.formulaBSource.replaceAll("{ratio}", targetReturnRatio || "2")}
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
  isAmazon,
}: {
  onChange: (s: DemandGateState | null) => void;
  initialValues?: DemandGateState["inputs"];
  offerId?: string | null;
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
  /* 关键词只从需求验证页快照读（查/选/改都在 /keywords/starter 做，工作表只消费结论）。
     行里带 volume/competition/intent/trend，供 verdictOf 算结论。 */
  const [kwRows, setKwRows] = useState<DemandRow[]>([]);
  const snapshotAppliedRef = useRef(false);

  /* 快照晚到：只填空字段（域名/亚马逊输入区）。关键词结论只从需求验证页快照读，
     不再合并工作表旧快照的 judgments（旧版内嵌 AI 判断已下线）。 */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  /* 关键词结论：从需求验证页快照取全行（page key = keyword-research）。
     verdict 口径唯一来源是那页的 verdictOf，这里只读。 */
  useEffect(() => {
    if (!offerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await loadWorkStateAction("keyword-research", offerId);
        if (cancelled || !res.ok || !res.data.state) return;
        const rows = (res.data.state.rows ?? []) as Partial<DemandRow>[];
        const incoming = rows
          .filter((r) => r && typeof r.keyword === "string" && r.keyword.trim())
          .map((r) => ({
            id: typeof r.id === "string" ? r.id : r.keyword!.trim(),
            keyword: r.keyword!.trim(),
            volume: typeof r.volume === "string" ? r.volume : "",
            trend: r.trend === "up" || r.trend === "down" ? r.trend : ("flat" as const),
            competition: r.competition === "low" || r.competition === "high" ? r.competition : ("medium" as const),
            intent: r.intent === "review" || r.intent === "compare" || r.intent === "info" ? r.intent : ("buy" as const),
          }));
        if (incoming.length === 0) return;
        setKwRows(incoming);
      } catch {
        /* 取不到就不填 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  /* 关键词 verdict 口径唯一来源：需求验证页的 verdictOf（good/caution 算相关，bad 不算）。
     工作表不再内嵌 AI 判断关键词相关性——查/选/判都在 /keywords/starter。 */
  const gateKeywords: DemandGateKeyword[] = useMemo(
    () =>
      kwRows.map((r) => ({
        keyword: r.keyword,
        volume: (() => {
          const n = parseFloat(r.volume);
          return Number.isFinite(n) && n >= 0 ? n : null;
        })(),
        relevant: verdictOf(r) !== "bad",
      })),
    [kwRows]
  );

  /* 结论卡统计：值得跟进 / 谨慎 / 放弃。 */
  const verdictCounts = useMemo(() => {
    let good = 0;
    let caution = 0;
    let bad = 0;
    for (const r of kwRows) {
      const v = verdictOf(r);
      if (v === "good") good += 1;
      else if (v === "caution") caution += 1;
      else bad += 1;
    }
    return { good, caution, bad };
  }, [kwRows]);

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
    /* judgments 快照形状保持兼容：relevant 来自需求验证页 verdict（good/caution=相关），
       reason 写 verdict 档位，供给流量门取词等下游使用。 */
    const judged = kwRows.map((row) => {
      const v = verdictOf(row);
      const volume = (() => {
        const n = parseFloat(row.volume);
        return Number.isFinite(n) && n >= 0 ? String(n) : "";
      })();
      return {
        keyword: row.keyword,
        volume,
        relevant: v !== "bad",
        reason: v,
      };
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

      {/* 关键词结论卡：查/选/改只在 /keywords/starter 做，这里只消费 verdictOf 结论。 */}
      <div className="mt-4 rounded-lg border border-ink/10 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            {g.keywordsConclusionTitle} ({kwRows.length})
          </p>
          <Link
            href={`/keywords/starter?tab=research&offerId=${encodeURIComponent(offerId)}`}
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/85"
          >
            {g.goKeywords} →
          </Link>
        </div>
        {kwRows.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55">{g.noKeywords}</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">
                ✅ {g.kwVerdictGood} {verdictCounts.good}
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">
                ⚠️ {g.kwVerdictCaution} {verdictCounts.caution}
              </span>
              <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">
                ❌ {g.kwVerdictBad} {verdictCounts.bad}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink/55">{g.keywordsConclusionHint}</p>
          </>
        )}
      </div>

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
  /** 明确采用 offer 的次数：库里选择 / 手动应用 / 清除时 +1，传给 ④ 作 key 强制重挂。
      ④ 不能只看 initialOffer 的 id 判切换——手动 offer 的 id 永远是 ""，手动 A→手动 B
      会被误判为"没切换"而残留旧数据；也不能看名字，打字改名时 key 每敲一字母就变。
      只有明确采用时才 +1，打字改名不触发。 */
  const [offerSession, setOfferSession] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mNetwork, setMNetwork] = useState("");
  const [mUrl, setMUrl] = useState("");
  /** 手动 offer 的联盟链接（选填）。 */
  const [mAffUrl, setMAffUrl] = useState("");

  const applyManualOffer = () => {
    const name = mName.trim();
    if (!name) return;
    // 手动采用也是切 offer：清空旧 offer 的步骤结果，避免残留/污染新 offer（与库里选择一致）。
    setTermsVerdict(null);
    setComplianceResults(null);
    setComplianceCounted(true);
    setProfitState(null);
    setTrafficResult(null);
    setOffer({
      id: "",
      name,
      network: mNetwork.trim(),
      destinationUrl: mUrl.trim(),
      affiliateUrl: mAffUrl.trim() || null,
    });
    setOfferSession((n) => n + 1);
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
        affiliateUrl: offer.affiliateUrl ?? "",
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
        affiliateUrl: mAffUrl.trim(),
      });
      setLastOfferId(null);
    }
  }, [offer, mName, mNetwork, mUrl, mAffUrl]);

  const [termsVerdict, setTermsVerdict] = useState<"go" | "caution" | "stop" | null>(null);
  const [complianceResults, setComplianceResults] = useState<AiUrlCheckResult[] | null>(null);
  const [complianceCounted, setComplianceCounted] = useState(true);
  const [demandGateState, setDemandGateState] = useState<DemandGateState | null>(null);
  const [profitState, setProfitState] = useState<ProfitStepState | null>(null);
  /* ⑤→④ 同步：投流页改了盈利输入后，覆盖 ④ 的对应字段（ProfitStep 用 syncInputs 应用）。
     ④ 还没算过时先记到 profitSyncPending，ProfitStep 挂载时作为 initialValues 补进空字段。 */
  const [profitSync, setProfitSync] = useState<{
    inputs: NonNullable<ProfitStepState["inputs"]>;
    seq: number;
  } | null>(null);
  const [profitSyncPending, setProfitSyncPending] = useState<
    NonNullable<ProfitStepState["inputs"]> | null
  >(null);
  const profitSyncSeqRef = useRef(0);
  const handlePlannerProfitChange = useCallback(
    (inputs: {
      payout: string;
      cvr: string;
      refundRate: string;
      shavePct: string;
      avgPrice: string;
      commissionRate: string;
      profitMode: "ecommerce" | "affiliate";
    }) => {
      const merged: NonNullable<ProfitStepState["inputs"]> = {
        payout: inputs.payout,
        cpc: profitState?.inputs?.cpc ?? "",
        cvrPct: inputs.cvr,
        refundPct: inputs.refundRate,
        shavePct: inputs.shavePct,
        mode: inputs.profitMode === "ecommerce" ? "ecommerce" : "other",
        avgPrice: inputs.avgPrice,
        commissionRate: inputs.commissionRate,
        targetReturnRatio: profitState?.inputs?.targetReturnRatio ?? "2",
      };
      const cur = profitState?.inputs;
      if (
        cur &&
        cur.payout === merged.payout &&
        cur.cvrPct === merged.cvrPct &&
        cur.refundPct === merged.refundPct &&
        cur.shavePct === merged.shavePct &&
        cur.avgPrice === merged.avgPrice &&
        cur.commissionRate === merged.commissionRate &&
        cur.mode === merged.mode
      )
        return; // 等值跳过，防回环
      if (!profitState) {
        /* ④ 还没算过：只有填了真实值才记（mode 恒有值、扣量默认 0 都不算）。 */
        if (
          [merged.payout, merged.cvrPct, merged.refundPct, merged.avgPrice, merged.commissionRate].some(
            (v) => String(v).trim(),
          )
        )
          setProfitSyncPending(merged);
        return;
      }
      setProfitState({ ...profitState, inputs: merged });
      profitSyncSeqRef.current += 1;
      setProfitSync({ inputs: merged, seq: profitSyncSeqRef.current });
    },
    [profitState],
  );
  /* P0-1：流量门（TrafficGate，K4）检测结果。passed 三态：true 通过 /
     false 不通过 / null unknown（暂无数据，绝不判 fail）。 */
  const [trafficGate, setTrafficGate] = useState<TrafficGate | null>(null);
  const [trafficGateLoading, setTrafficGateLoading] = useState(false);
  const [trafficGateError, setTrafficGateError] = useState<string | null>(null);
  const gateSeq = useRef(0);
  /* 初筛（零成本杀法则）：4 条确定性规则按顺序跑，命中 kill 直接停。
     位置：第 ① 步最顶部，流量门区之上。 */
  const [prescreenRows, setPrescreenRows] = useState<PrescreenRowState[]>(() =>
    initialPrescreenRows(),
  );
  const [prescreenRunning, setPrescreenRunning] = useState(false);
  const [prescreenError, setPrescreenError] = useState<string | null>(null);
  const prescreenSeq = useRef(0);
  /** SEMrush 三字段：从流量门手动区上报（同一 state，不另加输入框）。 */
  const [semrushInputs, setSemrushInputs] = useState<{
    organicTraffic?: number;
    paidTraffic?: number;
    paidKeywords?: number;
  }>({});
  /* 初筛纯函数的中英文：跟随当前语言。 */
  let prescreenLang: "zh" | "en" = "zh";
  try {
    prescreenLang = useI18n().lang === "en" ? "en" : "zh";
  } catch {
    prescreenLang = "zh";
  }
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
                affiliateUrl: manual.affiliateUrl || null,
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

  /* P0-1 一票否决汇总条；P2-2 口径：判定 = min(条款门禁, 盈利, 流量门, 初筛)，
     min 逻辑走 packages/shared#synthesizeVerdict（与 blueprint §7 同一套，不许另写一遍）。
     初筛 kill 直接作为 prescreen 腿传入（stop）；三档横幅（红/琥珀/黄）与原行为一致。
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

  const vetoLegs: VerdictLegs = {
    terms:
      termsVerdict === "stop"
        ? leg("stop", w.vetoBanner.termsStop)
        : termsVerdict === null
          ? leg("unknown", w.vetoBanner.termsUnknown)
          : leg("go"),
    profit: profitVeto
      ? leg(
          "stop",
          w.vetoBanner.profitEpc
            .replace("{epc}", fmt(profitVeto.epc))
            .replace("{cpc}", fmt(profitVeto.cpc))
        )
      : profitState === null
        ? leg("unknown", w.vetoBanner.profitUnknown)
        : leg("go"),
    trafficGate:
      trafficGate?.passed === false
        ? leg("stop", w.vetoBanner.trafficGateFail.replace("{reason}", trafficGate.reason))
        : trafficGate?.caution
          ? leg("caution", trafficGate.caution)
          : trafficGate === null || trafficGate.passed === null
            ? leg("unknown", w.vetoBanner.trafficGateUnknown)
            : leg("go"),
    /* 初筛 kill：视为综合项 fail，直接进一票否决红条（与条款 DO_NOT_RUN /
       盈利 EPC≤CPC / 流量门 fail 同级），并提示不用往下做 AI 深判。 */
    prescreen: (() => {
      const killRow = prescreenRows.find((r) => r.status === "kill");
      return killRow
        ? leg("stop", w.prescreen.vetoReason.replace("{reason}", killRow.reason))
        : leg("go");
    })(),
  };
  const vetoSynth = synthesizeVerdict(vetoLegs);
  const vetoReasons = vetoSynth.verdict === "stop" ? vetoSynth.reasons : [];
  /* 流量门 caution 档（有数据支撑的警告，非否决）：单独琥珀条展示，
     不进红条（不 kill），优先级低于一票否决、高于"未确认项"。 */
  const cautionReasons = vetoSynth.verdict === "caution" ? vetoSynth.reasons : [];
  const vetoUnknowns = vetoSynth.verdict === "unknown" ? vetoSynth.reasons : [];

  const toggleStep = (n: number) => setOpenStep((o) => (o === n ? 0 : n));

  /* P0-1：流量门检测（第 ① 步内）。brand 取 Offer 名；domain 取 Offer URL 的
     hostname；keywords 取需求验证里已填的 SEMrush 关键词（前 5 个）。
     extra 可带手动值：品牌名 / 手动月访问量 / SEMrush 域名概览三字段。
     返回检测结果（供初筛第 4 条复用；同时照常落到下方流量门卡片）。 */
  const fetchTrafficGate = (extra?: {
    brand?: string;
    manualMonthlyVisits?: number;
    organicTraffic?: number;
    paidTraffic?: number;
    paidKeywords?: number;
  }): Promise<TrafficGate | null> => {
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
    return checkTrafficGateAction({
      brand,
      domain,
      keywords,
      manualMonthlyVisits: extra?.manualMonthlyVisits,
      organicTraffic: extra?.organicTraffic,
      paidTraffic: extra?.paidTraffic,
      paidKeywords: extra?.paidKeywords,
    }).then((g) => {
      if (seq !== gateSeq.current) return null;
      setTrafficGateLoading(false);
      if (g.ok) {
        setTrafficGate(g.data);
        return g.data;
      }
      setTrafficGateError(`${w.trafficGate.checkFailed}：${g.error}`);
      return null;
    });
  };

  const runTrafficGateCheck = (extra?: {
    brand?: string;
    manualMonthlyVisits?: number;
    organicTraffic?: number;
    paidTraffic?: number;
    paidKeywords?: number;
  }) => {
    void fetchTrafficGate(extra);
  };

  /* 初筛一键跑：4 条零成本杀法则按顺序执行，任一 kill 立即停（不跑后面的，
     省无用功）。kill 行直接进顶部一票否决红条（见 vetoReasons），并提示
     不用往下做 AI 深判。 */
  const runPrescreen = () => {
    const seq = ++prescreenSeq.current;
    const alive = () => seq === prescreenSeq.current;
    setPrescreenRunning(true);
    setPrescreenError(null);
    const rows = initialPrescreenRows();
    const setRow = (
      id: PrescreenRowId,
      status: PrescreenRowStatus,
      reason: string,
    ) => {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.status = status;
        r.reason = reason;
      }
      if (alive()) setPrescreenRows(rows.map((x) => ({ ...x })));
    };
    const finish = () => {
      if (alive()) setPrescreenRunning(false);
    };
    (async () => {
      try {
        // ① 黑名单：有 offerId 才调接口；手动 offer（未入库）标 unknown，不杀。
        if (offer?.id) {
          const bl = await checkOfferBlacklistAction(offer.id);
          if (!alive()) return;
          if (bl.ok && bl.blacklisted) {
            setRow(
              "blacklist",
              "kill",
              w.prescreen.blacklisted.replace("{reason}", bl.reason ?? ""),
            );
            finish();
            return;
          }
          if (!bl.ok) {
            // 接口失败：fail-soft，标 unknown 不杀。
            setRow(
              "blacklist",
              "unknown",
              `${w.prescreen.blacklistError}：${bl.error}`,
            );
          } else {
            setRow("blacklist", "pass", w.prescreen.blacklistPass);
          }
        } else {
          setRow("blacklist", "unknown", w.prescreen.blacklistManual);
        }
        // ② $8 佣金门槛：payout 已知且 < $8 → kill；未知不杀。
        // 百分比佣金 offer 额外传佣金率 × 均价，与后端入库门槛同口径估算。
        const cm = evaluateCommissionPrescreen(
          initialPayout,
          prescreenLang,
          undefined,
          {
            ratePct:
              offer?.commissionType === "percentage"
                ? Number(offer.commissionValue)
                : undefined,
            price:
              offer?.avgPrice != null ? Number(offer.avgPrice) : undefined,
          },
        );
        if (!alive()) return;
        setRow("commission", cm.status, cm.reason);
        if (cm.status === "kill") {
          finish();
          return;
        }
        // ③ 付费为零规则：阈值走后端配置；kill 才停，caution/unknown 继续。
        const th = await getPaidZeroThresholdsAction();
        if (!alive()) return;
        const pz = evaluatePaidZeroPrescreen(
          semrushInputs.organicTraffic,
          semrushInputs.paidTraffic,
          semrushInputs.paidKeywords,
          th.organicTrafficMin,
          th.paidTrafficWarnRatio,
          prescreenLang,
        );
        setRow("paidZero", pz.status, pz.reason);
        if (pz.status === "kill") {
          finish();
          return;
        }
        // ④ 流量门免费档：复用现有检测（SEMrush 三字段读手动区同一 state）；
        // 结果同时落到下方流量门卡片，不重复调接口。
        const g = await fetchTrafficGate({
          organicTraffic: semrushInputs.organicTraffic,
          paidTraffic: semrushInputs.paidTraffic,
          paidKeywords: semrushInputs.paidKeywords,
        });
        if (!alive()) return;
        if (!g) {
          // 检测失败（网络/服务端错误）：fail-soft，标 unknown 不杀。
          setRow("trafficGate", "unknown", w.prescreen.gateError);
        } else if (g.passed === true) {
          if (g.caution) {
            setRow("trafficGate", "caution", g.caution);
          } else {
            setRow("trafficGate", "pass", w.prescreen.gatePass);
          }
        } else if (g.passed === false) {
          setRow("trafficGate", "kill", g.reason);
        } else {
          setRow("trafficGate", "unknown", w.prescreen.gateUnknown);
        }
        finish();
      } catch (e) {
        if (alive()) {
          setPrescreenError(e instanceof Error ? e.message : String(e));
          setPrescreenRunning(false);
        }
      }
    })();
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

      {/* P0-1 一票否决汇总条；P2-2 口径：判定 = min(条款门禁, 盈利, 流量门, 初筛)，四条腿中最弱的一条决定判定。 */}
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
      ) : cautionReasons.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5" role="alert">
          <p className="text-base font-bold text-amber-800">{w.vetoBanner.titleCaution}</p>
          <p className="mt-1 text-xs text-amber-700">{w.vetoBanner.caliber}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {cautionReasons.map((r, i) => (
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
                  {" · "}
                  <OfferLinks
                    affiliateUrl={offer.affiliateUrl}
                    destinationUrl={offer.destinationUrl}
                  />
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
              setOfferSession((n) => n + 1);
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
                setOfferSession((n) => n + 1);
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
            <div className="flex items-center gap-2">
              <input
                value={mAffUrl}
                onChange={(e) => setMAffUrl(e.target.value)}
                placeholder="联盟链接（选填）"
                className="flex-1 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
              />
              {mAffUrl.trim() ? (
                <a
                  href={mAffUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20"
                >
                  ↗ 直达
                </a>
              ) : null}
            </div>
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
        {/* 初筛（零成本杀法则）：第 ① 步最顶部，流量门区之上。
            4 条确定性规则按顺序跑，命中 kill 直接停，不浪费 AI 深判。 */}
        <div className="mb-5 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">{w.prescreen.title}</h3>
            <button
              type="button"
              onClick={runPrescreen}
              disabled={prescreenRunning}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/85 disabled:opacity-50"
            >
              {prescreenRunning ? w.prescreen.running : w.prescreen.runButton}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink/55">{w.prescreen.hint}</p>
          <ul className="mt-3 space-y-2">
            {prescreenRows.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${prescreenBadge(r.status)}`}
                >
                  {w.prescreen.status[r.status]}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-ink">
                    {w.prescreen.rows[r.id]}
                  </span>
                  {r.reason ? (
                    <span className="block text-xs text-ink/60">{r.reason}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {prescreenError ? (
            <p className="mt-2 text-sm text-red-600">{prescreenError}</p>
          ) : null}
          {prescreenOverall(prescreenRows) === "kill" ? (
            <div
              className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3"
              role="alert"
            >
              <p className="text-sm font-bold text-red-800">
                {w.prescreen.killTitle}
              </p>
              <p className="mt-1 text-xs text-red-700">{w.prescreen.killHint}</p>
            </div>
          ) : null}
          {prescreenOverall(prescreenRows) === "pass" ? (
            <div className="mt-3 rounded-lg border border-green-300 bg-green-50 p-3">
              <p className="text-sm font-bold text-green-800">
                {w.prescreen.passTitle}
              </p>
              <button
                type="button"
                onClick={() => setOpenStep(2)}
                className="mt-2 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
              >
                {w.prescreen.goStep2}
              </button>
            </div>
          ) : null}
          {prescreenOverall(prescreenRows) === "pending" &&
          prescreenRows.some((r) => r.status !== "idle") ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">{w.prescreen.pendingHint}</p>
            </div>
          ) : null}
        </div>

        {/* P0-1：流量门检测（第 ① 步内，初筛卡片之下）：先看到流量门，再看关键词；
            与需求验证同属"有没有量"，但判定口径不同：
            流量门看官网/品牌/关键词热度三信号，unknown 不判 fail）。
            手动点检测（配额考虑，不自动跑）。 */}
        <div className="mb-5 border-b border-ink/10 pb-4">
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
              onManualInputChange={setSemrushInputs}
              recheckBusy={trafficGateLoading}
            />
          ) : null}
        </div>

        <DemandGateStep
          onChange={setDemandGateState}
          initialValues={demandGateState?.inputs}
          offerId={offer?.id ?? null}
          isAmazon={offer?.source === "amazon"}
          key={offer?.id ?? "manual"}
        />
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
          initialValues={profitState?.inputs ?? profitSyncPending ?? undefined}
          syncInputs={profitSync}
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
          key={offerSession}
          showSetupNudge={false}
          hideHeader
          onResult={setTrafficResult}
          onProfitInputsChange={handlePlannerProfitChange}
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
