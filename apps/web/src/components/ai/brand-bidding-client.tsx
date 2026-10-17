"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { checkBrandBiddingAction } from "@/lib/api/ai-actions";
import type { BrandBiddingResult } from "@/lib/api/ai";

/**
 * 品牌词投流检查（AI 分析 Step ⑤ 内的指标卡）。
 * 查某品牌词在 Google 上谁在投广告（官方 vs 非官方），给出投流评估。
 * 数据源 DataForSEO SERP；无凭证时显示手动核查指引，不编造。
 */
export function BrandBiddingClient({
  initialKeyword = "",
  initialDomain = "",
}: {
  initialKeyword?: string;
  initialDomain?: string;
}) {
  const t = useDict();
  const d = t.ai.brandBidding;
  const [keyword, setKeyword] = useState(initialKeyword);
  const [domain, setDomain] = useState(initialDomain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrandBiddingResult | null>(null);

  async function onCheck() {
    if (!keyword.trim() || !domain.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await checkBrandBiddingAction(keyword.trim(), domain.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
  }

  const verdictStyle =
    result?.verdict === "non_official_present"
      ? "border-amber-300 bg-amber-50"
      : result?.verdict === "official_only"
        ? "border-blue-300 bg-blue-50"
        : result?.verdict === "no_ads"
          ? "border-ink/15 bg-ink/[0.02]"
          : "border-ink/15";

  return (
    <div className="mt-4 rounded-xl border border-ink/10 p-4">
      <h3 className="text-sm font-semibold text-ink">🔍 {d.title}</h3>
      <p className="mt-1 text-xs text-ink/55">{d.description}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <input
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={d.keywordPh}
        />
        <input
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder={d.domainPh}
        />
      </div>
      <button
        type="button"
        onClick={onCheck}
        disabled={busy || !keyword.trim() || !domain.trim()}
        className="mt-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? d.checking : d.check}
      </button>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      {result ? (
        <div className={`mt-3 rounded-lg border p-3 ${verdictStyle}`}>
          {result.status === "unavailable" ? (
            <p className="text-xs text-amber-800">⚠️ {d.unavailable}</p>
          ) : (
            <div className="text-xs">
              <p className="font-semibold text-ink">
                {result.verdict === "no_ads" && d.verdictNoAds}
                {result.verdict === "official_only" && d.verdictOfficialOnly}
                {result.verdict === "non_official_present" &&
                  d.verdictNonOfficial.replace("{n}", String(result.nonOfficialAds))}
              </p>
              <p className="mt-1 text-ink/55">
                {d.adsFound.replace("{n}", String(result.adsFound))} · {d.sourceNote}
              </p>
              {result.nonOfficial.length > 0 ? (
                <ul className="mt-2 list-disc pl-4 text-ink/70">
                  {result.nonOfficial.map((b) => (
                    <li key={b.domain}>
                      {b.domain}
                      {b.title ? ` — ${b.title}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          <ul className="mt-2 space-y-1 text-xs leading-5 text-ink/75">
            {result.assessment.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
