"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AmazonManualGuideDict } from "@/i18n/dict/amazon-manual-guide";
import {
  parseAmazonProductUrlAction,
  getKeepaStatusAction,
  validateKeepaAction,
  getKeepaVisionStatusAction,
  judgeKeepaVisionAction,
  judgeKeepaManualAction,
} from "@/lib/api/amazon-actions";
import type { KeepaValidateItem, KeepaManualInput, KeepaManualJudgment } from "@/lib/api/ai";

const LS_CHECKS = "adlinklab-manual-guide-checks";
const LS_CATS = "adlinklab-manual-guide-cats";
const LS_CANDIDATES = "adlinklab-manual-guide-candidates";
const LS_COUNTRY = "adlinklab-manual-guide-country";
const LS_KEEPA_CHECKED = "adlinklab-manual-guide-keepa-checked";
const LS_KEEPA_VERDICTS = "adlinklab-manual-guide-keepa-verdicts";

// 扫榜三榜单路径（与 scan 步骤 checklist 前三项一一对应）
const SCAN_PATHS = ["/Best-Sellers/zgbs", "/gp/movers-and-shakers", "/gp/new-releases"];
const AMAZON_DOMAINS: Record<string, string> = {
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
  FR: "www.amazon.fr",
  IT: "www.amazon.it",
  ES: "www.amazon.es",
  CA: "www.amazon.ca",
  AU: "www.amazon.com.au",
  JP: "www.amazon.co.jp",
};

