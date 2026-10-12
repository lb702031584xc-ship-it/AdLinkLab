"use client";

/**
 * 功能2 — 自动化广告页面：粘贴 URL → 生成预览 → 确认排队 → Script/文案包。
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { coachCheckAction, type CoachFinding } from "@/lib/api/coach-actions";
import { CoachGate, hasCoachBlock } from "@/components/coach/coach-gate";
import { zh as coachZh, en as coachEn } from "@/i18n/dict/coach";
import { EntityPageHeader } from "@/components/entities/ui";
import { DataQualityBadge } from "@/components/data-quality-badge";
import type { AdsAutoDict } from "@/i18n/dict/ads-auto";
import { listGoogleAccountsAction } from "@/lib/api/entity-actions";
import {
  confirmAdPlanAction,
  getCopyPackAction,
  getCreateCampaignScriptAction,
  requestAdPlanAction,
} from "@/lib/api/ads-auto-actions";
import type {
  AdPlan,
  AdPlanKeyword,
  ConfirmResult,
} from "@/lib/api/ads-auto";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const cardClass = "rounded-xl border border-ink/10 bg-white p-4";
const sectionTitleClass = "text-sm font-semibold text-ink/80";

function keywordText(k: AdPlanKeyword): string {
  if (k.matchType === "EXACT") return `[${k.text}]`;
  if (k.matchType === "PHRASE") return `"${k.text}"`;
  return k.text;
}

function PlanPreview({ plan, d }: { plan: AdPlan; d: AdsAutoDict }) {
  const c = plan.campaign;
  return (
    <div className="mt-6 space-y-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-ink">
            {d.preview.campaign}: {c.name}
          </h3>
          <DataQualityBadge quality={c.dataQuality} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-ink/55">{d.preview.budget}</dt>
            <dd className="font-medium text-ink">
              {c.dailyBudget.amount} {c.dailyBudget.currency}
              {d.preview.perDay}
            </dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.preview.geo}</dt>
            <dd className="font-medium text-ink">{c.geoTargets.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.preview.bidding}</dt>
            <dd className="font-medium text-ink">{c.bidding.strategy}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.preview.status}</dt>
            <dd className="font-medium text-ink">
              {c.status}（{d.preview.pausedNote}）
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink/55">
          {d.preview.predictedNote} · {d.preview.expiresNote}
        </p>
      </div>

      <h3 className="text-sm font-semibold text-ink">
        {d.preview.adGroups}（{plan.adGroups.length}）
      </h3>
      {plan.adGroups.map((block, gi) => (
        <div key={gi} className={cardClass}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-ink">{block.group.name}</h4>
            <DataQualityBadge quality={block.group.dataQuality} />
          </div>
          <p className="mt-1 break-all text-xs text-ink/55">
            {d.preview.finalUrl}: {block.group.finalUrl}
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className={sectionTitleClass}>
                {d.preview.keywords}（{block.group.keywords.length}）
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[13px] text-ink/85">
                {block.group.keywords.map((k, i) => (
                  <li key={i}>{keywordText(k)}</li>
                ))}
              </ul>
              <p className={`${sectionTitleClass} mt-3`}>
                {d.preview.negatives}（{block.group.negativeKeywords.length}）
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[13px] text-ink/60">
                {block.group.negativeKeywords.map((k, i) => (
                  <li key={i}>{keywordText(k)}</li>
                ))}
                {block.group.negativeKeywords.length === 0 ? <li>—</li> : null}
              </ul>
            </div>
            <div>
              <p className={sectionTitleClass}>
                {d.preview.headlines}（{block.rsa.headlines.length}）
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-ink/85">
                {block.rsa.headlines.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
              <p className={`${sectionTitleClass} mt-3`}>
                {d.preview.descriptions}（{block.rsa.descriptions.length}）
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-ink/85">
                {block.rsa.descriptions.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdsAutoClient({ dict, lang }: { dict: AdsAutoDict; lang: "zh" | "en" }) {
  const d = dict;
  const [urlsText, setUrlsText] = useState("");
  const searchParams = useSearchParams();
  // ?urls= 预填（从 AI 工作表下一步跳过来时带终链）
  useEffect(() => {
    const u = searchParams.get("urls");
    if (u && !urlsText) setUrlsText(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [language, setLanguage] = useState<"zh" | "en">("en");
  const [googleAccountId, setGoogleAccountId] = useState("");
  const [googleAccounts, setGoogleAccounts] = useState<
    { id: string; name: string; customerId: string }[]
  >([]);
  const [plan, setPlan] = useState<AdPlan | null>(null);
  const [confirm, setConfirm] = useState<ConfirmResult | null>(null);
  const [scriptSource, setScriptSource] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busyPack, setBusyPack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 抓取失败兜底：手动粘贴页面文字（Amazon 等反爬站点）
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  // 教练模式（第十三批）
  const [brandTermsText, setBrandTermsText] = useState("");
  const [coachFindings, setCoachFindings] = useState<CoachFinding[]>([]);
  const [coachConfirmed, setCoachConfirmed] = useState(false);

  useEffect(() => {
    listGoogleAccountsAction().then((res) => {
      if (res.ok) {
        setGoogleAccounts(
          res.data.items.map((a) => ({
            id: a.id,
            name: a.name,
            customerId: a.customerId,
          }))
        );
      }
    });
  }, []);

  function parseUrls(): string[] {
    return urlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  async function runPlanCoachCheck(p: AdPlan, brandText: string) {
    const keywords = p.adGroups.flatMap((b) => b.group.keywords.map((k) => k.text));
    const brandTerms = brandText
      .split(/[,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const dailyBudget = p.campaign?.dailyBudget?.amount ?? null;
    const r = await coachCheckAction({
      keywords,
      brandTerms: brandTerms.length > 0 ? brandTerms : undefined,
      dailyBudget: dailyBudget ?? undefined,
    });
    if (r.ok) setCoachFindings(r.data.findings);
  }

  async function onGenerate() {
    const urls = parseUrls();
    if (urls.length === 0) {
      setError(d.form.needUrls);
      return;
    }
    setGenerating(true);
    setError(null);
    setPlan(null);
    setConfirm(null);
    setScriptSource(null);
    try {
      // 只有一个 URL 且用户粘贴了页面文字时，用手动文字跳过抓取（Amazon 等反爬站点）
      const manual = manualText.trim();
      const pageTexts =
        manual && urls.length === 1 ? [manual] : undefined;
      const res = await requestAdPlanAction(urls, {
        language,
        googleAccountId: googleAccountId.trim() || undefined,
        pageTexts,
      });
      if (res.ok) {
        setPlan(res.data.plan);
        setCoachConfirmed(false);
        void runPlanCoachCheck(res.data.plan, brandTermsText);
      } else {
        setError(res.error);
        // 抓取失败时自动展开手动粘贴区
        if (/fetch/i.test(res.error)) setManualOpen(true);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function onConfirm() {
    if (!plan) return;
    setConfirming(true);
    setError(null);
    try {
      const maxCpc =
        bidStrategy !== "plan" && bidCpc ? parseFloat(bidCpc) || undefined : undefined;
      const res = await confirmAdPlanAction(plan.planId, maxCpc);
      if (res.ok) {
        setConfirm(res.data);
        const s = await getCreateCampaignScriptAction(plan.planId);
        if (s.ok) setScriptSource(s.data.source);
      } else {
        setError(res.error);
      }
    } finally {
      setConfirming(false);
    }
  }

  // Bid strategy state
  const [bidStrategy, setBidStrategy] = useState<"plan" | "conservative" | "moderate" | "aggressive" | "custom">("plan");
  const [bidCommission, setBidCommission] = useState("");
  const [bidCvr, setBidCvr] = useState("2");
  const [bidCpc, setBidCpc] = useState("");
  const [bidCurrency, setBidCurrency] = useState("USD");

  function calcBidSuggestions() {
    const commission = parseFloat(bidCommission);
    const cvr = parseFloat(bidCvr) || 2;
    if (!Number.isFinite(commission) || commission <= 0) return null;
    const breakEven = (commission * cvr) / 100;
    return {
      breakEven,
      conservative: breakEven * 0.5,
      moderate: breakEven * 0.7,
      aggressive: breakEven * 0.9,
    };
  }

  const bidSuggestions = calcBidSuggestions();

  function selectBidStrategy(s: "conservative" | "moderate" | "aggressive") {
    setBidStrategy(s);
    if (bidSuggestions) {
      setBidCpc(bidSuggestions[s].toFixed(4));
    }
  }

  async function onDownloadPack() {
    if (!plan) return;
    setBusyPack(true);
    setError(null);
    try {
      const res = await getCopyPackAction(plan.planId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const blob = new Blob([res.data.text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.data.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusyPack(false);
    }
  }

  async function onCopyScript() {
    if (!scriptSource) return;
    try {
      await navigator.clipboard.writeText(scriptSource);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(d.errors.loadFailed);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <EntityPageHeader title={d.title} description={d.description} />

      <div className={`mt-6 ${cardClass}`}>
        <label className={labelClass} htmlFor="ads-auto-urls">
          {d.form.urlsLabel}
        </label>
        <textarea
          id="ads-auto-urls"
          rows={4}
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder={d.form.urlsPlaceholder}
          className={`${inputClass} font-mono`}
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className={labelClass} htmlFor="ads-auto-lang">
              {d.form.languageLabel}
            </label>
            <select
              id="ads-auto-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as "zh" | "en")}
              className={inputClass}
            >
              <option value="en">{d.form.languageEn}</option>
              <option value="zh">{d.form.languageZh}</option>
            </select>
          </div>
          <div className="min-w-64 flex-1">
            <label className={labelClass} htmlFor="ads-auto-account">
              {d.form.googleAccountLabel}
            </label>
            <select
              id="ads-auto-account"
              value={googleAccountId}
              onChange={(e) => setGoogleAccountId(e.target.value)}
              className={inputClass}
            >
              <option value="">{d.form.googleAccountPlaceholder}</option>
              {googleAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{a.customerId}）
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {generating ? d.form.generating : d.form.generate}
          </button>
        </div>

        {/* 抓取失败兜底：Amazon 等反爬站点手动粘贴页面文字 */}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setManualOpen((o) => !o)}
            className="text-xs text-ink/55 underline-offset-2 hover:underline"
          >
            {manualOpen ? "▾" : "▸"} {d.form.manualToggle}
          </button>
          {manualOpen && (
            <div className="mt-2">
              <p className="text-xs text-ink/55">{d.form.manualHint}</p>
              <textarea
                rows={5}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={d.form.manualPlaceholder}
                className={`${inputClass} mt-1 font-mono`}
              />
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {plan ? (
        <>
          <h2 className="mt-6 text-base font-semibold text-ink">{d.preview.title}</h2>
          <PlanPreview plan={plan} d={d} />

          {/* Bid strategy selection */}
          <div className={`mt-4 ${cardClass}`}>
            <h3 className="text-sm font-semibold text-ink">出价策略</h3>
            <p className="mt-1 text-sm text-ink/65">
              输入预估佣金和转化率，系统给出三档出价建议。选择后将应用到所有广告组的最高 CPC。
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <label className={labelClass}>预估佣金 ({bidCurrency})</label>
                <input
                  inputMode="decimal"
                  value={bidCommission}
                  onChange={(e) => setBidCommission(e.target.value)}
                  placeholder="12.50"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>预期转化率 (%)</label>
                <input
                  inputMode="decimal"
                  value={bidCvr}
                  onChange={(e) => setBidCvr(e.target.value)}
                  placeholder="2"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>货币</label>
                <select
                  value={bidCurrency}
                  onChange={(e) => setBidCurrency(e.target.value)}
                  className={inputClass}
                >
                  {["USD", "CNY", "EUR", "GBP", "JPY"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            {bidSuggestions && (
              <div className="mt-3 grid gap-2 md:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setBidStrategy("plan")}
                  className={`rounded-lg border px-3 py-2 text-sm ${bidStrategy === "plan" ? "border-ink bg-ink text-white" : "border-ink/15"}`}
                >
                  使用计划默认
                </button>
                {(["conservative", "moderate", "aggressive"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => selectBidStrategy(s)}
                    className={`rounded-lg border px-3 py-2 text-sm ${bidStrategy === s ? "border-ink bg-ink text-white" : "border-ink/15"}`}
                  >
                    {s === "conservative" ? "保守" : s === "moderate" ? "稳健" : "激进"}: {bidSuggestions[s].toFixed(4)}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3">
              <label className={labelClass}>自定义最高 CPC（可选，覆盖上方选择）</label>
              <input
                inputMode="decimal"
                value={bidCpc}
                onChange={(e) => { setBidCpc(e.target.value); setBidStrategy("custom"); }}
                placeholder="留空则使用所选策略"
                className={`${inputClass} max-w-xs`}
              />
            </div>
          </div>

          <div className={`mt-4 ${cardClass}`}>
            <h3 className="text-sm font-semibold text-ink">{d.confirm.title}</h3>
            <p className="mt-1 text-sm text-ink/65">{d.confirm.description}</p>
            <div className="mt-3">
              <label className={labelClass}>品牌词（逗号分隔，可选：用于拦截竞价品牌词）</label>
              <div className="flex gap-2">
                <input
                  value={brandTermsText}
                  onChange={(e) => setBrandTermsText(e.target.value)}
                  placeholder="如：anker, 安克"
                  className={`${inputClass} max-w-xs`}
                />
                <button
                  type="button"
                  onClick={() => plan && void runPlanCoachCheck(plan, brandTermsText)}
                  className="rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:bg-ink/5"
                >
                  检查
                </button>
              </div>
            </div>
            <div className="mt-3">
              <CoachGate
                dict={lang === "en" ? coachEn : coachZh}
                findings={coachConfirmed ? [] : coachFindings}
                onConfirm={() => setCoachConfirmed(true)}
                onCancel={() => setCoachFindings([])}
              />
            </div>
            {!confirm ? (
              <button
                type="button"
                onClick={onConfirm}
                disabled={
                  confirming ||
                  (hasCoachBlock(coachFindings) && !coachConfirmed) ||
                  (coachFindings.some((f) => f.kind === "confirm") && !coachConfirmed)
                }
                className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                {confirming ? d.confirm.confirming : d.confirm.button}
              </button>
            ) : (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                <p className="font-medium">
                  {confirm.alreadyQueued ? d.confirm.alreadyQueued : d.confirm.queued}
                </p>
                <p className="mt-1 font-mono text-xs">
                  {d.confirm.targetId}: {confirm.targetId}
                </p>
              </div>
            )}
          </div>

          {confirm && scriptSource ? (
            <div className={`mt-4 ${cardClass}`}>
              <h3 className="text-sm font-semibold text-ink">create-campaign Script</h3>
              <p className="mt-1 text-sm text-ink/65">{d.confirm.scriptHint}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onCopyScript}
                  className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink hover:bg-ink/5"
                >
                  {copied ? d.confirm.copied : d.confirm.copyScript}
                </button>
                <button
                  type="button"
                  onClick={() => setShowScript((v) => !v)}
                  className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink hover:bg-ink/5"
                >
                  {showScript ? d.confirm.hideScript : d.confirm.showScript}
                </button>
              </div>
              {showScript ? (
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-ink p-3 font-mono text-xs text-paper">
                  {scriptSource}
                </pre>
              ) : null}
            </div>
          ) : null}

          <div className={`mt-4 ${cardClass}`}>
            <h3 className="text-sm font-semibold text-ink">{d.copyPack.title}</h3>
            <p className="mt-1 text-sm text-ink/65">{d.copyPack.description}</p>
            <button
              type="button"
              onClick={onDownloadPack}
              disabled={busyPack}
              className="mt-3 rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
            >
              {d.copyPack.download}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
