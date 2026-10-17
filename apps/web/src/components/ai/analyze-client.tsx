"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import { EntityPageHeader } from "@/components/entities/ui";
import { analyzeOfferAction, getAnalysesAggregateAction } from "@/lib/api/ai-actions";
import { checkTrafficGateAction } from "@/lib/api/traffic-actions";
import type { TrafficGate } from "@/lib/api/amazon-types";
import type { AiAnalysis, AiAnalysisSummary, AnalysesAggregate } from "@/lib/api/ai";
import { classifyFailure, formatBackoff } from "@/lib/failure-classify";
import { AnalysisReport } from "./analysis-report";
import { TrafficGateCard } from "@/components/traffic/traffic-gate-card";

const CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY"];

function toSummary(a: AiAnalysis): AiAnalysisSummary {
  return {
    id: a.id,
    merchant: a.merchant,
    network: a.network,
    payout: a.profitability.payout,
    payoutCurrency: a.profitability.payoutCurrency,
    overallRisk: a.analysis.overallRisk,
    riskLevel: a.analysis.riskLevel,
    createdAt: a.analyzedAt,
  };
}

function riskBadge(level: "low" | "medium" | "high"): string {
  if (level === "low") return "bg-green-100 text-green-800";
  if (level === "medium") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

export function AnalyzeClient({
  isAdmin,
  showSetupNudge,
  initialHistory,
}: {
  isAdmin: boolean;
  showSetupNudge: boolean;
  initialHistory: AiAnalysisSummary[];
}) {
  const t = useDict();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [merchant, setMerchant] = useState("");
  const [network, setNetwork] = useState("");
  const [payout, setPayout] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [cpc, setCpc] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [report, setReport] = useState<AiAnalysis | null>(null);
  const [history, setHistory] = useState(initialHistory);
  /** P2-1：同 URL 聚合提示（已评估 N 次 + 最新分，省 AI 成本）。 */
  const [aggregate, setAggregate] = useState<AnalysesAggregate | null>(null);
  useEffect(() => {
    const trimmed = url.trim();
    if (mode !== "url" || !/^https?:\/\//i.test(trimmed)) {
      setAggregate(null);
      return;
    }
    const timer = setTimeout(() => {
      void getAnalysesAggregateAction(trimmed).then((res) => {
        if (res.ok && res.data.count > 0) setAggregate(res.data);
        else setAggregate(null);
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [url, mode]);
  // 流量需求门：报告出来后自动跑一次，失败不阻塞主结果。
  const [gate, setGate] = useState<TrafficGate | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const gateSeq = useRef(0);
  /** 最近一次流量门检测的 brand/keywords，供手动区"重新检测"复用。 */
  const lastGateInput = useRef<{ brand?: string; keywords?: string[] }>({});

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedText = text.trim();
    if ((mode === "url" && !trimmedUrl) || (mode === "text" && !trimmedText)) {
      setError(t.ai.analyze.form.needInput);
      return;
    }
    setError(null);
    setNotConfigured(false);
    setAnalyzing(true);
    try {
      const payoutNum = payout.trim() === "" ? undefined : Number(payout);
      const cpcNum = cpc.trim() === "" ? undefined : Number(cpc);
      const res = await analyzeOfferAction({
        url: mode === "url" ? trimmedUrl : undefined,
        text: mode === "text" ? trimmedText : undefined,
        merchant: merchant.trim() || undefined,
        network: network.trim() || undefined,
        payout:
          payoutNum !== undefined && Number.isFinite(payoutNum)
            ? payoutNum
            : undefined,
        payoutCurrency: currency,
        estimatedCpc:
          cpcNum !== undefined && Number.isFinite(cpcNum) ? cpcNum : undefined,
      });
      if (res.ok) {
        setReport(res.data);
        setHistory((h) => [
          toSummary(res.data),
          ...h.filter((x) => x.id !== res.data.id),
        ]);
        // 流量需求门自动检测：brand 取分析的 merchant 名（无则取用户输入的商家），
        // keywords 取分析报告里的关键词；失败时只显示"暂无数据"，不阻塞主结果。
        const seq = ++gateSeq.current;
        const brand = res.data.merchant?.trim() || merchant.trim() || undefined;
        const keywords = (res.data.analysis.keywords ?? []).slice(0, 5);
        lastGateInput.current = { brand, keywords };
        setGate(null);
        setGateLoading(true);
        void checkTrafficGateAction({ brand, keywords }).then((g) => {
          if (seq !== gateSeq.current) return;
          setGateLoading(false);
          if (g.ok) setGate(g.data);
        });
      } else if (res.code === "AI_NOT_CONFIGURED") {
        setNotConfigured(true);
      } else {
        setError(res.error);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() {
    setReport(null);
    setGate(null);
    setGateLoading(false);
    gateSeq.current++;
    lastGateInput.current = {};
    setError(null);
    setNotConfigured(false);
  }

  /** 流量门手动区"重新检测"：品牌名/手动月访问量至少提供一个。 */
  function recheckGate(input: { brand?: string; manualMonthlyVisits?: number }) {
    const seq = ++gateSeq.current;
    setGateLoading(true);
    const base = lastGateInput.current;
    void checkTrafficGateAction({
      brand: input.brand || base.brand,
      keywords: base.keywords,
      manualMonthlyVisits: input.manualMonthlyVisits,
    }).then((g) => {
      if (seq !== gateSeq.current) return;
      setGateLoading(false);
      if (g.ok) setGate(g.data);
    });
  }

  return (
    <div>
      <EntityPageHeader
        title={t.ai.analyze.title}
        description={t.ai.analyze.description}
      />

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

      {report ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={reset}
            className="mb-4 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {t.ai.analyze.report.reanalyze}
          </button>
          <AnalysisReport analysis={report} />
          <div className="mt-4">
            <TrafficGateCard
              gate={gate}
              loading={gateLoading}
              dict={t.ai.analyze.trafficGate}
              onRecheck={recheckGate}
              recheckBusy={gateLoading}
            />
          </div>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6"
        >
          <div
            className="inline-flex rounded-lg bg-ink/5 p-1"
            role="group"
            aria-label="input mode"
          >
            {(["url", "text"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  mode === m
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink/60 hover:text-ink"
                }`}
              >
                {m === "url"
                  ? t.ai.analyze.form.modeUrl
                  : t.ai.analyze.form.modeText}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {mode === "url" ? (
              <div>
                <label className={labelClass} htmlFor="ai-url">
                  {t.ai.analyze.form.urlLabel}
                </label>
                <input
                  id="ai-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t.ai.analyze.form.urlPlaceholder}
                  className={inputClass}
                />
                {aggregate && (
                  <p className="mt-1 text-xs text-ink/60">
                    {t.ai.analyze.form.alreadyEvaluated
                      .replace("{n}", String(aggregate.count))
                      .replace(
                        "{score}",
                        aggregate.latestOverallRisk !== null
                          ? String(aggregate.latestOverallRisk)
                          : "—"
                      )}
                    {aggregate.latestId && (
                      <>
                        {" "}
                        <Link
                          className="underline"
                          href={`/ai/analyze/${aggregate.latestId}`}
                        >
                          {t.ai.analyze.form.viewLatest}
                        </Link>
                      </>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className={labelClass} htmlFor="ai-text">
                  {t.ai.analyze.form.textLabel}
                </label>
                <textarea
                  id="ai-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t.ai.analyze.form.textPlaceholder}
                  rows={5}
                  className={inputClass}
                />
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="ai-merchant">
                {t.ai.analyze.form.merchantLabel}
              </label>
              <input
                id="ai-merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder={t.ai.analyze.form.merchantPlaceholder}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-network">
                {t.ai.analyze.form.networkLabel}
              </label>
              <input
                id="ai-network"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder={t.ai.analyze.form.networkPlaceholder}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-payout">
                {t.ai.analyze.form.payoutLabel}
              </label>
              <div className="flex gap-2">
                <input
                  id="ai-payout"
                  type="number"
                  min="0"
                  step="0.01"
                  value={payout}
                  onChange={(e) => setPayout(e.target.value)}
                  placeholder={t.ai.analyze.form.payoutPlaceholder}
                  className={inputClass}
                />
                <select
                  aria-label={t.ai.analyze.form.currencyLabel}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="rounded-lg border border-ink/15 bg-white px-2 py-2 text-sm text-ink"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-cpc">
                {t.ai.analyze.form.cpcLabel}
              </label>
              <input
                id="ai-cpc"
                type="number"
                min="0"
                step="0.01"
                value={cpc}
                onChange={(e) => setCpc(e.target.value)}
                placeholder={t.ai.analyze.form.cpcPlaceholder}
                className={inputClass}
              />
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <p>{error}</p>
              {/* P1-23：失败分类（类别 + 是否可重试 + 建议动作 + 退避）。 */}
              {(() => {
                const f = classifyFailure(error);
                return (
                  <p className="mt-1 text-xs text-red-700/90">
                    分类：{f.category} · {f.retryable ? "可重试" : "不可重试，请修正后重试"} ·
                    建议等待 {formatBackoff(f.backoffSeconds)} 后重试
                    <br />
                    {f.suggestedAction}
                  </p>
                );
              })()}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={analyzing}
            className="mt-5 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {analyzing
              ? t.ai.analyze.form.analyzing
              : t.ai.analyze.form.submit}
          </button>
        </form>
      )}

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.ai.analyze.history.title}
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55">
            {t.ai.analyze.history.empty}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">{t.common.misc.name}</th>
                  <th className="px-3 py-2">{t.ai.analyze.report.overallRisk}</th>
                  <th className="px-3 py-2">{t.ai.analyze.report.payout}</th>
                  <th className="px-3 py-2">{t.common.misc.created}</th>
                  <th className="px-3 py-2">{t.common.misc.actions}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-ink/10">
                    <td className="px-3 py-2 font-medium text-ink">
                      {h.merchant || h.network || h.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadge(h.riskLevel)}`}
                      >
                        {t.ai.analyze.report.riskLevels[h.riskLevel]} ·{" "}
                        {Math.round(h.overallRisk)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {h.payout !== null && h.payoutCurrency
                        ? `${h.payoutCurrency} ${h.payout}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/60">
                      {formatDateTime(h.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/ai/analyses/${h.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {t.ai.analyze.history.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
