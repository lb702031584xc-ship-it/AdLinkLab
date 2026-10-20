"use client";

/**
 * 功能2 — 自动化广告页面：粘贴 URL → 生成预览 → 确认排队 → Script/文案包。
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadWorkStateAction } from "@/lib/api/work-state-actions";
import { getLastOfferId, setLastOfferId, getManualOffer } from "@/lib/current-offer";
import { useWorkState } from "@/lib/use-work-state";
import { coachCheckAction, type CoachFinding } from "@/lib/api/coach-actions";
import { CoachGate, hasCoachBlock } from "@/components/coach/coach-gate";
import { zh as coachZh, en as coachEn } from "@/i18n/dict/coach";
import { EntityPageHeader } from "@/components/entities/ui";
import { DataQualityBadge } from "@/components/data-quality-badge";
import type { AdsAutoDict } from "@/i18n/dict/ads-auto";
import {
  getOfferAction,
  listGoogleAccountsAction,
} from "@/lib/api/entity-actions";
import { calcProfit } from "@/lib/profit-calc";
import { listOfferCapturesAction, parseProductCaptureAiAction } from "@/lib/api/ai-actions";
import { CapturePicker } from "@/components/ai/capture-picker";
import { AdPreview } from "@/components/ai/ad-preview";
import {
  checkKeywordsAction,
  type KeywordCheckResult,
} from "@/lib/api/keyword-check-actions";
import type { OfferCaptureItem } from "@/lib/api/ai";
import {
  confirmAdPlanAction,
  getCopyPackAction,
  getCreateCampaignScriptAction,
  getRotationScriptAction,
  requestAdPlanAction,
  runPreflightAction,
} from "@/lib/api/ads-auto-actions";
import type {
  AdPlan,
  AdPlanAdSchedule,
  AdPlanKeyword,
  ConfirmResult,
  CreativeSelfCheckResult,
  PreflightResult,
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

/**
 * 关键词文本清洗：phrase 是默认匹配方式，行尾的 ", phrase" 是多余的，去掉
 * （只去行尾后缀；exact / broad 保留，因为不写就变 phrase 了）。
 */
function normalizeKwText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/,\s*phrase\s*$/i, ""))
    .join("\n");
}

/** 关键词 AI 检查状态（由父组件持有，检查结果驱动移除流程）。 */
export type KeywordCheckState = {
  status: "idle" | "checking" | "done" | "error";
  results: KeywordCheckResult[];
  error: string | null;
};

/** finalUrl → Google 搜索样式展示链接：域名 + 路径（根路径只留域名）。 */
function displayUrlOf(finalUrl: string): string {
  try {
    const u = new URL(finalUrl);
    return u.pathname && u.pathname !== "/" ? `${u.hostname}${u.pathname}` : u.hostname;
  } catch {
    return finalUrl;
  }
}

