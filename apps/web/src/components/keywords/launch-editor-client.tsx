"use client";

/**
 * 投放选词（关键词启动包 · 投放选词 Tab）：
 * 关键词计划（分组 / 匹配方式 / 出价）+ 否定关键词（手动 / 批量 / 通用库 / 导出）。
 * 纯前端，无后端依赖。
 */
import { useEffect, useState } from "react";
import { UNIVERSAL_NEGATIVES } from "@/lib/keywords/negatives";
import type { KeywordStarterDict } from "@/i18n/dict/keyword-starter";
import type { SeedImportSignal } from "./demand-check-client";

type MatchType = "exact" | "phrase" | "broad";

interface PlanRow {
  id: string;
  keyword: string;
  adGroup: string;
  matchType: MatchType;
  bid: string;
  refCpc: string;
}

let rowSeq = 0;
const newRow = (): PlanRow => ({
  id: `pl-${++rowSeq}`,
  keyword: "",
  adGroup: "",
  matchType: "phrase",
  bid: "",
  refCpc: "",
});

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-signal";
const labelCls = "mb-1 block text-xs font-medium text-ink/60";

function parseMatchType(s: string): MatchType {
  const t = s.trim().toLowerCase();
  if (t === "exact" || t === "完全" || t === "完全匹配") return "exact";
  if (t === "broad" || t === "广泛" || t === "广泛匹配") return "broad";
  return "phrase";
}