interface CandidateRow {
  id: string;
  name: string;
  asin: string;
  rank: string;
  note: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Day5 Keepa 一键自动筛选：读候选清单的 ASIN 列 → 调 /api/v1/keepa/validate
 * → 展示每项 verdict/原因/关键指标 → 二次确认后把淘汰项从候选清单移除。
 * 无 key 时按钮 disabled 并指引去 AI 设置配置。
 */
function KeepaAutoScreen({
  d,
  lang,
  candidates,
  country,
  onRemoveAsins,
}: {
  d: AmazonManualGuideDict;
  lang: string;
  candidates: CandidateRow[];
  country: string;
  onRemoveAsins: (asins: string[]) => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<KeepaValidateItem[]>([]);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState("");

  useEffect(() => {
    let alive = true;
    getKeepaStatusAction().then((res) => {
      if (alive) setHasKey(res.ok ? res.data.hasKey : false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const asins = useMemo(() => {
    const out: string[] = [];
    for (const c of candidates) {
      const a = c.asin.trim().toUpperCase();
      if (/^[A-Z0-9]{10}$/.test(a) && !out.includes(a)) out.push(a);
    }
    return out;
  }, [candidates]);

  const run = async () => {
    if (running || asins.length === 0) return;
    setRunning(true);
    setError("");
    setResults([]);
    setConfirming(false);
    setAppliedMsg("");
    try {
      const res = await validateKeepaAction(asins, country);
      if (!res.ok) {
        setError(res.error);
        // 后端提示未配置 key 时，刷新按钮状态
        if (res.error.includes("Keepa API Key")) setHasKey(false);
        return;
      }
      setResults(res.data.results);
    } finally {
      setRunning(false);
    }
  };

  const killed = results.filter((r) => r.verdict === "kill");

  const formatReason = (
    r: { code: string; detail: string },
    m: KeepaValidateItem["metrics"]
  ): string => {
    if (lang !== "en") return r.detail;
    const tpl = d.keepaReasons[r.code] ?? r.detail;
    const v =
      r.code === "price_drop"
        ? m.priceDrop30dPct
        : r.code === "rank_swing"
          ? m.rankMaxMinRatio90d
          : r.code === "stockout"
            ? m.stockoutDays90d
            : null;
    return tpl.replace("{v}", v === null || v === undefined ? "?" : String(v));
  };

  const fmtDrop = (v: number | null) =>
    v === null || v === undefined ? d.keepaMetricNa : `${v}%`;
  const fmtRank = (v: number | null) =>
    v === null || v === undefined ? d.keepaMetricNa : `×${v}`;
  const fmtReviews = (v: number | null) =>
    v === null || v === undefined
      ? d.keepaMetricNa
      : v >= 0
        ? `+${v}`
        : `${v}`;
  const fmtStockout = (v: number | null) =>
    v === null || v === undefined
      ? d.keepaMetricNa
      : lang === "en"
        ? `${v}d`
        : `${v} 天`;

  const verdictBadge = (verdict: KeepaValidateItem["verdict"]) => {
    const cls =
      verdict === "pass"
        ? "bg-emerald-100 text-emerald-800"
        : verdict === "kill"
          ? "bg-red-100 text-red-800"
          : "bg-ink/10 text-ink/60";
    const label =
      verdict === "pass"
        ? d.keepaVerdictPass
        : verdict === "kill"
          ? d.keepaVerdictKill
          : d.keepaVerdictUnknown;
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
        {label}
      </span>
    );
  };

  const applyRemove = () => {
    const killAsins = killed.map((r) => r.asin);
    onRemoveAsins(killAsins);
    setResults([]);
    setConfirming(false);
    setAppliedMsg(d.keepaApplied.replace("{n}", String(killAsins.length)));
  };

  return (
    <div className="mb-4 rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
      <p className="text-sm font-semibold text-ink">{d.keepaAutoTitle}</p>
      <p className="mt-1 text-xs leading-5 text-ink/60">{d.keepaAutoHint}</p>
      {hasKey === false && (
        <p className="mt-2 text-xs leading-5 text-amber-700">
          ⚠ {d.keepaNoKey}：{d.keepaNoKeyHint}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={hasKey !== true || running || asins.length === 0}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {running ? d.keepaAutoRunning : d.keepaAutoButton}
        </button>
        <span className="text-xs text-ink/50">
          {asins.length} ASINs
        </span>
      </div>
      {asins.length === 0 && (
        <p className="mt-1 text-xs text-ink/50">{d.keepaNoAsin}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {appliedMsg && (
        <p className="mt-2 text-xs text-emerald-700">{appliedMsg}</p>
      )}
      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map((r) => (
            <div
              key={r.asin}
              className="rounded-lg border border-ink/10 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium text-ink">
                  {r.asin}
                </span>
                {verdictBadge(r.verdict)}
              </div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs leading-5 text-ink/70">
                {r.reasons.map((reason, i) => (
                  <li key={i}>{formatReason(reason, r.metrics)}</li>
                ))}
              </ul>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-ink/60 sm:grid-cols-4">
                <span>
                  {d.keepaMetricDrop}：{fmtDrop(r.metrics.priceDrop30dPct)}
                </span>
                <span>
                  {d.keepaMetricRank}：{fmtRank(r.metrics.rankMaxMinRatio90d)}
                </span>
                <span>
                  {d.keepaMetricReviews}：{fmtReviews(r.metrics.reviewGrowth90d)}
                </span>
                <span>
                  {d.keepaMetricStockout}：{fmtStockout(r.metrics.stockoutDays90d)}
                </span>
              </div>
            </div>
          ))}
          {killed.length > 0 && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
            >
              {d.keepaApplyButton} ({killed.length})
            </button>
          )}
          {confirming && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-3">
              <p className="text-xs text-red-800">
                {d.keepaApplyConfirm.replace("{n}", String(killed.length))}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={applyRemove}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                >
                  {d.keepaConfirmYes}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
                >
                  {d.keepaConfirmNo}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** verdict 本地存储形状（随 keepaChecked 一起持久化）。 */
export interface VisionVerdictStored {
  verdict: "pass" | "kill" | "unknown";
  reasons: string[];
}

/**
 * Day5 手动逐个核查 — "AI 看图"上传弹窗。
 * 上传 Keepa 价格历史 / Sales Rank 截图，调 vision LLM 看图判断，
 * 结果写回候选行的 verdict badge。
 */
// 手动输入模式字段配置（价格 / 排名 / 评论三组）
/** 全角数字/小数点转半角：中文输入法常把 199 打成 １９９，看着一样但 Number() 认不出。 */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９．。]/g, (ch) =>
    ch === "．" || ch === "。" ? "." : String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

const MANUAL_GROUPS: Array<{
  getTitle: (d: AmazonManualGuideDict) => string;
  fields: Array<{
    key: string;
    getLabel: (d: AmazonManualGuideDict) => string;
    optional?: boolean;
  }>;
}> = [
  {
    getTitle: (d) => d.manualPriceGroup,
    fields: [
      { key: "amazonPriceNow", getLabel: (d) => d.mAmazonPriceNow },
      { key: "amazonPrice30dAgo", getLabel: (d) => d.mAmazonPrice30dAgo },
      { key: "priceLow90d", getLabel: (d) => d.mPriceLow90d },
      { key: "priceHigh90d", getLabel: (d) => d.mPriceHigh90d },
    ],
  },
  {
    getTitle: (d) => d.manualRankGroup,
    fields: [
      { key: "rankNow", getLabel: (d) => d.mRankNow, optional: true },
      { key: "rankBest90d", getLabel: (d) => d.mRankBest90d, optional: true },
      { key: "rankWorst90d", getLabel: (d) => d.mRankWorst90d, optional: true },
    ],
  },
  {
    getTitle: (d) => d.manualReviewGroup,
    fields: [
      { key: "reviewsNow", getLabel: (d) => d.mReviewsNow },
      { key: "reviews90dAgo", getLabel: (d) => d.mReviews90dAgo, optional: true },
    ],
  },
];

function VisionModal({
  d,
  target,
  onClose,
  onDone,
}: {
  d: AmazonManualGuideDict;
  target: { id: string; name: string; asin: string };
  onClose: () => void;
  onDone: (id: string, v: VisionVerdictStored) => void;
}) {
  const [mode, setMode] = useState<"vision" | "manual">("vision");
  const [priceFile, setPriceFile] = useState<File | null>(null);
  const [rankFile, setRankFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  // 手动输入模式状态
  const [vals, setVals] = useState<Record<string, string>>({});
  const [mRunning, setMRunning] = useState(false);
  const [mError, setMError] = useState("");
  const [mResult, setMResult] = useState<KeepaManualJudgment | null>(null);

  const pickFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    set: (f: File | null) => void
  ) => {
    const f = e.target.files?.[0] ?? null;
    setError("");
    if (!f) {
      set(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError(`${d.visionNeedOne}`);
      e.target.value = "";
      return;
    }
    set(f);
  };

  const submit = async () => {
    if (!priceFile && !rankFile) {
      setError(d.visionNeedOne);
      return;
    }
    setRunning(true);
    setError("");
    try {
      const fd = new FormData();
      if (priceFile) fd.append("price", priceFile);
      if (rankFile) fd.append("rank", rankFile);
      if (target.asin) fd.append("asin", target.asin);
      const res = await judgeKeepaVisionAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone(target.id, { verdict: res.data.verdict, reasons: res.data.reasons });
    } finally {
      setRunning(false);
    }
  };

  const submitManual = async () => {
    const nums: Record<string, number> = {};
    for (const g of MANUAL_GROUPS) {
      for (const f of g.fields) {
        // 中文输入法全角数字（１９９．５）转半角，否则 Number() 得到 NaN
        const raw = toHalfWidth(vals[f.key] ?? "").trim();
        const label = f.getLabel(d);
        if (raw === "") {
          if (f.optional) continue;
          setMError(d.manualFieldEmpty.replace("{label}", label));
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          setMError(d.manualFieldInvalid.replace("{label}", label));
          return;
        }
        nums[f.key] = n;
      }
    }
    if (nums.priceLow90d > nums.priceHigh90d) {
      setMError(d.manualLowGtHigh);
      return;
    }
    // 排名三项要么都填，要么都空（Keepa 排名历史需付费）
    const rankKeys = ["rankNow", "rankBest90d", "rankWorst90d"];
    const rankFilled = rankKeys.filter((k) => nums[k] !== undefined).length;
    if (rankFilled > 0 && rankFilled < 3) {
      setMError(d.manualRankPartial);
      return;
    }
    setMRunning(true);
    setMError("");
    try {
      const input: KeepaManualInput = {
        amazonPriceNow: nums.amazonPriceNow,
        amazonPrice30dAgo: nums.amazonPrice30dAgo,
        priceLow90d: nums.priceLow90d,
        priceHigh90d: nums.priceHigh90d,
        rankNow: nums.rankNow ?? null,
        rankBest90d: nums.rankBest90d ?? null,
        rankWorst90d: nums.rankWorst90d ?? null,
        reviewsNow: nums.reviewsNow,
        reviews90dAgo: nums.reviews90dAgo ?? null,
      };
      const res = await judgeKeepaManualAction(input);
      if (!res.ok) {
        setMError(res.error);
        return;
      }
      setMResult(res.data);
      onDone(target.id, {
        verdict: res.data.verdict,
        reasons: res.data.reasons.map((r) => r.detail),
      });
    } finally {
      setMRunning(false);
    }
  };

  const mBadgeLabel =
    mResult?.verdict === "pass"
      ? d.keepaVerdictPass
      : mResult?.verdict === "kill"
        ? d.keepaVerdictKill
        : d.keepaVerdictUnknown;
  const mBadgeCls =
    mResult?.verdict === "pass"
      ? "bg-emerald-100 text-emerald-800"
      : mResult?.verdict === "kill"
        ? "bg-red-100 text-red-800"
        : "bg-ink/10 text-ink/60";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold text-ink">{d.visionModalTitle}</p>
        <p className="mt-1 truncate text-xs text-ink/60">
          {target.name}
          {target.asin && <span className="ml-2">{target.asin}</span>}
        </p>
        {/* 模式切换 */}
        <div className="mt-3 flex gap-1 rounded-lg bg-ink/5 p-1">
          {(
            [
              { key: "vision", label: d.visionTabScreenshot },
              { key: "manual", label: d.visionTabManual },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={`flex-1 rounded-md px-2 py-1.5 text-sm transition ${
                mode === t.key
                  ? "bg-white font-medium text-ink shadow-sm"
                  : "text-ink/55 hover:text-ink/80"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "vision" ? (
          <>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs leading-5 text-ink/50">{d.visionPriceLabel}</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => pickFile(e, setPriceFile)}
                  className="mt-1 block w-full text-sm text-ink/80 file:mr-3 file:rounded-lg file:border file:border-ink/15 file:bg-ink/[0.03] file:px-3 file:py-1.5 file:text-sm"
                />
                {priceFile && <p className="mt-1 text-xs text-ink/50">{priceFile.name}</p>}
              </div>
              <div>
                <p className="text-xs leading-5 text-ink/50">{d.visionRankLabel}</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => pickFile(e, setRankFile)}
                  className="mt-1 block w-full text-sm text-ink/80 file:mr-3 file:rounded-lg file:border file:border-ink/15 file:bg-ink/[0.03] file:px-3 file:py-1.5 file:text-sm"
                />
                {rankFile && <p className="mt-1 text-xs text-ink/50">{rankFile.name}</p>}
              </div>
            </div>
            {error && <p className="mt-3 text-xs leading-5 text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
              >
                {d.visionClose}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={running}
                className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {running ? d.visionRunning : d.visionSubmit}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 space-y-4">
              {MANUAL_GROUPS.map((g) => (
                <div key={g.getTitle(d)}>
                  <p className="text-xs font-medium text-ink/70">{g.getTitle(d)}</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {g.fields.map((f) => (
                      <label key={f.key} className="block">
                        <span className="text-xs text-ink/55">{f.getLabel(d)}</span>
                        <input
                          type="number"
                          min="0"
                          inputMode="decimal"
                          value={vals[f.key] ?? ""}
                          onChange={(e) => {
                            setVals((prev) => ({ ...prev, [f.key]: e.target.value }));
                            setMError("");
                          }}
                          placeholder="0"
                          className="mt-0.5 w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm text-ink focus:border-ink/40 focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {mResult && (
              <div className="mt-4 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${mBadgeCls}`}
                >
                  {mBadgeLabel}
                </span>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-ink/75">
                  {mResult.reasons.map((r, i) => (
                    <li key={i}>{r.detail}</li>
                  ))}
                </ul>
              </div>
            )}
            {mError && <p className="mt-3 text-xs leading-5 text-red-600">{mError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
              >
                {d.visionClose}
              </button>
              <button
                type="button"
                onClick={submitManual}
                disabled={mRunning}
                className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {mRunning ? d.visionRunning : d.visionSubmit}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepCard({
  step,
  d,
  open,
  onToggle,
  checks,
  onCheck,
  onSkipStep,
  children,
  scanLinks,
}: {
  step: { id: string; dayLabel: string; title: string; intro: string[]; checklist: string[]; tools: { label: string; href: string; external?: boolean }[]; skippable?: boolean };
  d: AmazonManualGuideDict;
  open: boolean;
  onToggle: () => void;
  checks: Record<string, boolean>;
  onCheck: (key: string, v: boolean) => void;
  onSkipStep: () => void;
  children?: React.ReactNode;
  scanLinks?: string[];
}) {
  const done = step.checklist.filter((_, i) => checks[`${step.id}:${i}`]).length;
  const total = step.checklist.length;
  const complete = done === total;
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">
          {step.dayLabel}
        </span>
        <span className="flex-1">
          <span className="block text-base font-semibold text-ink">{step.title}</span>
          <span className="text-xs text-ink/60">
            {done}/{total} · {complete ? d.stepDone : d.stepTodo}
          </span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {complete ? d.stepDone : d.stepTodo}
        </span>
        <span className="text-sm text-ink/50">{open ? d.collapse : d.expand} ▾</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {step.intro.map((p, i) => (
            <p key={i} className="text-sm leading-6 text-ink/80">
              {p}
            </p>
          ))}
          <ul className="space-y-2">
            {step.checklist.map((item, i) => {
              const key = `${step.id}:${i}`;
              const link = scanLinks && i < scanLinks.length ? scanLinks[i] : null;
              return (
                <li key={i}>
                  <div className="flex items-start gap-2.5 rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink/85 transition hover:bg-ink/[0.03]">
                    <label className="mt-0.5 flex cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!checks[key]}
                        onChange={(e) => onCheck(key, e.target.checked)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
                      >
                        <span className={checks[key] ? "text-ink/50 line-through" : ""}>{item}</span> ↗
                      </a>
                    ) : (
                      <span className={checks[key] ? "text-ink/50 line-through" : ""}>{item}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {step.skippable && !complete && (
            <div className="pt-1">
              <button
                type="button"
                onClick={onSkipStep}
                className="rounded-lg border border-dashed border-ink/25 px-3 py-1.5 text-sm text-ink/60 transition hover:border-ink/50 hover:text-ink"
              >
                {d.skipStep} →
              </button>
            </div>
          )}
          {children}
          {step.tools.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {step.tools.map((t, ti) => {
                const href =
                  scanLinks && step.id === "scan" && ti < scanLinks.length ? scanLinks[ti] : t.href;
                return t.external ? (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
                  >
                    {t.label} ↗
                  </a>
                ) : (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AmazonManualGuideClient({
  dict: d,
  lang = "zh",
}: {
  dict: AmazonManualGuideDict;
  lang?: string;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [cats, setCats] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [country, setCountry] = useState("US");
  const [pasteUrl, setPasteUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [keepaChecked, setKeepaChecked] = useState<string[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VisionVerdictStored>>({});
  const [llmOk, setLlmOk] = useState<boolean | null>(null);
  const [visionTarget, setVisionTarget] = useState<{
    id: string;
    name: string;
    asin: string;
  } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ categories: true });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChecks(loadJson(LS_CHECKS, {}));
    setCats(loadJson<string[]>(LS_CATS, []));
    setCandidates(loadJson<CandidateRow[]>(LS_CANDIDATES, []));
    setCountry(loadJson(LS_COUNTRY, "US"));
    setKeepaChecked(loadJson<string[]>(LS_KEEPA_CHECKED, []));
    setVerdicts(loadJson<Record<string, VisionVerdictStored>>(LS_KEEPA_VERDICTS, {}));
    setReady(true);
  }, []);

  // AI 看图按钮可用性：LLM 是否已配置
  useEffect(() => {
    let alive = true;
    getKeepaVisionStatusAction().then((res) => {
      if (alive) setLlmOk(res.ok ? res.data.llmConfigured : false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(LS_CHECKS, JSON.stringify(checks));
  }, [checks, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_CATS, JSON.stringify(cats));
  }, [cats, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_CANDIDATES, JSON.stringify(candidates));
  }, [candidates, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_COUNTRY, JSON.stringify(country));
  }, [country, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_KEEPA_CHECKED, JSON.stringify(keepaChecked));
  }, [keepaChecked, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_KEEPA_VERDICTS, JSON.stringify(verdicts));
  }, [verdicts, ready]);

  const dpUrl = (asin: string) => {
    const clean = asin.trim().toUpperCase();
    if (!clean) return null;
    const domain = AMAZON_DOMAINS[country] ?? AMAZON_DOMAINS.US;
    return `https://${domain}/dp/${clean}`;
  };

  const scanLinks = useMemo(() => {
    const domain = AMAZON_DOMAINS[country] ?? AMAZON_DOMAINS.US;
    return SCAN_PATHS.map((p) => `https://${domain}${p}`);
  }, [country]);

  const total = useMemo(
    () => d.steps.reduce((n, s) => n + s.checklist.length, 0),
    [d]
  );
  const done = useMemo(
    () =>
      d.steps.reduce(
        (n, s) => n + s.checklist.filter((_, i) => checks[`${s.id}:${i}`]).length,
        0
      ),
    [d, checks]
  );
  const pct = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  const toggleCat = (id: string) =>
    setCats((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : prev.length >= 2 ? prev : [...prev, id]
    );

  const addRow = () =>
    setCandidates((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, name: "", asin: "", rank: "", note: "" },
    ]);
  const updateRow = (id: string, field: keyof Omit<CandidateRow, "id">, v: string) =>
    setCandidates((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
  const removeRow = (id: string) => setCandidates((prev) => prev.filter((r) => r.id !== id));

  const onCheck = (key: string, v: boolean) => setChecks((prev) => ({ ...prev, [key]: v }));
  const onSkipStep = (stepId: string, count: number) =>
    setChecks((prev) => {
      const next = { ...prev };
      for (let i = 0; i < count; i++) next[`${stepId}:${i}`] = true;
      return next;
    });
  const toggleStep = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  const addFromUrl = async () => {
    const url = pasteUrl.trim();
    if (!url || parsing) return;
    setParsing(true);
    setParseError("");
    try {
      const res = await parseAmazonProductUrlAction(url);
      if (!res.ok) {
        setParseError(res.error);
        return;
      }
      if (!res.data.asin) {
        setParseError(d.parseUrlNoAsin);
        return;
      }
      const asinUpper = res.data.asin.trim().toUpperCase();
      if (candidates.some((r) => r.asin.trim().toUpperCase() === asinUpper)) {
        setParseError(d.duplicateAsin);
        return;
      }
      setCandidates((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          name: res.data.name ?? "",
          asin: res.data.asin ?? "",
          rank: "",
          note: "",
        },
      ]);
      setPasteUrl("");
    } finally {
      setParsing(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink/35";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">{d.title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink/70">{d.description}</p>
      </header>

      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">{d.progressLabel}</span>
          <span className="text-ink/60">
            {d.progressText.replace("{done}", String(done)).replace("{total}", String(total))} · {pct}%
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {allDone && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
          <h2 className="text-lg font-bold text-emerald-900">{d.congratsTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-800">{d.congratsBody}</p>
          <h3 className="mt-4 text-sm font-semibold text-emerald-900">{d.nextStepsTitle}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-800">
            {d.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {d.steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          d={d}
          open={!!open[step.id]}
          onToggle={() => toggleStep(step.id)}
          checks={checks}
          onCheck={onCheck}
          onSkipStep={() => onSkipStep(step.id, step.checklist.length)}
          scanLinks={step.id === "scan" ? scanLinks : undefined}
        >
          {step.id === "categories" && (
            <div>
              <p className="text-sm font-medium text-ink">{d.categoriesTitle}</p>
              <p className="mt-1 text-xs text-ink/60">{d.categoriesHint}</p>
              <p className="mt-2 text-xs font-semibold text-ink/70">
                {d.selectedCount.replace("{n}", String(cats.length))}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {d.categories.map((c) => {
                  const selected = cats.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCat(c.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-ink/15 bg-white hover:border-ink/30"
                      }`}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-ink">{c.name}</span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                            selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-ink/25 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-ink/65">{c.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step.id === "scan" && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <label className="text-xs font-medium text-ink/70">{d.scanCountryLabel}</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
                >
                  {Object.keys(AMAZON_DOMAINS).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm font-medium text-ink">{d.candidateTitle}</p>
              <p className="mt-1 text-xs text-ink/60">{d.candidateHint}</p>
              <div className="mt-3 flex gap-2">
                <input
                  className={inputCls}
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addFromUrl();
                  }}
                  placeholder={d.pasteUrlPlaceholder}
                />
                <button
                  type="button"
                  onClick={addFromUrl}
                  disabled={parsing || !pasteUrl.trim()}
                  className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {d.addFromUrl}
                </button>
              </div>
              {parseError && <p className="mt-1 text-xs text-red-600">{parseError}</p>}
              <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-ink/[0.04] text-left text-xs text-ink/60">
                      <th className="px-3 py-2 font-medium">{d.colNo}</th>
                      <th className="px-3 py-2 font-medium">{d.colName}</th>
                      <th className="px-3 py-2 font-medium">{d.colAsin}</th>
                      <th className="px-3 py-2 font-medium">{d.colRank}</th>
                      <th className="px-3 py-2 font-medium">{d.colNote}</th>
                      <th className="px-3 py-2 font-medium">{d.colAction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((r, ri) => {
                      const link = dpUrl(r.asin);
                      return (
                      <tr key={r.id} className="border-t border-ink/10">
                        <td className="px-3 py-2 text-xs text-ink/50">{ri + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.name}
                            placeholder={d.namePlaceholder}
                            onChange={(e) => updateRow(r.id, "name", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.asin}
                            placeholder={d.asinPlaceholder}
                            onChange={(e) => updateRow(r.id, "asin", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.rank}
                            placeholder={d.rankPlaceholder}
                            onChange={(e) => updateRow(r.id, "rank", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.note}
                            placeholder={d.notePlaceholder}
                            onChange={(e) => updateRow(r.id, "note", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {link && (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 rounded-lg border border-ink/15 px-2 py-1 text-xs text-sky-700 transition hover:bg-ink/5"
                              >
                                {d.viewProduct} ↗
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => removeRow(r.id)}
                              className="shrink-0 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 transition hover:bg-red-50"
                            >
                              {d.removeRow}
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {candidates.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-ink/50">{d.candidateEmpty}</p>
                )}
              </div>
              <button
                type="button"
                onClick={addRow}
                className="mt-2 rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
              >
                + {d.addRow}
              </button>
            </div>
          )}

          {step.id === "keepa" && (
            <>
              <KeepaAutoScreen
                d={d}
                lang={lang}
                candidates={candidates}
                country={country}
                onRemoveAsins={(asins) =>
                  setCandidates((prev) =>
                    prev.filter((r) => !asins.includes(r.asin.trim().toUpperCase()))
                  )
                }
              />
              {candidates.length > 0 && (
                <div className="rounded-xl border border-ink/10 bg-white p-4">
                  <p className="text-sm font-semibold text-ink">{d.keepaManualTitle}</p>
                  <p className="mt-1 text-xs leading-5 text-ink/60">{d.keepaManualHint}</p>
                  <p className="mt-2 text-xs text-ink/60">
                    {d.keepaManualProgress
                      .replace("{done}", String(keepaChecked.filter((id) => candidates.some((r) => r.id === id)).length))
                      .replace("{total}", String(candidates.length))}
                  </p>
                  {llmOk === false && (
                    <p className="mt-1 text-xs leading-5 text-amber-700">
                      ⚠ {d.visionNoLlm}：{d.visionNoLlmHint}
                    </p>
                  )}
                  <ul className="mt-2 space-y-1.5">
                    {candidates.map((r, i) => {
                      const link = dpUrl(r.asin);
                      const checked = keepaChecked.includes(r.id);
                      const v = verdicts[r.id];
                      const isKill = v?.verdict === "kill";
                      const badgeCls =
                        !v || v.verdict === "unknown"
                          ? "bg-ink/10 text-ink/60"
                          : v.verdict === "pass"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800";
                      const badgeLabel =
                        !v || v.verdict === "unknown"
                          ? d.keepaVerdictUnknown
                          : v.verdict === "pass"
                            ? d.keepaVerdictPass
                            : d.keepaVerdictKill;
                      return (
                        <li
                          key={r.id}
                          className={`rounded-lg border px-3 py-2 text-sm ${
                            isKill ? "border-red-300 bg-red-50/60" : "border-ink/10"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-6 shrink-0 text-xs text-ink/50">{i + 1}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setKeepaChecked((prev) =>
                                  e.target.checked
                                    ? [...prev, r.id]
                                    : prev.filter((id) => id !== r.id)
                                )
                              }
                              className="h-4 w-4 shrink-0 accent-emerald-600"
                            />
                            <span className={`min-w-0 flex-1 truncate ${checked ? "text-ink/45 line-through" : "text-ink/85"}`}>
                              {r.name || d.unnamedProduct}
                              {r.asin && <span className="ml-2 text-xs text-ink/45">{r.asin.trim().toUpperCase()}</span>}
                            </span>
                            {v && (
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls}`}>
                                {badgeLabel}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setVisionTarget({
                                  id: r.id,
                                  name: r.name || d.unnamedProduct,
                                  asin: r.asin.trim().toUpperCase(),
                                })
                              }
                              disabled={llmOk !== true}
                              title={llmOk === false ? d.visionNoLlmHint : undefined}
                              className="shrink-0 rounded-lg border border-ink/15 px-2 py-1 text-xs text-ink/80 transition hover:bg-ink/5 disabled:opacity-40"
                            >
                              {d.visionButton}
                            </button>
                            {link && (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 rounded-lg border border-ink/15 px-2 py-1 text-xs text-sky-700 transition hover:bg-ink/5"
                              >
                                {d.viewProduct} ↗
                              </a>
                            )}
                          </div>
                          {v && v.reasons.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5 pl-14 text-xs leading-5 text-ink/65">
                              {v.reasons.map((reason, ri) => (
                                <li key={ri}>· {reason}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="text-sm font-semibold text-emerald-900">{d.keepaPassTitle}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-emerald-900/90">
                  {d.keepaPass.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                <p className="text-sm font-semibold text-red-900">{d.keepaFailTitle}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-red-900/90">
                  {d.keepaFail.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
              </div>
            </>
          )}

          {step.id === "reviews" && (
            <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
              <p className="text-sm font-semibold text-ink">{d.finalPickTitle}</p>
              <p className="mt-1 text-xs leading-5 text-ink/65">{d.finalPickHint}</p>
              <Link
                href="/amazon/pipeline"
                className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                {d.goPipeline}
              </Link>
            </div>
          )}
        </StepCard>
      ))}
      {visionTarget && (
        <VisionModal
          d={d}
          target={visionTarget}
          onClose={() => setVisionTarget(null)}
          onDone={(id, v) => {
            setVerdicts((prev) => ({ ...prev, [id]: v }));
            setVisionTarget(null);
          }}
        />
      )}
    </div>
  );
}
