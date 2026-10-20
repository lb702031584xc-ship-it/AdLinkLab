"use client";

import {
  CPA_DRIVER_LABELS,
  CPA_INSUFFICIENT_TEXT,
  diagnoseCpaChange,
  type CpaPeriodInput,
} from "@/lib/cpa-diagnosis";

/**
 * 补强 #22 — CPA 诊断卡（/reports 数据报表）。
 * 输入为最近两个周期的 CPC / 转化率（或 CPA）；页面暂无现成双周期数据时
 * props 为空，组件显示空状态说明，不下结论、不编造。
 */
export function CpaDiagnosisCard({
  lang,
  previous,
  current,
  previousLabel,
  currentLabel,
}: {
  lang: "zh" | "en";
  previous?: CpaPeriodInput | null;
  current?: CpaPeriodInput | null;
  previousLabel?: string;
  currentLabel?: string;
}) {
  const en = lang === "en";
  const title = en ? "CPA Diagnosis" : "CPA 诊断";
  const r = diagnoseCpaChange(previous, current);

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">📊 {title}</h3>
      {r.status === "insufficient" ? (
        <p className="mt-2 text-sm text-ink/60">
          {en ? CPA_INSUFFICIENT_TEXT.en : CPA_INSUFFICIENT_TEXT.zh}
          {en
            ? " — once two periods of metrics are available, this card splits the CPA change into a CPC part and a conversion-rate part."
            : " — 有双周期数据后，这里会把 CPA 变化拆成 CPC 贡献与转化率贡献。"}
        </p>
      ) : (
        <div className="mt-2 space-y-2 text-sm text-ink/80">
          <p>
            CPA：{previousLabel ?? (en ? "Previous" : "上一周期")}{" "}
            <strong className="text-ink">{r.cpaPrev?.toFixed(2)}</strong>
            {" → "}
            {currentLabel ?? (en ? "Current" : "本周期")}{" "}
            <strong className="text-ink">{r.cpaCurr?.toFixed(2)}</strong>
            {r.cpaChangePct != null && (
              <span
                className={
                  r.cpaChangePct > 0
                    ? "ml-2 font-medium text-red-700"
                    : r.cpaChangePct < 0
                      ? "ml-2 font-medium text-green-700"
                      : "ml-2 text-ink/60"
                }
              >
                {r.cpaChangePct > 0 ? "+" : ""}
                {(r.cpaChangePct * 100).toFixed(1)}%
              </span>
            )}
          </p>
          <p className="text-xs text-ink/60">
            {en ? "Formula" : "公式"}：CPA = CPC ÷{" "}
            {en ? "conversion rate" : "转化率"}；
            {en
              ? " log decomposition ln(CPA₂/CPA₁) = ln(CPC₂/CPC₁) − ln(CVR₂/CVR₁)"
              : "对数分解 ln(CPA₂/CPA₁) = ln(CPC₂/CPC₁) − ln(CVR₂/CVR₁)"}
            {r.cpcShare != null && r.cvrShare != null
              ? ` — CPC ${en ? "share" : "贡献份额"} ${(r.cpcShare * 100).toFixed(0)}%，${en ? "CVR share" : "转化率贡献份额"} ${(r.cvrShare * 100).toFixed(0)}%`
              : ""}
          </p>
          {r.driver && (
            <p className="rounded-lg bg-ink/[0.03] px-3 py-2">
              {en
                ? CPA_DRIVER_LABELS[r.driver].en
                : CPA_DRIVER_LABELS[r.driver].zh}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