/** 广告组自动分组：去掉修饰词后按核心产品词归组 */
const GROUP_STOPWORDS = new Set([
  "best", "buy", "cheap", "cheapest", "review", "reviews", "vs",
  "for", "home", "sale", "online", "store", "near", "me",
  "discount", "deals", "deal", "coupon", "price", "prices",
  "top", "good", "brand", "new", "2026", "2025", "under",
  "with", "without", "and", "the", "a", "an", "of", "to",
]);
function coreGroupName(keyword: string): string {
  const words = keyword
    .toLowerCase()
    .replace(/["[\]]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GROUP_STOPWORDS.has(w))
    .slice(0, 3);
  if (!words.length) return "";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function LaunchEditorClient({
  dict: d,
  lang,
  validatedSignal,
}: {
  dict: KeywordStarterDict;
  lang: "zh" | "en";
  validatedSignal?: SeedImportSignal | null;
}) {
  const [rows, setRows] = useState<PlanRow[]>([newRow()]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [copied, setCopied] = useState(false);

  const [negatives, setNegatives] = useState<string[]>([]);
  const [negInput, setNegInput] = useState("");
  const [negBulkOpen, setNegBulkOpen] = useState(false);
  const [negBulkText, setNegBulkText] = useState("");
  const [negCopied, setNegCopied] = useState(false);

  // 从需求验证导入 ✅值得跟进 / ⚠️谨慎测试 的词（去重追加）
  useEffect(() => {
    if (!validatedSignal || validatedSignal.seq === 0) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()).filter(Boolean));
      const fresh = validatedSignal.words
        .map((w) => w.trim())
        .filter((w) => w && !have.has(w.toLowerCase()))
        .map((w) => ({ ...newRow(), keyword: w }));
      if (!fresh.length) return rs;
      const base = rs.length === 1 && !rs[0].keyword ? [] : rs;
      return [...base, ...fresh];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validatedSignal?.seq]);

  /* ----- 关键词计划 ----- */
  const update = (id: string, patch: Partial<PlanRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const doBulkImport = () => {
    const fresh: PlanRow[] = [];
    for (const line of bulkText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.includes(",")) {
        const [kw, group, match, bid, cpc] = t.split(",").map((s) => s.trim());
        if (!kw) continue;
        fresh.push({
          id: `pl-${++rowSeq}`,
          keyword: kw,
          adGroup: group || "",
          matchType: parseMatchType(match || ""),
          bid: bid || "",
          refCpc: cpc || "",
        });
      } else {
        fresh.push({ ...newRow(), keyword: t });
      }
    }
    if (fresh.length) {
      setRows((rs) => {
        const base = rs.length === 1 && !rs[0].keyword ? [] : rs;
        return [...base, ...fresh];
      });
    }
    setBulkText("");
    setBulkOpen(false);
  };

  /** 一键自动分组：按核心产品词归组，已有分组的不动 */
  const autoGroup = () => {
    setRows((rs) =>
      rs.map((r) => {
        if (!r.keyword.trim() || r.adGroup.trim()) return r;
        const g = coreGroupName(r.keyword);
        return g ? { ...r, adGroup: g } : r;
      })
    );
  };

  /** 一键填建议出价：优先用参考 CPC，空的填 1.00 起步 */
  const fillBidSuggestions = () => {
    setRows((rs) =>
      rs.map((r) => {
        if (!r.keyword.trim() || r.bid.trim()) return r;
        return { ...r, bid: r.refCpc.trim() || "1.00" };
      })
    );
  };

  const copyPlan = async () => {    const lines = rows
      .filter((r) => r.keyword.trim())
      .map((r) =>
        [r.keyword.trim(), r.adGroup.trim() || "-", d.matchOptions[r.matchType], r.bid.trim() || "-", r.refCpc.trim() || "-"].join(" | ")
      );
    if (!lines.length) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  /* ----- 否定词 ----- */
  const addNegative = (w: string) => {
    const t = w.trim();
    if (t && !negatives.includes(t)) setNegatives((ns) => [...ns, t]);
  };
  const removeNegative = (w: string) =>
    setNegatives((ns) => ns.filter((x) => x !== w));
  const addAllNegatives = () => {
    const all = new Set<string>(negatives);
    UNIVERSAL_NEGATIVES.forEach((c) => c.words.forEach((w) => all.add(w)));
    setNegatives([...all]);
  };
  const doNegBulkImport = () => {
    const words = negBulkText.split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean);
    setNegatives((ns) => [...new Set([...ns, ...words])]);
    setNegBulkText("");
    setNegBulkOpen(false);
  };
  const copyNegatives = async () => {
    if (!negatives.length) return;
    try {
      await navigator.clipboard.writeText(negatives.join("\n"));
      setNegCopied(true);
      setTimeout(() => setNegCopied(false), 2000);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  return (
    <div className="space-y-8">
      {/* 关键词计划 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">🎯 {d.planTitle}</h2>
          <p className="mt-1 text-sm text-ink/60">{d.planSubtitle}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, newRow()])}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            + {d.addRow}
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen((o) => !o)}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            {d.bulkImportTitle}
          </button>
          <button
            type="button"
            onClick={copyPlan}
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            📋 {d.copyPlan}
          </button>
          {copied && <span className="self-center text-sm text-emerald-600">✓ {d.copied}</span>}
          <button
            type="button"
            onClick={autoGroup}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            🗂️ {d.autoGroup}
          </button>
          <button
            type="button"
            onClick={fillBidSuggestions}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            ⚡ {d.fillBids}
          </button>
        </div>

        {bulkOpen && (
          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={d.bulkPlanPlaceholder}
              rows={5}
              className={inputCls}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={doBulkImport}
                className="rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                {d.doImport}
              </button>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                {d.cancel}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div className="col-span-2 sm:col-span-1">
                  <label className={labelCls}>{d.thKeyword}</label>
                  <input
                    value={r.keyword}
                    onChange={(e) => update(r.id, { keyword: e.target.value })}
                    placeholder={d.kwPlaceholder}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{d.thAdGroup}</label>
                  <input
                    value={r.adGroup}
                    onChange={(e) => update(r.id, { adGroup: e.target.value })}
                    placeholder="—"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{d.thMatchType}</label>
                  <select
                    value={r.matchType}
                    onChange={(e) => update(r.id, { matchType: e.target.value as MatchType })}
                    className={inputCls}
                  >
                    {(Object.keys(d.matchOptions) as MatchType[]).map((k) => (
                      <option key={k} value={k}>{d.matchOptions[k]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{d.thBid}</label>
                  <input
                    value={r.bid}
                    onChange={(e) => update(r.id, { bid: e.target.value.replace(/[^\d.]/g, "") })}
                    inputMode="decimal"
                    placeholder="1.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{d.thRefCpc}</label>
                  <input
                    value={r.refCpc}
                    onChange={(e) => update(r.id, { refCpc: e.target.value.replace(/[^\d.]/g, "") })}
                    inputMode="decimal"
                    placeholder="—"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className="text-xs text-ink/40 hover:text-red-600"
                >
                  {d.remove}
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink/50">💡 {d.bidHint}</p>

        {/* 下一步：计划定稿后去投放 */}
        {rows.some((r) => r.keyword.trim()) && (
          <div className="rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
            <p className="text-sm font-semibold text-ink">🚀 {d.nextStepTitle}</p>
            <p className="mt-1 text-xs text-ink/55">{d.nextStepHint}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyPlan}
                className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                📋 {d.copyPlan}
              </button>
              <a
                href="/ads/auto-create"
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                📢 {d.goAutoAds} →
              </a>
            </div>
          </div>
        )}
      </section>

      {/* 否定词 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">🚫 {d.negativesTitle}</h2>
          <p className="mt-1 text-sm text-ink/60">{d.negativesSubtitle}</p>
        </div>

        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-ink/70">{d.universalLibrary}</p>
          <div className="flex flex-wrap gap-2">
            {UNIVERSAL_NEGATIVES.map((c) => (
              <span
                key={c.key}
                title={c.words.join("、")}
                className="rounded-full bg-ink/[0.05] px-3 py-1 text-xs text-ink/70"
              >
                {lang === "en" ? c.nameEn : c.nameZh} × {c.words.length}
              </span>
            ))}
            <button
              type="button"
              onClick={addAllNegatives}
              className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              ⚡ {d.addAllNegatives}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={negInput}
            onChange={(e) => setNegInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addNegative(negInput);
                setNegInput("");
              }
            }}
            placeholder={d.negPlaceholder}
            className={`${inputCls} max-w-xs`}
          />
          <button
            type="button"
            onClick={() => {
              addNegative(negInput);
              setNegInput("");
            }}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            + {d.addNegative}
          </button>
          <button
            type="button"
            onClick={() => setNegBulkOpen((o) => !o)}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            {d.importKeywords}
          </button>
          <button
            type="button"
            onClick={copyNegatives}
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            📋 {d.copyNegatives}
          </button>
          {negCopied && <span className="text-sm text-emerald-600">✓ {d.copied}</span>}
        </div>

        {negBulkOpen && (
          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <textarea
              value={negBulkText}
              onChange={(e) => setNegBulkText(e.target.value)}
              placeholder={d.bulkPlaceholder}
              rows={4}
              className={inputCls}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={doNegBulkImport}
                className="rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                {d.doImport}
              </button>
              <button
                type="button"
                onClick={() => setNegBulkOpen(false)}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                {d.cancel}
              </button>
            </div>
          </div>
        )}

        {negatives.length === 0 ? (
          <p className="text-sm text-ink/50">{d.emptyNegatives}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {negatives.map((w) => (
              <li
                key={w}
                className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm text-red-800"
              >
                − {w}
                <button
                  type="button"
                  onClick={() => removeNegative(w)}
                  className="text-xs text-red-400 hover:text-red-700"
                  aria-label={d.remove}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
