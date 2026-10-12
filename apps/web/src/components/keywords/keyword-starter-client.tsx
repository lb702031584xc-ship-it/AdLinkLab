"use client";

/**
 * 类目关键词启动包（第十六批）：选类目 → 三组模板种子词 → 复制/去选品/去广告创建。
 */
import { useState } from "react";
import Link from "next/link";
import {
  STARTER_CATEGORIES,
  generateStarterKeywords,
  flattenStarterKeywords,
  type StarterCategoryKey,
  type StarterKeywordGroup,
} from "@/lib/keywords/starter";
import type { KeywordStarterDict } from "@/i18n/dict/keyword-starter";

export function KeywordStarterClient({
  dict: d,
  lang,
  onSeedsReady,
}: {
  dict: KeywordStarterDict;
  lang: "zh" | "en";
  /** 可选：把当前类目的种子词导出给上层（如需求验证清单一键导入） */
  onSeedsReady?: (groups: StarterKeywordGroup[]) => void;
}) {
  const [cat, setCat] = useState<StarterCategoryKey>("electronics");
  const [copied, setCopied] = useState(false);
  const groups = generateStarterKeywords(cat);

  async function copyAll() {
    const text = flattenStarterKeywords(groups).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时忽略
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-medium text-ink/70">{d.pickCategory}</p>
        <div className="flex flex-wrap gap-2">
          {STARTER_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(c.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                cat === c.key
                  ? "bg-ink text-white"
                  : "bg-ink/[0.05] text-ink/70 hover:bg-ink/10"
              }`}
            >
              {lang === "en" ? c.nameEn : c.nameZh}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copyAll}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          📋 {d.copyAll}
        </button>
        {copied && <span className="text-sm text-emerald-600">✓ {d.copied}</span>}
        {onSeedsReady && (
          <button
            type="button"
            onClick={() => onSeedsReady(groups)}
            className="rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5"
          >
            {d.importSeeds}
          </button>
        )}
        <Link
          href="/ads/auto-create"
          className="rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5"
        >
          {d.goAds} →
        </Link>
      </div>
      <p className="text-xs text-ink/50">{d.importNote}</p>

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.template} className="rounded-xl border border-ink/10 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-ink">
                {d.templateNames[g.template]}
              </h2>
              <p className="text-xs text-ink/50">{d.templateHints[g.template]}</p>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {g.keywords.map((kw) => (
                <li
                  key={kw}
                  className="flex items-center gap-1.5 rounded-full bg-ink/[0.04] px-3 py-1 text-sm text-ink/80"
                >
                  {kw}
                  <Link
                    href={`/amazon/discovery?keyword=${encodeURIComponent(kw)}`}
                    className="text-xs text-signal hover:underline"
                    title={d.goDiscover}
                  >
                    {d.goDiscover} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
