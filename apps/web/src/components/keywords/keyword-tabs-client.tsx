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
}: {
  dict: KeywordStarterDict;
  lang: "zh" | "en";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "launch" ? "launch" : "research";

  // 种子词 → 需求验证的一次性导入信号
  const [importSignal, setImportSignal] = useState<SeedImportSignal | null>(null);

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
          <DemandCheckClient dict={d} importSignal={importSignal} />
        </div>
      ) : (
        <LaunchEditorClient dict={d} lang={lang} />
      )}
    </div>
  );
}