function PlanPreview({
  plan,
  d,
  budget,
  onBudgetChange,
  budgetCurrency,
  onBudgetCurrencyChange,
  currencyOptions,
  geo,
  onGeoChange,
  keywordCheck,
  onCheckKeywords,
  onRemoveFlagged,
  negativesText,
  onNegativesChange,
  schedules,
  onSchedulesChange,
  creativeCheck,
}: {
  plan: AdPlan;
  d: AdsAutoDict;
  budget: string;
  onBudgetChange: (v: string) => void;
  budgetCurrency: string;
  onBudgetCurrencyChange: (v: string) => void;
  /** 货币选项：[USD, X]，X = 已选账户货币（非 USD 时）否则 CNY。 */
  currencyOptions: string[];
  geo: string[];
  onGeoChange: (v: string[]) => void;
  keywordCheck: KeywordCheckState;
  onCheckKeywords: () => void;
  onRemoveFlagged: () => void;
  /** P1-25：否词管理（文本，每行一个）+ 排期编辑（campaign 级）。 */
  negativesText: string;
  onNegativesChange: (v: string) => void;
  schedules: AdPlanAdSchedule[];
  onSchedulesChange: (v: AdPlanAdSchedule[]) => void;
  /** P1-9：创意 7 维自检（启发式自检，非 AI 评分；fail 仅提醒，不拦截确认）。 */
  creativeCheck?: CreativeSelfCheckResult | null;
}) {
  const c = plan.campaign;
  const firstBlock = plan.adGroups[0];
  const flagged = keywordCheck.results.filter((r) => r.verdict !== "relevant");
  const totalKeywords = plan.adGroups.reduce((n, b) => n + b.group.keywords.length, 0);
  const canRemoveFlagged = flagged.length > 0 && flagged.length < totalKeywords;
  return (
    <div className="mt-6 space-y-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-ink">
            {d.preview.campaign}: {c.name}
          </h3>
          <DataQualityBadge quality={c.dataQuality} />
          {plan.copyStyle && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                plan.copyStyle === "official"
                  ? "bg-amber-100 text-amber-800"
                  : plan.copyStyle === "expert"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-sky-100 text-sky-800"
              }`}
              title={d.preview.copyStyleHint}
            >
              {plan.copyStyle === "official"
                ? d.preview.copyStyleOfficial
                : plan.copyStyle === "expert"
                  ? d.preview.copyStyleExpert
                  : d.preview.copyStyleAffiliate}
            </span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-ink/55">{d.preview.budget}</dt>
            <dd className="mt-1 flex items-center gap-1 font-medium text-ink">
              <input
                type="number"
                min={1}
                step={1}
                value={budget}
                onChange={(e) => onBudgetChange(e.target.value)}
                className="w-20 rounded-md border border-ink/15 bg-paper px-2 py-1 text-sm text-ink"
                aria-label={d.preview.budget}
              />
              <select
                value={budgetCurrency}
                onChange={(e) => onBudgetCurrencyChange(e.target.value)}
                className="rounded-md border border-ink/15 bg-paper px-1 py-1 text-sm text-ink"
                aria-label={d.preview.budgetCurrency}
              >
                {currencyOptions.map((cur) => (
                  <option key={cur} value={cur}>
                    {cur}
                  </option>
                ))}
              </select>
              <span>{d.preview.perDay}</span>
            </dd>
            <p className="mt-0.5 text-xs text-ink/55">
              {d.preview.budgetEditHint} · {d.preview.currencyHint}
            </p>
          </div>
          <div>
            <dt className="text-ink/55">{d.preview.geo}</dt>
            <dd className="mt-1 flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-auto">
              {d.preview.countries.map((ct) => (
                <label key={ct.code} className="flex cursor-pointer items-center gap-1 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={geo.includes(ct.code)}
                    onChange={(e) =>
                      onGeoChange(
                        e.target.checked
                          ? [...geo, ct.code]
                          : geo.filter((g) => g !== ct.code)
                      )
                    }
                  />
                  {ct.name}
                </label>
              ))}
            </dd>
            <p className="mt-0.5 text-xs text-ink/55">{d.preview.geoEditHint}</p>
          </div>
          <div>
            <dt className="text-ink/55">{d.preview.bidding}</dt>
            <dd className="font-medium text-ink">{c.bidding.strategy}</dd>
            <dd className="mt-1 text-sm text-ink">
              {d.preview.maxCpc}:{" "}
              {c.bidding.maxCpc
                ? `${c.bidding.maxCpc.amount.toFixed(4)} ${c.bidding.maxCpc.currency}`
                : "—"}
            </dd>
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

      {/* 可视化广告预览：取第一个广告组的 RSA（Google 搜索样式） */}
      {firstBlock && (
        <AdPreview
          headlines={firstBlock.rsa.headlines}
          descriptions={firstBlock.rsa.descriptions}
          displayUrl={displayUrlOf(firstBlock.rsa.finalUrl)}
          finalUrl={firstBlock.rsa.finalUrl}
          title={d.preview.adPreviewTitle}
          sponsoredLabel={d.preview.adPreviewSponsored}
        />
      )}

      <h3 className="text-sm font-semibold text-ink">
        {d.preview.adGroups}（{plan.adGroups.length}）
      </h3>
      {plan.adGroups.map((block, gi) => (
        <div key={gi} className={cardClass}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-ink">{block.group.name}</h4>
            <DataQualityBadge quality={block.group.dataQuality} />
            <span className="text-xs text-ink/60">
              {d.preview.maxCpc}:{" "}
              {block.group.maxCpc
                ? `${block.group.maxCpc.amount.toFixed(4)} ${block.group.maxCpc.currency}`
                : "—"}
            </span>
          </div>
          <p className="mt-1 break-all text-xs text-ink/55">
            {d.preview.finalUrl}: {block.group.finalUrl}
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className={sectionTitleClass}>
                {d.preview.keywords}（{block.group.keywords.length}）
                {block.group.keywordsSource === "user" && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    ✨ {d.preview.keywordsFromYou}
                  </span>
                )}
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[13px] text-ink/85">
                {block.group.keywords.map((k, i) => (
                  <li key={i}>{keywordText(k)}</li>
                ))}
              </ul>
              {block.group.keywords.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  ⚠️ {d.preview.emptyKeywordsHint}
                </p>
              )}
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
      {/* P1-25：否词管理 + 排期编辑（确认时生效；排期留空 = 全天投放）。 */}
      <div className={cardClass}>
        <h3 className="text-sm font-semibold text-ink">{d.preview.negativesManagerTitle}</h3>
        <p className="mt-1 text-xs text-ink/60">{d.preview.negativesManagerHint}</p>
        <textarea
          className={`${inputClass} mt-2 font-mono`}
          rows={4}
          value={negativesText}
          onChange={(e) => onNegativesChange(e.target.value)}
          placeholder={"[free]\n\"how to install\"\ndemo"}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5"
            onClick={() =>
              onNegativesChange(
                ["怎么安装", "怎么维修", "demo", "试用", "免费下载"].join("\n")
              )
            }
          >
            {d.preview.negativesExampleFill}
          </button>
          <span className="text-xs text-ink/50">{d.preview.negativesExampleNote}</span>
        </div>
        <h3 className="mt-4 text-sm font-semibold text-ink">{d.preview.schedulesTitle}</h3>
        <p className="mt-1 text-xs text-ink/60">{d.preview.schedulesHint}</p>
        <div className="mt-2 space-y-2">
          {schedules.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
                value={s.dayOfWeek}
                onChange={(e) =>
                  onSchedulesChange(
                    schedules.map((x, j) =>
                      j === i
                        ? { ...x, dayOfWeek: e.target.value as AdPlanAdSchedule["dayOfWeek"] }
                        : x
                    )
                  )
                }
              >
                {(Object.keys(d.preview.schedulesDayOptions) as AdPlanAdSchedule["dayOfWeek"][]).map(
                  (day) => (
                    <option key={day} value={day}>
                      {d.preview.schedulesDayOptions[day]}
                    </option>
                  )
                )}
              </select>
              <label className="text-xs text-ink/60">{d.preview.schedulesStart}</label>
              <input
                type="time"
                className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
                value={`${String(s.startHour).padStart(2, "0")}:${String(s.startMinute).padStart(2, "0")}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (Number.isInteger(h) && Number.isInteger(m)) {
                    onSchedulesChange(
                      schedules.map((x, j) =>
                        j === i ? { ...x, startHour: h, startMinute: m } : x
                      )
                    );
                  }
                }}
              />
              <label className="text-xs text-ink/60">{d.preview.schedulesEnd}</label>
              <input
                type="time"
                className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
                value={`${String(s.endHour).padStart(2, "0")}:${String(s.endMinute).padStart(2, "0")}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (Number.isInteger(h) && Number.isInteger(m)) {
                    onSchedulesChange(
                      schedules.map((x, j) =>
                        j === i ? { ...x, endHour: h, endMinute: m } : x
                      )
                    );
                  }
                }}
              />
              <button
                type="button"
                className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs text-ink hover:bg-ink/5"
                onClick={() => onSchedulesChange(schedules.filter((_, j) => j !== i))}
              >
                {d.preview.schedulesRemove}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5"
          onClick={() =>
            onSchedulesChange([
              ...schedules,
              { dayOfWeek: "MONDAY", startHour: 9, startMinute: 0, endHour: 21, endMinute: 0 },
            ])
          }
        >
          {d.preview.schedulesAdd}
        </button>
      </div>
      {/* P1-9：创意 7 维自检（启发式规则，非 AI 评分；fail 仅提醒，不拦截确认）。 */}
      {creativeCheck ? (
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-ink">{d.preview.creativeCheckTitle}</h3>
          <p className="mt-1 text-sm">
            {d.preview.creativeCheckOverall}：{(creativeCheck.overall * 100).toFixed(0)}% ·{" "}
            {creativeCheck.verdict === "pass" ? "✅" : "❌"}
          </p>
          {creativeCheck.verdict === "fail" ? (
            <p className="mt-1 text-sm text-red-700">{d.preview.creativeCheckFail}</p>
          ) : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
            {(
              Object.keys(creativeCheck.dimensions) as Array<keyof typeof creativeCheck.dimensions>
            ).map((k) => (
              <div key={k}>
                <dt className="text-ink/55">{d.preview.creativeCheckDims[k]}</dt>
                <dd title={creativeCheck.dimensions[k].note}>
                  {(creativeCheck.dimensions[k].score * 100).toFixed(0)}%
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-ink/55">{d.preview.creativeCheckBrandVolume}</p>
        </div>
      ) : null}
      {/* 关键词 AI 检查：投流前必查，无关/风险词标红，移除后重新生成计划 */}
      <div className={cardClass}>
        <h3 className="text-sm font-semibold text-ink">{d.preview.keywordCheckTitle}</h3>
        <p className="mt-1 text-xs text-ink/55">{d.preview.keywordCheckHint}</p>
        <button
          type="button"
          onClick={onCheckKeywords}
          disabled={keywordCheck.status === "checking" || totalKeywords === 0}
          className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
        >
          {keywordCheck.status === "checking"
            ? d.preview.keywordCheckChecking
            : d.preview.keywordCheckButton}
        </button>
        {keywordCheck.status === "error" && keywordCheck.error && (
          <p className="mt-2 text-sm text-red-700">{keywordCheck.error}</p>
        )}
        {keywordCheck.status === "done" && (
          <>
            {keywordCheck.results.length === 0 ? (
              <p className="mt-2 text-sm text-ink/60">{d.preview.keywordCheckEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {keywordCheck.results.map((r, i) => (
                  <li
                    key={`${r.keyword}-${i}`}
                    className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      r.verdict === "relevant"
                        ? "bg-emerald-50"
                        : "bg-red-50"
                    }`}
                  >
                    <span className="font-mono font-medium text-ink">{r.keyword}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.verdict === "relevant"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {r.verdict === "relevant"
                        ? d.preview.keywordCheckRelevant
                        : r.verdict === "irrelevant"
                          ? d.preview.keywordCheckIrrelevant
                          : d.preview.keywordCheckRisky}
                    </span>
                    <span className="text-xs text-ink/60">{r.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {flagged.length === 0 && keywordCheck.results.length > 0 && (
              <p className="mt-2 text-sm text-emerald-700">{d.preview.keywordCheckNoFlagged}</p>
            )}
            {flagged.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onRemoveFlagged}
                  disabled={!canRemoveFlagged}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  {d.preview.keywordCheckRemoveFlagged}（{flagged.length}）
                </button>
                <p className="mt-1 text-xs text-ink/55">
                  {canRemoveFlagged
                    ? d.preview.keywordCheckRemoveHint
                    : d.preview.keywordCheckAllFlagged}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function AdsAutoClient({
  dict,
  lang,
  initialOfferId,
}: {
  dict: AdsAutoDict;
  lang: "zh" | "en";
  /** ?offerId= 带入：关键词从该 offer 的投放选词快照自动带入，表单按 offer 自动保存。 */
  initialOfferId?: string | null;
}) {
  const d = dict;
  const [urlsText, setUrlsText] = useState("");
  const searchParams = useSearchParams();
  // ?urls= / ?keywords= / ?copyStyle= 预填（从 AI 工作表 / 投放选词跳过来）
  useEffect(() => {
    const u = searchParams.get("urls");
    if (u) {
      urlUrlsRef.current = u;
      if (!urlsText) setUrlsText(u);
    }
    const k = searchParams.get("keywords");
    if (k) {
      urlKwRef.current = k;
      if (!kwText) setKwText(normalizeKwText(k));
    }
    const cs = searchParams.get("copyStyle");
    if (cs === "official" || cs === "affiliate" || cs === "expert") {
      urlCsRef.current = cs;
      setCopyStyle(cs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [language, setLanguage] = useState<"zh" | "en">("en");
  // 文案口吻：official=官方口吻（Official Site 结构），affiliate=联盟安全口吻，expert=专家营销口吻
  const [copyStyle, setCopyStyle] = useState<"official" | "affiliate" | "expert">("affiliate");
  // 专家营销：插件 SERP 抓取选用（选了则用抓取的 SERP 做参考，不选则 DataForSEO 自动搜）
  const [serpCaptureId, setSerpCaptureId] = useState<string | null>(null);
  const [serpCaptures, setSerpCaptures] = useState<OfferCaptureItem[]>([]);
  const [serpCapturesLoading, setSerpCapturesLoading] = useState(false);
  const [serpCaptureError, setSerpCaptureError] = useState<string | null>(null);
  // 品牌符号生成器：Nike → Nike®（® 在 Google Ads 里显示为右上角小字）
  const [brandName, setBrandName] = useState("");
  const [brandSymbol, setBrandSymbol] = useState<"®" | "™">("®");
  const [brandCopied, setBrandCopied] = useState(false);
  const [googleAccountId, setGoogleAccountId] = useState("");
  const [googleAccounts, setGoogleAccounts] = useState<
    { id: string; name: string; customerId: string; currency?: string }[]
  >([]);
  const [plan, setPlan] = useState<AdPlan | null>(null);
  /** P1-9：创意 7 维自检（随计划返回；启发式自检，非 AI 评分）。 */
  const [creativeCheck, setCreativeCheck] = useState<CreativeSelfCheckResult | null>(null);
  // 关键词 AI 检查：结果驱动移除流程（移除 = 带过滤后关键词重新生成计划；
  // 确认建广告只传 planId、用服务端存储的计划，本地只改展示则被移除词仍会建出来）。
  const [keywordCheck, setKeywordCheck] = useState<KeywordCheckState>({
    status: "idle",
    results: [],
    error: null,
  });
  // 预览里可改：预算 + 地域（初始为 AI 建议值，确认时作为覆盖值传给服务端）。
  // 货币只有一个状态 bidCurrency（计划货币），预算货币下拉与出价区货币下拉共用它。
  const [editedBudget, setEditedBudget] = useState("");
  const [editedGeo, setEditedGeo] = useState<string[]>([]);
  /** P1-25：否词文本（每行一个）+ 排期（campaign 级），确认时生效。 */
  const [editedNegativesText, setEditedNegativesText] = useState("");
  const [editedSchedules, setEditedSchedules] = useState<AdPlanAdSchedule[]>([]);
  /** P1-14：生成前 Preflight 结果（blocked 真正拦截生成）。 */
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [confirm, setConfirm] = useState<ConfirmResult | null>(null);
  const [scriptSource, setScriptSource] = useState<string | null>(null);
  /** 生成 Script 时的数值指纹（在相关 state 声明后计算，见下方）。 */
  const [scriptFingerprint, setScriptFingerprint] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busyPack, setBusyPack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 抓取失败兜底：手动粘贴页面文字（Amazon 等反爬站点）
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  // 插件抓取 + AI 识别商品信息
  const [captureFilling, setCaptureFilling] = useState(false);
  const [captureNote, setCaptureNote] = useState<string | null>(null);

  /* 专家营销：加载插件抓取记录，客户端过滤出搜索结果页抓取（SERP）。
     与服务端校验一致：url 含 /search 且含 google.。
     注意：之前列表只在第一次切到专家时加载，抓取后不会自动刷新——
     用户先切专家、再去 Google 抓取、回来时列表还是旧的（空），只能整页刷新。
     所以抽出 loadSerpCaptures：每次切到专家都重拉 + 提供刷新按钮。 */
  const isSerpCapture = (c: OfferCaptureItem) =>
    c.finalUrl.includes("/search") && c.finalUrl.includes("google.");
  const serpLoadingRef = useRef(false);
  function loadSerpCaptures() {
    if (serpLoadingRef.current) return;
    serpLoadingRef.current = true;
    setSerpCapturesLoading(true);
    setSerpCaptureError(null);
    listOfferCapturesAction()
      .then((res) => {
        if (!res.ok) {
          setSerpCaptureError(res.error);
          return;
        }
        setSerpCaptures((res.data ?? []).filter(isSerpCapture));
      })
      .catch(() => {
        /* 加载失败：列表为空，UI 显示暂无记录；不编造错误文案。 */
      })
      .finally(() => {
        setSerpCapturesLoading(false);
        serpLoadingRef.current = false;
      });
  }
  useEffect(() => {
    if (copyStyle !== "expert") return;
    loadSerpCaptures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyStyle]);

  function onPickSerpCapture(id: string) {
    if (!id) {
      setSerpCaptureId(null);
      setSerpCaptureError(null);
      return;
    }
    const picked = serpCaptures.find((c) => c.id === id);
    if (!picked || !isSerpCapture(picked)) {
      setSerpCaptureId(null);
      setSerpCaptureError(d.form.serpSourceNotSerp);
      return;
    }
    setSerpCaptureId(id);
    setSerpCaptureError(null);
  }

  /* 插件抓取 + AI 识别：从抓取页提取商品信息填入手动粘贴框（可检查后再生成） */
  const fillProductFromCapture = async (c: OfferCaptureItem) => {
    setCaptureFilling(true);
    setCaptureNote(null);
    try {
      const res = await parseProductCaptureAiAction(c.id);
      if (!res.ok) {
        setCaptureNote(res.error);
        return;
      }
      const { product, summaryText } = res.data;
      if (!summaryText.trim() || (!product.title && product.bullets.length === 0)) {
        setCaptureNote(d.form.captureFillNone);
        return;
      }
      setManualText(summaryText);
      setManualOpen(true);
      // 抓取记录的 URL 回填到 URL 框（URL 框为空时）
      if (!urlsText.trim() && c.finalUrl) setUrlsText(c.finalUrl);
      setCaptureNote(d.form.captureFillDone);
    } finally {
      setCaptureFilling(false);
    }
  };
  // 投放选词里定好的关键词（可选）：填了就用这套，不再 AI 生成
  const [kwText, setKwText] = useState("");
  /** 关键词自动带入的来源（快照恢复 / 跨页联动）：显示给用户，不静默填。手改后清空。 */
  const [kwSource, setKwSource] = useState<{
    from: "ads-auto" | "keyword-launch" | "traffic-planner";
    count: number;
  } | null>(null);
  const kwSourceLabels = {
    "ads-auto": d.form.kwSourceAdsAuto,
    "keyword-launch": d.form.kwSourceLaunch,
    "traffic-planner": d.form.kwSourcePlanner,
  } as const;
  const [offerId, setOfferId] = useState<string | null>(initialOfferId ?? null);
  const urlKwRef = useRef<string | null>(null);
  const urlUrlsRef = useRef<string | null>(null);
  const urlCsRef = useRef<string | null>(null);

  // 计划货币与汇率 state 提前声明：useWorkState 的 watch 数组在 render 时立即读取它们，
  // 若声明在后会触发 TDZ（ReferenceError）。汇率 helpers 仍在出价区 state 块里（闭包，运行时才用）。
  const [bidCurrency, setBidCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("7.10");
  // 当前优惠（用户填店铺真实优惠，如 Up to 30% Off，绝不编造）：同上，watch 在 render 时读取，需提前声明。
  const [promotion, setPromotion] = useState("");

  // 直链轮换：与返利网直链轮换同一份脚本生成逻辑（标签 → Script）。
  // 注意：轮换本身在 Google Ads 里跑（脚本粘过去、每小时运行），
  // AdLinkLab 只生成脚本、不直接执行轮换，文案里要说清这点。
  const [rotationLabel, setRotationLabel] = useState("");
  const [rotationSource, setRotationSource] = useState<string | null>(null);
  const [rotationFileName, setRotationFileName] = useState("");
  const [rotationGenerating, setRotationGenerating] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [rotationCopied, setRotationCopied] = useState(false);

  async function onGenerateRotationScript() {
    const label = rotationLabel.trim();
    if (!label) {
      setRotationError(d.form.rotation.emptyLabel);
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(label)) {
      setRotationError(d.form.rotation.labelInvalid);
      return;
    }
    setRotationGenerating(true);
    setRotationError(null);
    setRotationSource(null);
    try {
      const res = await getRotationScriptAction(label);
      if (res.ok) {
        setRotationSource(res.data.source);
        setRotationFileName(res.data.fileName);
      } else {
        setRotationError(res.error);
      }
    } finally {
      setRotationGenerating(false);
    }
  }

  async function onCopyRotationScript() {
    if (!rotationSource) return;
    await navigator.clipboard.writeText(rotationSource);
    setRotationCopied(true);
    setTimeout(() => setRotationCopied(false), 2000);
  }

  function onDownloadRotationScript() {
    if (!rotationSource) return;
    const blob = new Blob([rotationSource], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = rotationFileName || "adlinklab-rotation.js";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** 快照恢复（URL 参数优先于快照）。挂载恢复和上次 offer 回落共用。 */
  const applyAdsAutoSnapshot = (snap: Record<string, unknown>) => {
    const str = (v: unknown) => (v == null ? "" : String(v));
    if (urlUrlsRef.current == null && str(snap.urlsText)) setUrlsText(str(snap.urlsText));
    if (urlKwRef.current == null && str(snap.kwText)) {
      const filled = normalizeKwText(str(snap.kwText));
      setKwText(filled);
      const count = filled.split("\n").map((l) => l.trim()).filter(Boolean).length;
      if (count > 0) setKwSource({ from: "ads-auto", count });
    }
    if (urlCsRef.current == null && (snap.copyStyle === "official" || snap.copyStyle === "affiliate" || snap.copyStyle === "expert"))
      setCopyStyle(snap.copyStyle);
    if (snap.language === "zh" || snap.language === "en") setLanguage(snap.language);
    if (str(snap.googleAccountId)) setGoogleAccountId(str(snap.googleAccountId));
    if (str(snap.promotion)) setPromotion(str(snap.promotion));
    if (typeof snap.bidCurrency === "string" && snap.bidCurrency.trim()) {
      const bc = snap.bidCurrency.trim().toUpperCase();
      setBidCurrency(bc);
      if (typeof snap.fxRate === "string" && snap.fxRate.trim() && bc !== "USD") {
        setFxRate(snap.fxRate.trim());
        fxRateEditedRef.current = true;
        fxRateCurrencyRef.current = bc;
      }
    }
    /* 计划 + 编辑值 + 确认/Script 恢复：仅当快照里的 plan 是合法对象（planId 为字符串）时才恢复，
       旧快照没有这些键自动跳过。scriptFingerprint 原样存取：恢复后用同批编辑值重算的
       currentScriptFingerprint 应与之相等，不误报 Script 过期。 */
    const snapPlan = snap.plan;
    if (
      snapPlan != null &&
      typeof snapPlan === "object" &&
      typeof (snapPlan as { planId?: unknown }).planId === "string"
    ) {
      setPlan(snapPlan as AdPlan);
      setCreativeCheck(
        snap.creativeCheck != null && typeof snap.creativeCheck === "object"
          ? (snap.creativeCheck as CreativeSelfCheckResult)
          : null
      );
      setEditedBudget(str(snap.editedBudget));
      setEditedGeo(
        Array.isArray(snap.editedGeo)
          ? snap.editedGeo.filter((g): g is string => typeof g === "string")
          : []
      );
      setEditedNegativesText(str(snap.editedNegativesText));
      setEditedSchedules(
        Array.isArray(snap.editedSchedules)
          ? (snap.editedSchedules as AdPlanAdSchedule[])
          : []
      );
      setConfirm(
        snap.confirm != null && typeof snap.confirm === "object"
          ? (snap.confirm as ConfirmResult)
          : null
      );
      setScriptSource(
        typeof snap.scriptSource === "string" ? snap.scriptSource : null
      );
      setScriptFingerprint(
        typeof snap.scriptFingerprint === "string" ? snap.scriptFingerprint : null
      );
    }
  };

  /* 自动保存：URL/关键词/口吻/语言按 offer 隔离，刷新不丢（URL 参数优先于快照） */
  const { restored } = useWorkState({
    page: "ads-auto",
    offerId,
    label: null,
    buildSnapshot: () => ({
      version: 1,
      urlsText,
      kwText,
      language,
      copyStyle,
      googleAccountId,
      bidCurrency,
      fxRate,
      promotion,
      /* 计划与编辑值一并保存：刷新后计划/改过的预算地域否词排期/确认与 Script 不丢。 */
      plan,
      creativeCheck,
      editedBudget,
      editedGeo,
      editedNegativesText,
      editedSchedules,
      confirm,
      scriptSource,
      scriptFingerprint,
    }),
    isMeaningful: (snap) =>
      Boolean(
        (snap.urlsText as string)?.trim() || (snap.kwText as string)?.trim()
      ),
    applySnapshot: applyAdsAutoSnapshot,
    watch: [offerId, urlsText, kwText, language, copyStyle, googleAccountId, bidCurrency, fxRate, promotion, plan, creativeCheck, editedBudget, editedGeo, editedNegativesText, editedSchedules, confirm, scriptSource, scriptFingerprint],
  });

  /* 全局当前 offer：?offerId= 显式传入时以 URL 为准并更新记忆；
     直接进页面没带 offerId 时，用上次选的 offer（选一次，到处带）。
     useWorkState 只在挂载时恢复一次（当时 offerId 还是 null），回落时这里显式补恢复。 */
  useEffect(() => {
    if (initialOfferId) {
      setLastOfferId(initialOfferId);
      return;
    }
    const last = getLastOfferId();
    if (last) {
      setOfferId(last);
      void (async () => {
        try {
          const res = await loadWorkStateAction("ads-auto", last);
          if (res.ok && res.data.state) applyAdsAutoSnapshot(res.data.state);
        } catch {
          /* 恢复失败不打断 */
        }
      })();
      return;
    }
    // 手动 Offer：库里记忆为空时跟随手动 Offer（工作表存的 adlinklab:manualOffer）。
    // 手动 Offer 没有 id，不调 getOfferAction、不写库里记忆。
    const manual = getManualOffer();
    if (!manual) return;
    setOfferNameFromOffer(manual.name);
    // URL 只补空不覆盖：?urls= 参数优先；同时把 urlUrlsRef 置为手动 URL，
    // 防止之后完成的快照恢复用旧快照 URL 覆盖新鲜的手动 URL（快照恢复跳过有 URL 参数的情况）。
    const mUrl = manual.url.trim();
    if (!searchParams.get("urls") && mUrl && !urlsText.trim()) {
      setUrlsText(mUrl);
      urlUrlsRef.current = mUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 取某 offer 的投放选词（优先）/ 投流关键词（回落），转成 kwText 行，并带回来源页 */
  const loadLaunchKeywordLines = async (
    oid: string
  ): Promise<{ lines: string[]; from: "keyword-launch" | "traffic-planner" | null }> => {
    for (const page of ["keyword-launch", "traffic-planner"] as const) {
      const res = await loadWorkStateAction(page, oid);
      if (!res.ok || !res.data.state) continue;
      const rows = (res.data.state.rows ?? res.data.state.keywords ?? []) as Array<{
        keyword?: unknown;
        matchType?: unknown;
      }>;
      const lines: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const kw = typeof r.keyword === "string" ? r.keyword.trim() : "";
        if (!kw || seen.has(kw.toLowerCase())) continue;
        seen.add(kw.toLowerCase());
        const mt =
          page === "keyword-launch" && typeof r.matchType === "string"
            ? r.matchType.trim().toLowerCase()
            : "phrase";
        // phrase 是默认，不写后缀；只给 exact / broad 写后缀
        lines.push(mt && mt !== "phrase" ? `${kw}, ${mt}` : kw);
      }
      if (lines.length > 0) return { lines, from: page };
    }
    return { lines: [], from: null };
  };

  /* 生效 offer：?offerId= 显式传入，或上次选的 offer 回落（选一次，到处带）。
     没选 offer 时关键词框保持空（旧数据是历史，不自动进框）。 */
  const resolveOfferId = async (): Promise<string | null> => {
    return offerId;
  };

  /* 关键词联动：恢复完成后仍为空时，从该 offer 的投放选词快照取定好的词 */
  useEffect(() => {
    if (!restored) return;
    if (kwText.trim() || urlKwRef.current != null) return;
    let cancelled = false;
    (async () => {
      try {
        const oid = await resolveOfferId();
        if (!oid || cancelled) return;
        const { lines, from } = await loadLaunchKeywordLines(oid);
        if (lines.length > 0 && from && !cancelled) {
          setKwText((prev) => (prev.trim() ? prev : lines.join("\n")));
          setKwSource({ from, count: lines.length });
        }
      } catch {
        /* 取不到就不填 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, offerId]);
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
            currency: a.currency,
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

  async function requestPlan(
    keywords: Array<{ text: string; matchType?: string }> | undefined
  ) {
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
    setKeywordCheck({ status: "idle", results: [], error: null });
    // P1-14：生成前 Preflight 门禁（已选账号时）：error 真正拦截生成；
    // warn/degraded 只展示，不拦截。未选账号时跳过（服务端生成不依赖账号）。
    if (googleAccountId.trim()) {
      const pf = await runPreflightAction({
        accountId: googleAccountId.trim(),
        landingUrl: urls[0],
      });
      if (pf.ok) {
        setPreflightResult(pf.data);
        if (pf.data.verdict === "blocked") {
          setError(d.preflight.blockedGenerate);
          setGenerating(false);
          return;
        }
      } else {
        // Preflight 本身失败 → 不硬拦生成（服务端确认时仍有封停拦截），只记录。
        setPreflightResult(null);
      }
    }
    try {
      // 只有一个 URL 且用户粘贴了页面文字时，用手动文字跳过抓取（Amazon 等反爬站点）
      const manual = manualText.trim();
      const pageTexts = manual && urls.length === 1 ? [manual] : undefined;
      const res = await requestAdPlanAction(urls, {
        language,
        googleAccountId: googleAccountId.trim() || undefined,
        pageTexts,
        keywords: keywords && keywords.length ? keywords : undefined,
        copyStyle,
        // 专家营销：选中 SERP 抓取时带上；其他口吻不传。
        serpCaptureId:
          copyStyle === "expert" && serpCaptureId ? serpCaptureId : undefined,
        // 当前优惠（用户填店铺真实优惠，留空=没有）：传给生成提示词，AI 用它写促销钩子，绝不编造。
        promotion: promotion.trim() || undefined,
        // 汇率（1 USD = X 目标货币）：只要合法就传，服务端只在需要换算时用；
        // 不能只在 bidCurrency ≠ USD 时传——用户选了 CNY 账户直接点生成时，
        // bidCurrency 还是 USD，但服务端按账户货币换算需要汇率，缺了会拒绝。
        fxRate:
          Number.isFinite(parseFloat(fxRate)) &&
          parseFloat(fxRate) > 0
            ? parseFloat(fxRate)
            : undefined,
      });
      if (res.ok) {
        setPlan(res.data.plan);
        setCreativeCheck(res.data.creativeCheck ?? null);
        setEditedBudget(String(res.data.plan.campaign.dailyBudget.amount));
        // 计划货币为准：预算刚从计划填入，已是计划货币。出价统一走投流页快照，无需换算本地出价。
        const planCur = res.data.plan.campaign.dailyBudget.currency || "USD";
        if (planCur !== bidCurrency) {
          setBidCurrency(planCur);
          ensureFxRateFor(planCur);
        }
        setEditedGeo(res.data.plan.campaign.geoTargets);
        // P1-25：否词/排期编辑器初始值 = 计划生成值（否词取首组；排期取计划级）。
        setEditedNegativesText(
          (res.data.plan.adGroups[0]?.group.negativeKeywords ?? [])
            .map((k) =>
              k.matchType === "EXACT" ? `[${k.text}]` : k.matchType === "PHRASE" && /\s/.test(k.text) ? `"${k.text}"` : k.text
            )
            .join("\n")
        );
        setEditedSchedules(res.data.plan.adSchedules ?? []);
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

  async function onGenerate() {
    // 用户在投放选词里定好的关键词：每行一个，可带匹配方式 "词, exact/phrase/broad"
    const keywords = kwText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [text, mt] = line.split(",").map((s) => s.trim());
        return { text, matchType: (mt || "phrase").toUpperCase() };
      })
      .filter((k) => k.text);
    await requestPlan(keywords.length ? keywords : undefined);
  }

  /* 关键词 AI 检查：逐词判相关性与政策风险，结果不静默失败。 */
  async function runKeywordCheck() {
    if (!plan) return;
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const b of plan.adGroups) {
      for (const k of b.group.keywords) {
        const t = k.text.trim();
        if (t && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          keywords.push(t);
        }
      }
    }
    if (keywords.length === 0) {
      setKeywordCheck({ status: "done", results: [], error: null });
      return;
    }
    setKeywordCheck({ status: "checking", results: [], error: null });
    const res = await checkKeywordsAction({
      productDescription: manualText.trim() || urlsText.trim(),
      // Offer 名优先用 Offer 实体；没有则用计划系列名兜底（生成后必有），
      // 保证不传空字符串（接口要求 offerName 非空）。
      offerName: offerNameFromOffer?.trim() || plan.campaign.name || "Offer",
      offerUrl: parseUrls()[0],
      keywords,
    });
    if (res.ok) {
      setKeywordCheck({ status: "done", results: res.data.results, error: null });
    } else {
      setKeywordCheck({ status: "error", results: [], error: res.error });
    }
  }

  /* 移除已标记关键词：带剩余词重新生成计划，使服务端存储的计划也不再含它们
     （确认 / Script / 文案包都只认服务端计划，本地只改展示无效）。 */
  async function removeFlaggedKeywords() {
    if (!plan || keywordCheck.status !== "done") return;
    const flagged = new Set(
      keywordCheck.results
        .filter((r) => r.verdict !== "relevant")
        .map((r) => r.keyword.trim().toLowerCase())
    );
    const remaining: Array<{ text: string; matchType?: string }> = [];
    for (const b of plan.adGroups) {
      for (const k of b.group.keywords) {
        if (!flagged.has(k.text.trim().toLowerCase())) {
          remaining.push({ text: k.text, matchType: k.matchType });
        }
      }
    }
    if (remaining.length === 0) return;
    // 同步 kwText，使后续重新生成也用这套干净词。词数变了，来源标注失效，清掉。
    setKwText(
      remaining
        .map((k) =>
          k.matchType && k.matchType.toLowerCase() !== "phrase"
            ? `${k.text}, ${k.matchType.toLowerCase()}`
            : k.text
        )
        .join("\n")
    );
    setKwSource(null);
    await requestPlan(remaining);
  }

  async function onConfirm() {
    if (!plan) return;
    setConfirming(true);
    setError(null);
    try {
      // 出价统一：最高 CPC 取自投流页快照的推荐出价（已换算为计划货币）；无快照数据时不传。
      const maxCpc = snapshotMaxCpc ?? undefined;
      const budgetNum = parseFloat(editedBudget);
      const res = await confirmAdPlanAction(plan.planId, maxCpc, {
        dailyBudget: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : undefined,
        // 预算与出价共用一个计划货币 bidCurrency。
        dailyBudgetCurrency: bidCurrency || undefined,
        maxCpcCurrency: maxCpc !== undefined ? bidCurrency : undefined,
        geoTargets: editedGeo.length ? editedGeo : undefined,
        // P1-25：否词（非空行）+ 排期（确认时全量替换）。
        negativeKeywords: editedNegativesText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        adSchedules: editedSchedules,
      });
      if (res.ok) {
        setConfirm(res.data);
        const s = await getCreateCampaignScriptAction(plan.planId);
        if (s.ok) {
          setScriptSource(s.data.source);
          // 记录本次生成时的数值指纹（与 currentScriptFingerprint 同算法）。
          setScriptFingerprint(
            JSON.stringify({
              maxCpc: snapshotMaxCpc,
              budget: editedBudget,
              currency: bidCurrency,
              geo: editedGeo,
              negatives: editedNegativesText,
              schedules: editedSchedules,
            })
          );
        }
      } else {
        setError(res.error);
      }
    } finally {
      setConfirming(false);
    }
  }

  // 出价统一：出价只在投流页（/ai/traffic-planner）输入和测算，这里只读引用快照。
  // 本地不再保留 bidStrategy / bidCommission / bidCvr / bidRoi / bidCpc 输入态；
  // maxCpc 取自投流页快照的推荐出价（见下方 plannerProfit / recommendedBid）。
  // bidCurrency / fxRate 保留：预算货币选择与 USD→计划货币展示换算仍需要它们。

  // 汇率：fxRate = "1 USD = X 目标货币"（如 7.10 表示 1 USD = 7.10 CNY）。
  // 只在 bidCurrency ≠ USD 时显示。用户手改过则按货币记住（不被默认值覆盖）。
  const fxRateEditedRef = useRef(false);
  const fxRateCurrencyRef = useRef<string | null>(null);

  const fxRateDefaultFor = (cur: string) => (cur === "CNY" ? "7.10" : "1.0");

  // 某货币相对 USD 的汇率（USD 本身为 1；非 USD 若是用户手改过的该货币汇率则用手改值，否则用默认值）。
  const rateForCurrency = (cur: string): number => {
    if (cur === "USD") return 1;
    if (fxRateEditedRef.current && fxRateCurrencyRef.current === cur) {
      const r = parseFloat(fxRate);
      if (Number.isFinite(r) && r > 0) return r;
    }
    const d = parseFloat(fxRateDefaultFor(cur));
    return Number.isFinite(d) && d > 0 ? d : 1;
  };

  // 金额换算（走 USD 中转）：from → USD → to。非法数字原样返回。
  const convertAmount = (value: string, from: string, to: string): string => {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || from === to) return value;
    const out = (n / rateForCurrency(from)) * rateForCurrency(to);
    return String(Math.round(out * 10000) / 10000);
  };

  // 出价区展示用换算因子：USD 推导值 × 它 = 计划货币下的值。
  const fxRateNum = parseFloat(fxRate);
  const fxFactor =
    bidCurrency === "USD"
      ? 1
      : Number.isFinite(fxRateNum) && fxRateNum > 0
        ? fxRateNum
        : 1;

  /* 出价统一：本地出价测算/数据获取全部删除，出价只读投流页快照。
     快照字段（traffic-planner）：payout / networkCvr / targetReturnRatio，均为 USD 口径。 */
  const [plannerPayout, setPlannerPayout] = useState<string | null>(null);
  const [plannerCvrPct, setPlannerCvrPct] = useState<string | null>(null);
  /** 目标产出比：只读，取自投流页快照（投流页是唯一输入地）。 */
  const [plannerTargetRatio, setPlannerTargetRatio] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 库里 Offer 按 offerId 读快照；手动 Offer（offerId 为空）读手动快照（offerId null）。
        const res = await loadWorkStateAction("traffic-planner", offerId);
        if (cancelled || !res.ok || !res.data.state) return;
        const snap = res.data.state as Record<string, unknown>;
        const str = (v: unknown) =>
          typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
        const p = str(snap.payout);
        const cvr = str(snap.networkCvr);
        const ratio = str(snap.targetReturnRatio);
        if (offerId) {
          if (p) setPlannerPayout(p);
          if (cvr) setPlannerCvrPct(cvr);
          if (ratio) setPlannerTargetRatio(ratio);
        } else {
          // 手动快照只补空不覆盖已有值（快照是异步到的，别覆盖已算出的值）。
          if (p) setPlannerPayout((prev) => (prev != null && prev !== "" ? prev : p));
          if (cvr) setPlannerCvrPct((prev) => (prev != null && prev !== "" ? prev : cvr));
          if (ratio) setPlannerTargetRatio((prev) => (prev != null && prev !== "" ? prev : ratio));
        }
      } catch {
        /* 取不到就显示空状态 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  const plannerProfit = (() => {
    const payout = plannerPayout !== null ? parseFloat(plannerPayout) : NaN;
    const cvrPct = plannerCvrPct !== null ? parseFloat(plannerCvrPct) : NaN;
    const ratio = plannerTargetRatio !== null ? parseFloat(plannerTargetRatio) : NaN;
    if (!Number.isFinite(payout) || payout <= 0) return null;
    if (!Number.isFinite(cvrPct) || cvrPct <= 0) return null;
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    return calcProfit({ payout, cpc: 0, cvrF: cvrPct / 100, targetReturnRatio: ratio });
  })();
  const recommendedBid = plannerProfit?.maxCpcAtTargetRatio ?? null;
  const plannerBreakEven = plannerProfit?.breakEvenCpc ?? null;
  /** 确认/Script 用的最高 CPC：快照推荐出价（USD）→ 计划货币；无快照数据时不传（用计划默认）。 */
  const snapshotMaxCpc =
    recommendedBid != null
      ? Math.round(recommendedBid * fxFactor * 10000) / 10000
      : null;
  /* Script 数值指纹：出价（快照推荐）/预算/货币/地域/否词/排期任一改动，Script 即过期，提示重新生成。 */
  const currentScriptFingerprint = (() =>
    JSON.stringify({
      maxCpc: snapshotMaxCpc,
      budget: editedBudget,
      currency: bidCurrency,
      geo: editedGeo,
      negatives: editedNegativesText,
      schedules: editedSchedules,
    }))();
  const scriptStale =
    scriptSource != null &&
    scriptFingerprint != null &&
    currentScriptFingerprint !== scriptFingerprint;

  // 切到某货币后，若 fxRate 不是该货币的汇率，填该货币默认值并清手改标记。
  const ensureFxRateFor = (cur: string) => {
    if (cur !== "USD" && fxRateCurrencyRef.current !== cur) {
      setFxRate(fxRateDefaultFor(cur));
      fxRateEditedRef.current = false;
      fxRateCurrencyRef.current = cur;
    }
  };

  /** 切换计划货币：必须换算金额（editedBudget），不许只改标签。
      出价已统一走投流页快照，无需换算本地出价。 */
  const changePlanCurrency = (next: string) => {
    const target = next || "USD";
    if (target === bidCurrency) return;
    setEditedBudget((prev) => convertAmount(prev, bidCurrency, target));
    setBidCurrency(target);
    ensureFxRateFor(target);
  };

  // 货币选项只有两项：[USD, X]，X = 已选账户货币（非 USD 时）否则 CNY，去重。
  const selectedAccountCurrency = (
    googleAccounts.find((a) => a.id === googleAccountId)?.currency || ""
  ).toUpperCase();
  const planCurrencyOptions = Array.from(
    new Set([
      "USD",
      selectedAccountCurrency && selectedAccountCurrency !== "USD"
        ? selectedAccountCurrency
        : "CNY",
    ])
  );
  // Offer 名（关键词检查用）。
  const [offerNameFromOffer, setOfferNameFromOffer] = useState<string | null>(null);

  // ?offerId= 时取 Offer 名给关键词检查用。出价相关（佣金/payout）不再这里带入，
  // 统一走投流页快照（见下方 plannerPayout / plannerCvrPct）。
  useEffect(() => {
    if (!offerId) {
      setOfferNameFromOffer(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await getOfferAction(offerId);
      if (cancelled || !res.ok) return;
      if (res.data.name) setOfferNameFromOffer(res.data.name);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);


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

  async function onCopyBrand() {
    const text = `${brandName.trim()}${brandSymbol}`;
    if (!brandName.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setBrandCopied(true);
      setTimeout(() => setBrandCopied(false), 2000);
    } catch {
      /* 忽略复制失败 */
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
        {/* 插件抓取 + AI 识别：Amazon 等反爬页面抓不到时，用插件抓商品页，AI 提取标题/价格/卖点填入下方 */}
        <CapturePicker
          label={d.form.captureFillProduct}
          onPick={(c) => void fillProductFromCapture(c)}
        />
        {captureFilling && (
          <p className="mt-1 text-xs text-ink/55">{d.form.captureFilling}</p>
        )}
        {captureNote && !captureFilling && (
          <p className="mt-1 text-xs text-ink/55">{captureNote}</p>
        )}
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
              onChange={(e) => {
                const id = e.target.value;
                setGoogleAccountId(id);
                // 选账户时货币跟随账户：账户货币非 USD 时把计划金额换算过去；USD 时不变。
                const cur = (
                  googleAccounts.find((a) => a.id === id)?.currency || ""
                ).toUpperCase();
                if (cur && cur !== "USD") changePlanCurrency(cur);
              }}
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
          {/* 汇率：选了非 USD 结算账户时在生成前可见（出价区的字段只在生成后才有，
              只靠它的话，选 CNY 账户直接点生成会因缺汇率被拒绝）。与出价区字段共用同一 state。 */}
          {selectedAccountCurrency && selectedAccountCurrency !== "USD" && (
            <div>
              <label className={labelClass} htmlFor="ads-auto-fxrate">
                {d.bidStrategy.fxRateLabel}
              </label>
              <input
                id="ads-auto-fxrate"
                inputMode="decimal"
                value={fxRate}
                onChange={(e) => {
                  setFxRate(e.target.value);
                  fxRateEditedRef.current = true;
                  fxRateCurrencyRef.current = selectedAccountCurrency;
                }}
                placeholder="7.10"
                className={`${inputClass} w-28`}
              />
              <p className="mt-1 text-xs text-ink/55">
                1 USD = {fxRate} {selectedAccountCurrency}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {generating ? d.form.generating : d.form.generate}
          </button>
        </div>

        {/* 当前优惠：用户填店铺真实优惠（生成前输入，生成后改了下次生成生效），AI 用它写促销钩子，留空=没有，绝不编造折扣。 */}
        <div className="mt-3">
          <label className={labelClass} htmlFor="ads-auto-promotion">
            {d.form.promotionLabel}
          </label>
          <input
            id="ads-auto-promotion"
            inputMode="text"
            value={promotion}
            onChange={(e) => setPromotion(e.target.value)}
            placeholder={d.form.promotionPlaceholder}
            className={inputClass}
          />
        </div>

        {/* 直链轮换：与返利网直链轮换同一份脚本（标签 → Script）。
            AdLinkLab 只生成脚本；轮换本身在 Google Ads 里跑（脚本粘过去、每小时运行），不是点一下就自动轮换。 */}
        <div className={`${cardClass} mt-3`}>
          <h3 className="text-sm font-semibold text-ink">{d.form.rotation.title}</h3>
          <p className="mt-1 text-xs text-ink/55">{d.form.rotation.hint}</p>
          <div className="mt-3">
            <label className={labelClass} htmlFor="ads-auto-rotation-label">
              {d.form.rotation.labelLabel}
            </label>
            <input
              id="ads-auto-rotation-label"
              inputMode="text"
              value={rotationLabel}
              onChange={(e) => setRotationLabel(e.target.value)}
              placeholder={d.form.rotation.labelPlaceholder}
              className={`${inputClass} font-mono`}
            />
            {!rotationLabel.trim() ? (
              <p className="mt-1 text-xs text-ink/55">{d.form.rotation.emptyLabel}</p>
            ) : !/^[a-zA-Z0-9_-]+$/.test(rotationLabel.trim()) ? (
              <p className="mt-1 text-xs text-red-600">{d.form.rotation.labelInvalid}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onGenerateRotationScript}
            disabled={!/^[a-zA-Z0-9_-]+$/.test(rotationLabel.trim()) || rotationGenerating}
            className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {rotationGenerating ? d.form.rotation.generating : d.form.rotation.generate}
          </button>
          {rotationError ? (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {rotationError}
            </p>
          ) : null}
          {rotationSource ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">{d.form.rotation.resultTitle}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onCopyRotationScript}
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
                  >
                    {rotationCopied ? d.form.rotation.copied : d.form.rotation.copy}
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadRotationScript}
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
                  >
                    {d.form.rotation.download}
                  </button>
                </div>
              </div>
              <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-ink/10 bg-ink p-4 font-mono text-xs text-paper">
                {rotationSource}
              </pre>
            </div>
          ) : null}
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

        {/* 投放选词里定好的关键词（可选）：填了就用这套，不再 AI 生成 */}
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <label className={labelClass} htmlFor="ads-auto-keywords">
              {d.form.keywordsLabel}
            </label>
            <button
              type="button"
              onClick={async () => {
                try {
                  const oid = await resolveOfferId();
                  if (!oid) return;
                  const { lines, from } = await loadLaunchKeywordLines(oid);
                  if (lines.length === 0) return;
                  const existing = new Set(
                    kwText.split("\n").map((l) => l.split(",")[0]?.trim().toLowerCase()).filter(Boolean)
                  );
                  const fresh = lines.filter(
                    (l) => !existing.has((l.split(",")[0] ?? "").trim().toLowerCase())
                  );
                  if (fresh.length > 0) {
                    setKwText((prev) =>
                      prev.trim() ? `${prev.trim()}\n${fresh.join("\n")}` : fresh.join("\n")
                    );
                    if (from) setKwSource({ from, count: fresh.length });
                  }
                } catch {
                  /* 取不到就不填 */
                }
              }}
              className="text-xs text-ink/60 hover:text-ink"
            >
              {d.form.importLaunchKeywords}
            </button>
          </div>
          {kwSource && (
            <p className="mb-1 text-xs text-ink/60">
              {d.form.kwAutoNote
                .replace("{source}", kwSourceLabels[kwSource.from])
                .replace("{count}", String(kwSource.count))}{" "}
              <button
                type="button"
                onClick={() => {
                  setKwText("");
                  setKwSource(null);
                }}
                className="text-ink/70 underline hover:text-ink"
              >
                {d.form.kwAutoClear}
              </button>
            </p>
          )}
          <textarea
            id="ads-auto-keywords"
            rows={3}
            value={kwText}
            onChange={(e) => {
              setKwText(e.target.value);
              setKwSource(null);
            }}
            placeholder={d.form.keywordsPlaceholder}
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-xs text-ink/55">{d.form.keywordsHint}</p>
        </div>

        {/* 文案口吻：官方口吻（Official Site 结构）/ 联盟安全口吻 */}
        <div className="mt-3">
          <span className={labelClass}>{d.form.copyStyleLabel}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {(
              [
                { value: "official", ...d.form.copyStyleOfficial },
                { value: "affiliate", ...d.form.copyStyleAffiliate },
                { value: "expert", ...d.form.copyStyleExpert },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCopyStyle(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  copyStyle === opt.value
                    ? "border-signal bg-signal/10 font-medium text-ink"
                    : "border-ink/15 text-ink/60 hover:bg-ink/5"
                }`}
              >
                <span className="font-medium">{opt.title}</span>
                <span className="ml-1 text-xs text-ink/55">{opt.desc}</span>
              </button>
            ))}
          </div>
          {copyStyle === "official" && (
            <p className="mt-1 text-xs text-amber-700">{d.form.copyStyleOfficialWarn}</p>
          )}
          {copyStyle === "expert" && (
            <div className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
              <p className={labelClass}>{d.form.serpSourceLabel}</p>
              <p className="mt-1 text-xs text-ink/55">{d.form.serpSourceHint}</p>
              <p className="mt-0.5 text-xs text-ink/55">{d.form.serpSourceAuto}</p>
              <button
                type="button"
                onClick={loadSerpCaptures}
                disabled={serpCapturesLoading}
                className="mt-2 rounded border border-ink/15 px-2 py-0.5 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
              >
                {serpCapturesLoading ? d.form.serpSourceLoading : d.form.serpSourceRefresh}
              </button>
              {serpCapturesLoading ? (
                <p className="mt-2 text-xs text-ink/55">{d.form.serpSourceLoading}</p>
              ) : serpCaptures.length === 0 ? (
                <p className="mt-2 text-xs text-ink/55">{d.form.serpSourceNone}</p>
              ) : (
                <select
                  value={serpCaptureId ?? ""}
                  onChange={(e) => onPickSerpCapture(e.target.value)}
                  className={`${inputClass} mt-2`}
                >
                  <option value="">{d.form.serpSourcePick}</option>
                  {serpCaptures.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.title || c.finalUrl).slice(0, 80)}
                    </option>
                  ))}
                </select>
              )}
              {serpCaptureId && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink/70">
                  <span>
                    {d.form.serpSourceSelected}{" "}
                    {(serpCaptures.find((c) => c.id === serpCaptureId)?.title ||
                      serpCaptures.find((c) => c.id === serpCaptureId)?.finalUrl ||
                      serpCaptureId
                    ).slice(0, 100)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPickSerpCapture("")}
                    className="rounded border border-ink/15 px-2 py-0.5 text-xs hover:bg-ink/5"
                  >
                    {d.form.serpSourceClear}
                  </button>
                </div>
              )}
              {serpCaptureError && (
                <p className="mt-1 text-xs text-red-600">{serpCaptureError}</p>
              )}
            </div>
          )}
        </div>

        {/* 品牌符号生成器：Nike → Nike®（® 在 Google Ads 里显示为右上角小字） */}
        <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
          <p className={labelClass}>{d.form.brandSymbolTitle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={d.form.brandSymbolPlaceholder}
              className={`${inputClass} w-40`}
            />
            {(["®", "™"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setBrandSymbol(s)}
                className={`rounded-lg border px-3 py-1.5 text-base ${
                  brandSymbol === s
                    ? "border-signal bg-signal/10 font-bold"
                    : "border-ink/15 hover:bg-ink/5"
                }`}
              >
                {s}
              </button>
            ))}
            <span className="text-ink/40">→</span>
            <code className="rounded bg-ink/5 px-2 py-1 text-base">
              {brandName.trim() ? `${brandName.trim()}${brandSymbol}` : "Nike®"}
            </code>
            <button
              type="button"
              onClick={onCopyBrand}
              disabled={!brandName.trim()}
              className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {brandCopied ? d.form.copied : d.form.copy}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink/55">{d.form.brandSymbolHint}</p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>{error}</p>
          {/network error/i.test(error) && (
            <p className="mt-1">
              {d.errors.networkHint}{" "}
              <a href="/admin/ai-settings" className="underline underline-offset-2 hover:opacity-80">
                {d.errors.goTestConnection}
              </a>
            </p>
          )}
        </div>
      ) : null}

      {preflightResult && (
        <div className="mt-4 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm">
          <p className="font-medium text-ink">
            {preflightResult.verdict === "ready"
              ? d.preflight.verdictReady
              : preflightResult.verdict === "degraded"
                ? d.preflight.verdictDegraded
                : d.preflight.verdictBlocked}
          </p>
          <ul className="mt-1 space-y-0.5 text-ink/70">
            {preflightResult.checks
              .filter((c) => c.status === "warn" || c.status === "error")
              .map((c) => (
                <li key={c.key}>
                  [{c.status}] {(d.preflight.checkLabels as Record<string, string>)[c.key] ?? c.key}：
                  {c.message}
                </li>
              ))}
          </ul>
        </div>
      )}

      {plan ? (
        <>
          <h2 className="mt-6 text-base font-semibold text-ink">{d.preview.title}</h2>
          <PlanPreview
            plan={plan}
            d={d}
            budget={editedBudget}
            onBudgetChange={setEditedBudget}
            budgetCurrency={bidCurrency}
            onBudgetCurrencyChange={changePlanCurrency}
            currencyOptions={planCurrencyOptions}
            geo={editedGeo}
            onGeoChange={setEditedGeo}
            keywordCheck={keywordCheck}
            onCheckKeywords={() => void runKeywordCheck()}
            onRemoveFlagged={() => void removeFlaggedKeywords()}
            creativeCheck={creativeCheck}
            negativesText={editedNegativesText}
            onNegativesChange={setEditedNegativesText}
            schedules={editedSchedules}
            onSchedulesChange={setEditedSchedules}
          />

          {/* 出价策略：只读引用投流页快照。出价只在投流页输入和测算，这里不做任何输入。 */}
          <div className={`mt-4 ${cardClass}`}>
            <h3 className="text-sm font-semibold text-ink">{d.bidStrategy.title}</h3>
            <p className="mt-1 text-sm text-ink/65">{d.bidStrategy.description}</p>
            {plannerProfit ? (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <div className="rounded-lg bg-ink/[0.03] px-3 py-2">
                    <dt className="text-ink/55">{d.bidStrategy.recommendedBreakEven}</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {plannerBreakEven !== null
                        ? `${(plannerBreakEven * fxFactor).toFixed(4)} ${bidCurrency}`
                        : "—"}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-ink/[0.03] px-3 py-2">
                    <dt className="text-ink/55">{d.bidStrategy.recommendedValue}</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {snapshotMaxCpc !== null
                        ? `${snapshotMaxCpc.toFixed(4)} ${bidCurrency}`
                        : "—"}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-ink/[0.03] px-3 py-2">
                    <dt className="text-ink/55">{d.bidStrategy.targetReturnRatioLabel}</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {plannerTargetRatio ?? "—"}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-ink/[0.03] px-3 py-2">
                    <dt className="text-ink/55">{d.bidStrategy.currencyLabel}</dt>
                    <dd className="mt-0.5 font-medium text-ink">{bidCurrency}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-ink/55">{d.bidStrategy.recommendedHint}</p>
                <Link
                  href={offerId ? `/ai/traffic-planner?offerId=${encodeURIComponent(offerId)}` : "/ai/traffic-planner"}
                  className="mt-2 inline-block text-sm font-medium text-signal underline"
                >
                  {d.bidStrategy.goToPlanner}
                </Link>
              </>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-ink/20 p-4 text-center">
                <p className="text-sm text-ink/70">{d.bidStrategy.emptyDesc}</p>
                <Link
                  href={offerId ? `/ai/traffic-planner?offerId=${encodeURIComponent(offerId)}` : "/ai/traffic-planner"}
                  className="mt-2 inline-block rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper"
                >
                  {d.bidStrategy.emptyButton}
                </Link>
              </div>
            )}
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
                <p className="mt-1 text-xs">
                  {d.confirm.archiveCreated}{" "}
                  <a
                    href={
                      offerId
                        ? `/reports/launch?offerId=${encodeURIComponent(offerId)}`
                        : "/reports/launch"
                    }
                    className="font-medium underline hover:opacity-80"
                  >
                    {d.confirm.viewArchive} →
                  </a>
                </p>
              </div>
            )}
          </div>

          {confirm && scriptSource ? (
            <div className={`mt-4 ${cardClass}`}>
              <h3 className="text-sm font-semibold text-ink">create-campaign Script</h3>
              <p className="mt-1 text-sm text-ink/65">{d.confirm.scriptHint}</p>
              {scriptStale ? (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  {d.confirm.scriptStale}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
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
                <button
                  type="button"
                  onClick={() => void onConfirm()}
                  disabled={confirming}
                  className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${
                    scriptStale
                      ? "border-signal bg-signal/10 font-medium text-signal hover:bg-signal/20"
                      : "border-ink/15 text-ink hover:bg-ink/5"
                  }`}
                >
                  {confirming ? d.confirm.regenerating : `↻ ${d.confirm.regenerate}`}
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

          {/* 下一步：计划已生成，继续走完投流 */}
          <div className="mt-4 rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
            <p className="text-sm font-semibold text-ink">🚀 {d.nextStep.title}</p>
            <p className="mt-1 text-xs text-ink/55">{d.nextStep.hint}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href="/campaigns"
                className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                📢 {d.nextStep.toCampaigns} →
              </a>
              <a
                href="/tracking-links"
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                🔗 {d.nextStep.toTracking} →
              </a>
              <a
                href="/monitoring"
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                📊 {d.nextStep.toMonitoring} →
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
