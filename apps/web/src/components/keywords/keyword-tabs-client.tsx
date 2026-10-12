"use client";

/**
 * 关键词启动包双 Tab 外壳：
 * ?tab=research（需求验证，选品用）| ?tab=launch（投放选词，投流用），默认 research。
 * URL 参数是 Tab 状态的唯一来源，切换时 shallow 更新，前进/后退可用。
 */
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeywordStarterClient } from "./keyword-starter-client";
import { DemandCheckClient, type SeedImportSignal } from "./demand-check-client";
import { LaunchEditorClient } from "./launch-editor-client";
import { flattenStarterKeywords } from "@/lib/keywords/starter";
import type { KeywordStarterDict } from "@/i18n/dict/keyword-starter";

type Tab = "research" | "launch";

export function KeywordStarterTabsClient({
  dict: d,
  lang,
  offers,
}: {
  dict: KeywordStarterDict;
  lang: "zh" | "en";
  offers: { id: string; name: string; network: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "launch" ? "launch" : "research";

  // 种子词 → 需求验证的一次性导入信号
  const [importSignal, setImportSignal] = useState<SeedImportSignal | null>(null);

  // Offer 选择：用于 AI 按 offer 生成关键词
  const [offerId, setOfferId] = useState("");
  const [manualOffer, setManualOffer] = useState("");
  const selectedOffer = offers.find((o) => o.id === offerId);
  const aiProduct = selectedOffer?.name || manualOffer.trim();

  const switchTab = (t: Tab) => {
    router.replace(`/keywords/starter?tab=${t}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{d.pageTitle}</h1>
        <p className="mt-1 text-sm text-ink/60">
          {tab === "research" ? d.researchSubtitle : d.launchSubtitle}
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-ink/[0.05] p-1">
        {(["research", "launch"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t ? "bg-white text-ink shadow-sm" : "text-ink/50 hover:text-ink/80"
            }`}
          >
            {t === "research" ? "🔍" : "🚀"} {d.tabs[t]}
          </button>
        ))}
      </div>

      {tab === "research" ? (
        <div>
          {/* Offer 选择器：AI 按 offer 生成关键词 */}
          <div className="mb-4 rounded-xl border border-ink/10 bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-ink">
              {lang === "zh" ? "🎯 针对哪个 offer 选词？" : "🎯 Which offer are keywords for?"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={offerId}
                onChange={(e) => {
                  setOfferId(e.target.value);
                  setManualOffer("");
                }}
                className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
              >
                <option value="">
                  {lang === "zh" ? "从 offer 库选择…" : "Select from library…"}
                </option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}（{o.network}）
                  </option>
                ))}
              </select>
              <span className="text-xs text-ink/40">
                {lang === "zh" ? "或" : "or"}
              </span>
              <input
                value={manualOffer}
                onChange={(e) => {
                  setManualOffer(e.target.value);
                  setOfferId("");
                }}
                placeholder={lang === "zh" ? "手动输入产品/品类，如 robot vacuum" : "Type product/niche, e.g. robot vacuum"}
                className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
              />
            </div>
            {aiProduct && (
              <p className="mt-1.5 text-xs text-ink/50">
                {lang === "zh"
                  ? `AI 将按"${aiProduct}"生成关键词思路`
                  : `AI will suggest keyword ideas for "${aiProduct}"`}
              </p>
            )}
          </div>
          <KeywordStarterClient
            dict={d}
            lang={lang}
            onSeedsReady={(groups) =>
              setImportSignal((s) => ({
                words: flattenStarterKeywords(groups),
                seq: (s?.seq ?? 0) + 1,
              }))
            }
          />
          <DemandCheckClient dict={d} importSignal={importSignal} aiProduct={aiProduct} />
        </div>
      ) : (
        <LaunchEditorClient dict={d} lang={lang} />
      )}
    </div>
  );
}
