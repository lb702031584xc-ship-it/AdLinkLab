"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { getOfferPerformanceAction } from "@/lib/api/p1-actions";
import type { OfferPerformance } from "@/lib/api/p1";
import { analyzeProfitAction } from "@/lib/api/ai-actions";
import type { ProfitAnalysisResult } from "@/lib/api/profit-types";
import {
  ASSUMED_CLICKS_TO_ORDER,
  clicksToOrderFromCvr,
  suggestCpcByClicksToOrder,
} from "@/lib/profit-calc";

export interface ProfitOfferOption {
  id: string;
  name: string;
  network: string;
}

const DAYS_OPTIONS = [7, 14, 30] as const;
const CURRENCIES = ["USD", "CNY", "EUR", "GBP", "JPY"] as const;

function fmt(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-3">
      <p className="text-xs text-ink/55">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-ink">{value}</p>
      {sub ? <p className="text-xs text-ink/50">{sub}</p> : null}
    </div>
  );
}

export function ProfitClient({ offers }: { offers: ProfitOfferOption[] }) {
  const t = useDict();
  const d = t.ai.profit;

  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [days, setDays] = useState<number>(30);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [stats, setStats] = useState<OfferPerformance | null>(null);

  const [payout, setPayout] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [cpc, setCpc] = useState("");
  const [refundPct, setRefundPct] = useState("");
  const [shavePct, setShavePct] = useState("");
  const [epc, setEpc] = useState("");
  /** P0-2：默认不勾选 = 估算；勾选 = 本次测算用实测数据。 */
  const [useMeasured, setUseMeasured] = useState(false);
  const isEstimated = !useMeasured;

  // (d) bid suggestions with commission ranges
  const [bidMode, setBidMode] = useState<"fixed" | "range">("fixed");
  const [bidFixed, setBidFixed] = useState("");
  const [bidPriceMin, setBidPriceMin] = useState("");
  const [bidPriceMax, setBidPriceMax] = useState("");
  const [bidPctMin, setBidPctMin] = useState("");
  const [bidPctMax, setBidPctMax] = useState("");
  const [bidCvr, setBidCvr] = useState("");
  const [bidResult, setBidResult] = useState<ProfitAnalysisResult | null>(null);
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  /** P1-1：双公式输入（仅价格 × 比例区间模式）。 */
  const [dualCtoOverride, setDualCtoOverride] = useState("");
  const [dualTargetReturnRatio, setDualTargetReturnRatio] = useState("2");

  async function runBidAnalysis() {
    const cvr = parseFloat(bidCvr);
    if (!Number.isFinite(cvr) || cvr <= 0) {
      setBidError(d.bidCvrRequiredHint);
      return;
    }
    setBidLoading(true);
    setBidError(null);
    try {
      const res = await analyzeProfitAction({
        fixedAmount: bidMode === "fixed" ? parseFloat(bidFixed) || null : null,
        priceMin: bidMode === "range" ? parseFloat(bidPriceMin) || null : null,
        priceMax: bidMode === "range" ? parseFloat(bidPriceMax) || null : null,
        commissionPctMin: bidMode === "range" ? parseFloat(bidPctMin) || null : null,
        commissionPctMax: bidMode === "range" ? parseFloat(bidPctMax) || null : null,
        currency,
        assumedCvrPct: cvr,
      });
      if (!res.ok) {
        setBidError(res.error);
        return;
      }
      setBidResult(res.data.analysis);
    } catch (e) {
      setBidError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setBidLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function loadStats() {
    if (!offerId) return;
    setLoadingStats(true);
    setStatsError(null);
    try {
      const res = await getOfferPerformanceAction(offerId, days);
      if (res.ok) {
        setStats(res.data);
        if (res.data.epc !== null) setEpc(String(res.data.epc));
        if (res.data.refundRatePct !== null)
          setRefundPct(String(res.data.refundRatePct));
      } else {
        setStatsError(res.error);
      }
    } finally {
      setLoadingStats(false);
    }
  }

  // ---- calculator (client-side) ----
  const payoutN = parseFloat(payout);
  const cpcN = parseFloat(cpc);
  const refundN = parseFloat(refundPct);
  const shaveN = parseFloat(shavePct);
  const epcN = parseFloat(epc);

  const hasPayout = Number.isFinite(payoutN) && payoutN > 0;
  const refundF = Number.isFinite(refundN) ? Math.min(Math.max(refundN, 0), 100) / 100 : 0;
  const shaveF = Number.isFinite(shaveN) ? Math.min(Math.max(shaveN, 0), 100) / 100 : 0;
  const effectivePayout = hasPayout ? payoutN * (1 - refundF) * (1 - shaveF) : null;

  // CVR source: prefer stats CVR when loaded, else derive from EPC/payout.
  const statsCvrF =
    stats && stats.clicks > 0 ? stats.conversions / stats.clicks : null;
  const derivedCvrF =
    statsCvrF ?? (Number.isFinite(epcN) && hasPayout ? epcN / payoutN : null);
  const hasCpc = Number.isFinite(cpcN) && cpcN > 0;

  const breakEvenCvrPct =
    effectivePayout !== null && effectivePayout > 0 && hasCpc
      ? (cpcN / effectivePayout) * 100
      : null;
  const breakEvenCpc =
    derivedCvrF !== null && effectivePayout !== null
      ? derivedCvrF * effectivePayout
      : null;
  const maxCpc30 =
    breakEvenCpc !== null ? breakEvenCpc * 0.7 : null;

  // Test budget
  const budgetClicks =
    derivedCvrF !== null && derivedCvrF > 0 && derivedCvrF < 1
      ? Math.ceil((16 * (1 - derivedCvrF)) / derivedCvrF)
      : null;
  const budgetCost =
    budgetClicks !== null && hasCpc ? budgetClicks * cpcN : null;
  const ruleBudget = hasPayout ? 3 * payoutN : null;

  /* P1-1 — 建议 CPC 双公式并列（补充，不改 K3 公式；仅价格 × 比例区间模式）。
     A = 价格中值 × 佣金比例中值 ÷ 预期点击出单数；分母优先用填写的 CVR
     （1 ÷ CVR），未填时用讲师假设 50 并打估算角标；用户可手改分母。
     B = EPC ÷ (1 + 目标 ROI)，EPC = 区间佣金中值 × CVR。 */
  const bidPriceMid =
    bidMode === "range" &&
    Number.isFinite(parseFloat(bidPriceMin)) &&
    Number.isFinite(parseFloat(bidPriceMax))
      ? (parseFloat(bidPriceMin) + parseFloat(bidPriceMax)) / 2
      : null;
  const bidPctMid =
    bidMode === "range" &&
    Number.isFinite(parseFloat(bidPctMin)) &&
    Number.isFinite(parseFloat(bidPctMax))
      ? (parseFloat(bidPctMin) + parseFloat(bidPctMax)) / 2
      : null;
  const bidCvrNum = parseFloat(bidCvr);
  const dualCtoFromCvr =
    Number.isFinite(bidCvrNum) && bidCvrNum > 0 && bidCvrNum < 100
      ? clicksToOrderFromCvr(bidCvrNum / 100)
      : null;
  const dualCtoOverrideNum = parseFloat(dualCtoOverride);
  const dualEffectiveCto =
    Number.isFinite(dualCtoOverrideNum) && dualCtoOverrideNum > 0
      ? dualCtoOverrideNum
      : (dualCtoFromCvr ?? ASSUMED_CLICKS_TO_ORDER);
  const dualCtoSource =
    Number.isFinite(dualCtoOverrideNum) && dualCtoOverrideNum > 0
      ? "manual"
      : dualCtoFromCvr !== null
        ? "measured"
        : "assumed";
  const dualFormulaA =
    bidPriceMid !== null && bidPctMid !== null
      ? suggestCpcByClicksToOrder({
          price: bidPriceMid,
          commissionRatePct: bidPctMid,
          clicksToOrder: dualEffectiveCto,
        })
      : null;
  const dualEpc =
    bidPriceMid !== null &&
    bidPctMid !== null &&
    Number.isFinite(bidCvrNum) &&
    bidCvrNum > 0 &&
    bidCvrNum < 100
      ? bidPriceMid * (bidPctMid / 100) * (bidCvrNum / 100)
      : null;
  const dualRatioNum = parseFloat(dualTargetReturnRatio);
  const dualFormulaB =
    dualEpc !== null && Number.isFinite(dualRatioNum) && dualRatioNum > 0
      ? dualEpc / dualRatioNum
      : null;

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {/* (a) real-data backtest */}
      <h2 className="mt-8 text-base font-semibold text-ink">{d.statsTitle}</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass} htmlFor="profit-offer">
            {d.offerLabel}
          </label>
          <select
            id="profit-offer"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          >
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.network})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="profit-days">
            {d.daysLabel}
          </label>
          <select
            id="profit-days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          >
            {DAYS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 7 ? d.days.d7 : n === 14 ? d.days.d14 : d.days.d30}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={loadStats}
          disabled={loadingStats || !offerId}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {loadingStats ? d.loading : d.loadStats}
        </button>
      </div>

      {statsError ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {statsError}
        </p>
      ) : null}

      {stats ? (
        stats.clicks === 0 ? (
          <p className="mt-4 text-sm text-ink/55">{d.noData}</p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <StatCard label={d.cards.clicks} value={fmt(stats.clicks, 0)} />
            <StatCard
              label={d.cards.conversions}
              value={fmt(stats.conversions, 0)}
            />
            <StatCard label={d.cards.cvr} value={`${fmt(stats.cvrPct)}%`} />
            <StatCard
              label={d.cards.epc}
              value={stats.epc !== null ? fmt(stats.epc, 4) : "—"}
              sub={stats.revenueCurrency ?? undefined}
            />
            <StatCard
              label={d.cards.revenue}
              value={fmt(stats.revenue)}
              sub={stats.revenueCurrency ?? undefined}
            />
            <StatCard
              label={d.cards.refundRate}
              value={
                stats.refundRatePct !== null
                  ? `${fmt(stats.refundRatePct)}%`
                  : "—"
              }
            />
            <StatCard
              label={d.cards.orders}
              value={`${stats.ordersConfirmed}/${stats.ordersRefunded}`}
            />
          </div>
        )
      ) : null}

      {/* (b) calculator */}
      <h2 className="mt-8 text-base font-semibold text-ink">{d.calcTitle}</h2>
      <div className="mt-3 grid gap-4 rounded-xl border border-ink/10 bg-white/70 p-6 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="calc-payout">
            {d.payoutLabel}
          </label>
          <input
            id="calc-payout"
            inputMode="decimal"
            value={payout}
            onChange={(e) => setPayout(e.target.value)}
            placeholder="12.50"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-currency">
            {d.currencyLabel}
          </label>
          <select
            id="calc-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-cpc">
            {d.cpcLabel}
          </label>
          <input
            id="calc-cpc"
            inputMode="decimal"
            value={cpc}
            onChange={(e) => setCpc(e.target.value)}
            placeholder="0.80"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-refund">
            {d.refundRateLabel}
          </label>
          <input
            id="calc-refund"
            inputMode="decimal"
            value={refundPct}
            onChange={(e) => setRefundPct(e.target.value)}
            placeholder="5"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-shave">
            {d.shaveLabel}
          </label>
          <input
            id="calc-shave"
            inputMode="decimal"
            value={shavePct}
            onChange={(e) => setShavePct(e.target.value)}
            placeholder="10"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="calc-epc">
            {d.epcLabel}
          </label>
          <input
            id="calc-epc"
            inputMode="decimal"
            value={epc}
            onChange={(e) => setEpc(e.target.value)}
            placeholder="0.35"
            className={inputClass}
          />
        </div>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink/80">
        <input
          type="checkbox"
          checked={useMeasured}
          onChange={(e) => setUseMeasured(e.target.checked)}
          className="h-4 w-4 accent-ink"
        />
        {d.useMeasuredLabel}
      </label>

      {isEstimated ? (
        <p className="mt-3">
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            {d.estimatedBadge}
          </span>
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {(
          [
            [d.results.effectivePayout, d.formulas.effectivePayout, effectivePayout !== null ? `${fmt(effectivePayout)} ${currency}` : "—"],
            [d.results.breakEvenCvr, d.formulas.breakEvenCvr, breakEvenCvrPct !== null ? `${fmt(breakEvenCvrPct)}%` : "—"],
            [d.results.breakEvenCpc, d.formulas.breakEvenCpc, breakEvenCpc !== null ? `${fmt(breakEvenCpc, 4)} ${currency}` : "—"],
            [d.results.maxCpc30, d.formulas.maxCpc30, maxCpc30 !== null ? `${fmt(maxCpc30, 4)} ${currency}` : "—"],
          ] as const
        ).map(([label, formula, value]) => (
          <div
            key={label}
            className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4"
          >
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
            <p className="mt-1 font-mono text-xs text-ink/45">{formula}</p>
          </div>
        ))}
      </div>

      {/* (c) test budget */}
      <h2 className="mt-8 text-base font-semibold text-ink">{d.budgetTitle}</h2>
      <p className="mt-1 text-sm text-ink/60">{d.budgetDesc}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-ink/10 bg-white/70 p-5">
          <p className="text-sm font-semibold text-ink">{d.statMethod}</p>
          <p className="mt-1 font-mono text-xs text-ink/45">{d.statFormula}</p>
          {budgetClicks !== null ? (
            <div className="mt-3 flex gap-6">
              <div>
                <p className="text-xs text-ink/55">{d.budgetClicks}</p>
                <p className="text-xl font-semibold text-ink">
                  {fmt(budgetClicks, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink/55">{d.budgetCost}</p>
                <p className="text-xl font-semibold text-ink">
                  {budgetCost !== null ? `${fmt(budgetCost)} ${currency}` : "—"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink/55">{d.needCvr}</p>
          )}
        </div>
        <div className="rounded-xl border border-ink/10 bg-white/70 p-5">
          <p className="text-sm font-semibold text-ink">{d.ruleMethod}</p>
          <p className="mt-1 font-mono text-xs text-ink/45">{d.ruleFormula}</p>
          <p className="mt-3 text-xl font-semibold text-ink">
            {ruleBudget !== null ? `${fmt(ruleBudget)} ${currency}` : "—"}
          </p>
        </div>
      </div>

      {/* (d) bid suggestions */}
      <h2 className="mt-8 text-base font-semibold text-ink">出价建议</h2>
      <p className="mt-1 text-sm text-ink/60">
        输入佣金（固定金额，或价格区间 × 佣金百分比区间），系统计算预估佣金、盈亏平衡出价，并给出三档出价建议与盈亏场景。
      </p>
      <div className="mt-3 rounded-xl border border-ink/10 bg-white/70 p-6">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setBidMode("fixed")}
            className={`rounded-lg px-4 py-2 text-sm ${bidMode === "fixed" ? "bg-ink text-white" : "border border-ink/15"}`}
          >
            固定佣金
          </button>
          <button
            type="button"
            onClick={() => setBidMode("range")}
            className={`rounded-lg px-4 py-2 text-sm ${bidMode === "range" ? "bg-ink text-white" : "border border-ink/15"}`}
          >
            价格 × 比例区间
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {bidMode === "fixed" ? (
            <div>
              <label className={labelClass}>佣金金额（{currency}）</label>
              <input
                inputMode="decimal"
                value={bidFixed}
                onChange={(e) => setBidFixed(e.target.value)}
                placeholder="12.50"
                className={inputClass}
              />
            </div>
          ) : (
            <>
              <div>
                <label className={labelClass}>价格区间（{currency}）</label>
                <div className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={bidPriceMin}
                    onChange={(e) => setBidPriceMin(e.target.value)}
                    placeholder="最低价"
                    className={inputClass}
                  />
                  <span className="text-ink/50">~</span>
                  <input
                    inputMode="decimal"
                    value={bidPriceMax}
                    onChange={(e) => setBidPriceMax(e.target.value)}
                    placeholder="最高价"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>佣金百分比区间（%）</label>
                <div className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={bidPctMin}
                    onChange={(e) => setBidPctMin(e.target.value)}
                    placeholder="如 5"
                    className={inputClass}
                  />
                  <span className="text-ink/50">~</span>
                  <input
                    inputMode="decimal"
                    value={bidPctMax}
                    onChange={(e) => setBidPctMax(e.target.value)}
                    placeholder="如 10"
                    className={inputClass}
                  />
                </div>
              </div>
            </>
          )}
          <div>
            <label className={labelClass}>预期转化率（%）</label>
            <input
              inputMode="decimal"
              value={bidCvr}
              onChange={(e) => setBidCvr(e.target.value)}
              placeholder="如 1.5"
              className={inputClass}
            />
            {!bidCvr.trim() && (
              <p className="mt-1 text-xs text-ink/50">{d.bidCvrRequiredHint}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={runBidAnalysis}
          disabled={bidLoading}
          className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {bidLoading ? "计算中…" : "计算出价建议"}
        </button>
        {bidError && <p className="mt-3 text-sm text-red-600">{bidError}</p>}
      </div>

      {/* P1-1：建议 CPC 双公式并列（仅价格 × 比例区间模式有价格/佣金比例）。 */}
      {bidMode === "range" ? (
        <div className="mt-4 rounded-xl border border-ink/10 bg-white/70 p-5">
          <p className="text-sm font-semibold text-ink">
            建议 CPC 双公式（并列参考，K3 公式不变）
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-sm font-medium text-ink">公式 A：按出单成本</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {dualFormulaA !== null ? `${fmt(dualFormulaA, 4)} ${currency}` : "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-ink/45">
                建议 CPC = 价格 × 佣金比例 ÷ 预期点击出单数（取价格/佣金区间中值）
              </p>
              <label className="mt-3 block text-xs font-medium text-ink/70">
                预期点击出单数（可改）
              </label>
              <input
                inputMode="decimal"
                value={dualCtoOverride}
                onChange={(e) => setDualCtoOverride(e.target.value)}
                placeholder={String(Math.round(dualEffectiveCto))}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink/55">
                {dualCtoSource === "assumed" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                    暂无实测 CVR，用讲师假设 50 估算（非实测，请用实测 CVR 替换分母）
                  </span>
                ) : dualCtoSource === "measured" ? (
                  "分母来自你填写的预期转化率（1 ÷ CVR）"
                ) : (
                  "分母：你手动填写的值"
                )}
              </p>
            </div>
            <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-sm font-medium text-ink">公式 B：按目标 ROI（K3）</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {dualFormulaB !== null ? `${fmt(dualFormulaB, 4)} ${currency}` : "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-ink/45">
                推荐出价 = EPC ÷ (1 + 目标 ROI)，EPC = 区间佣金中值 × 预期转化率
              </p>
              <label className="mt-3 block text-xs font-medium text-ink/70">
                目标产出比（投 1 产出 X）
              </label>
              <input
                inputMode="decimal"
                value={dualTargetReturnRatio}
                onChange={(e) => setDualTargetReturnRatio(e.target.value)}
                placeholder="2"
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink/55">
                假设来源：目标产出比 {dualTargetReturnRatio || "2"}（投 1 产出 {dualTargetReturnRatio || "2"}）
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink/50">
          固定佣金模式下公式 A 不适用（需价格 × 佣金比例拆分）；切到“价格 × 比例区间”可并列对比双公式。
        </p>
      )}

      {bidResult && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4">
              <p className="text-sm font-medium text-ink">预估佣金</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {bidResult.commission.commissionMin !== null
                  ? `${bidResult.commission.commissionMin} ~ ${bidResult.commission.commissionMax} ${bidResult.currency ?? ""}`
                  : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4">
              <p className="text-sm font-medium text-ink">盈亏平衡 CPC</p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {bidResult.breakEvenCpc !== null
                  ? `${bidResult.breakEvenCpc} ${bidResult.currency ?? ""}`
                  : "—"}
              </p>
              <p className="mt-1 text-xs text-ink/50">转化率 {bidResult.assumedCvrPct}% 假设下</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">三档出价建议</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              {bidResult.bids.map((b) => (
                <div
                  key={b.level}
                  className={`rounded-xl border p-4 ${
                    b.level === "moderate" ? "border-signal bg-signal/5" : "border-ink/10 bg-white/70"
                  }`}
                >
                  <p className="text-sm font-medium text-ink">
                    {b.level === "conservative" ? "保守型" : b.level === "moderate" ? "稳健型" : "激进型"}
                    <span className="ml-1 text-xs text-ink/50">({Math.round(b.fraction * 100)}%)</span>
                  </p>
                  <p className="mt-1 text-xl font-semibold text-ink">
                    {b.maxCpc !== null ? `${b.maxCpc} ${bidResult.currency ?? ""}` : "—"}
                  </p>
                  <p className="mt-1 text-xs text-ink/60">{b.note}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">盈亏场景（按稳健型出价，每 100 点击）</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              {bidResult.scenarios.map((s, i) => (
                <div
                  key={i}
                  className={`rounded-xl border px-4 py-3 ${
                    s.verdict === "profit"
                      ? "border-green-200 bg-green-50"
                      : s.verdict === "loss"
                        ? "border-red-200 bg-red-50"
                        : "border-ink/10 bg-white/70"
                  }`}
                >
                  <p className="text-xs text-ink/60">转化率 {s.cvrPct}%</p>
                  <p className={`mt-1 text-lg font-semibold ${s.verdict === "profit" ? "text-green-700" : s.verdict === "loss" ? "text-red-700" : "text-ink"}`}>
                    {s.profitPer100Clicks !== null
                      ? `${s.profitPer100Clicks > 0 ? "+" : ""}${s.profitPer100Clicks} ${bidResult.currency ?? ""}`
                      : "—"}
                  </p>
                  <p className="text-xs text-ink/55">
                    {s.verdict === "profit" ? "盈利" : s.verdict === "loss" ? "亏损" : "未知"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
