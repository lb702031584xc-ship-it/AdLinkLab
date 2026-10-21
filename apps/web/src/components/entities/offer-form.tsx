"use client";

import { useState, useTransition, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOfferAction } from "@/lib/api/entity-actions";
import { prescreenOffersAction } from "@/lib/api/paid-data-actions";
import { setLastOfferId } from "@/lib/current-offer";
import { useI18n } from "@/i18n/I18nProvider";
import { coachCheckAction, type CoachFinding } from "@/lib/api/coach-actions";
import { CoachGate, hasCoachBlock } from "@/components/coach/coach-gate";
import { CapturePicker } from "@/components/ai/capture-picker";
import {
  parseOfferCaptureAiAction,
  parseOfferScreenshotAction,
} from "@/lib/api/ai-actions";
import type { OfferPageCapture } from "@/lib/api/ai";
import {
  loadWorkStateAction,
  saveWorkStateAction,
} from "@/lib/api/work-state-actions";
import { calcProfit } from "@/lib/profit-calc";
import { extractBrandName } from "@/lib/brand-extract";

const inputClassName =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClassName = "mb-1 block text-sm font-medium text-ink/70";

const OFFER_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

const OFFER_SOURCES = ["affiliate", "amazon", "cashback"] as const;

/** #9/#4：转化流取值域（与 Offer.conversionFlow 注释一致；空 = 未设置）。 */
const CONVERSION_FLOWS = [
  "soi_simple",
  "one_click",
  "pin_submit",
  "cc_submit",
  "free_trial",
  "pay_per_call",
  "ftd",
  "cps_sale",
  "mixed",
] as const;

/** P1-15：节日主题选项（value = slug；label 为英文节日名，中英通用）。 */
const FESTIVAL_THEME_OPTIONS = [
  { value: "none", label: "无节日主题" },
  { value: "valentines", label: "Valentine's Day（情人节）" },
  { value: "easter", label: "Easter（复活节）" },
  { value: "mothers-day", label: "Mother's Day（母亲节）" },
  { value: "fathers-day", label: "Father's Day（父亲节）" },
  { value: "independence-day", label: "Independence Day（美国独立日）" },
  { value: "back-to-school", label: "Back to School（返校季）" },
  { value: "labor-day", label: "Labor Day（美国劳动节）" },
  { value: "halloween", label: "Halloween（万圣节）" },
  { value: "thanksgiving", label: "Thanksgiving（感恩节）" },
  { value: "black-friday", label: "Black Friday（黑色星期五）" },
  { value: "cyber-monday", label: "Cyber Monday（网络星期一）" },
  { value: "prime-day", label: "Amazon Prime Day" },
  { value: "prime-big-deal-days", label: "Prime Big Deal Days" },
  { value: "christmas", label: "Christmas（圣诞节）" },
  { value: "new-year", label: "New Year（新年）" },
] as const;

function toIsoInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function OfferForm({
  initialSource,
  initialName,
  initialPrice,
  initialAsin,
}: {
  initialSource?: string;
  /** URL 预填：商品名（亚马逊流水线「建 Offer」带入）。 */
  initialName?: string;
  /** URL 预填：均价（亚马逊流水线「建 Offer」带入）。 */
  initialPrice?: string;
  /** URL 预填：来源 ASIN（仅在名称下方提示展示，不入库）。 */
  initialAsin?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initialName ?? "");
  /** 保存并一键初筛：创建成功后立即跑初筛阶梯，结论徽标写回 Offer。 */
  const [prescreenAfterSave, setPrescreenAfterSave] = useState(false);
  const [network, setNetwork] = useState("");
  const [source, setSource] = useState<string>(
    OFFER_SOURCES.includes(initialSource as (typeof OFFER_SOURCES)[number])
      ? (initialSource as string)
      : "affiliate"
  );
  const [destinationUrl, setDestinationUrl] = useState("");
  /** 联盟链接：联盟后台给的带参跟踪链接（选填）。 */
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [status, setStatus] = useState<string>("ACTIVE");
  const [priority, setPriority] = useState("100");
  const [commissionValue, setCommissionValue] = useState("");
  const [commissionType, setCommissionType] = useState("percentage");
  const [avgPrice, setAvgPrice] = useState(initialPrice ?? "");
  const [pickedAt, setPickedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  /* P1-2：品牌名（自动提取仅建议；用户手动改过后不再被自动提取覆盖）。 */
  const [brandName, setBrandName] = useState("");
  const [brandSource, setBrandSource] = useState<string | null>(null);
  const [brandConfidence, setBrandConfidence] = useState<number | null>(null);
  const [brandManual, setBrandManual] = useState(false);
  const [brandExtractNote, setBrandExtractNote] = useState<string | null>(null);
  /* P1-15：节日主题（只影响 RSA 文案，不改变盈利/条款判定）。 */
  const [festivalTheme, setFestivalTheme] = useState("none");
  /* #9/#4：转化流 / 结算周期 / SKU 佣金备注（offer 侧新字段，可空）。 */
  const [conversionFlow, setConversionFlow] = useState("");
  const [payoutCycleDays, setPayoutCycleDays] = useState("");
  const [skuCommissionNote, setSkuCommissionNote] = useState("");
  /* 申请状态（与 status 生命周期独立的维度）：offer 入库 ≠ 能推，记录向网络申请 program 的状态。 */
  const [applicationStatus, setApplicationStatus] = useState("not_applied");
  const [appliedAt, setAppliedAt] = useState("");
  const [applicationNote, setApplicationNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [coachFindings, setCoachFindings] = useState<CoachFinding[]>([]);
  /** 抓取提取 offer 佣金/payout：加载态 + 结果文案 + 原文证据（用户核对）。 */
  const [captureExtracting, setCaptureExtracting] = useState(false);
  const [screenshotExtracting, setScreenshotExtracting] = useState(false);
  const screenshotFileRef = useRef<HTMLInputElement>(null);
  const [captureExtractMsg, setCaptureExtractMsg] = useState<string | null>(null);
  const [captureExtractEvidence, setCaptureExtractEvidence] = useState<{
    commission: string | null;
    payout: string | null;
    price: string | null;
  } | null>(null);
  /** 暂存识别到的 EPC / 转化率（offer 表单无此二栏）：创建成功后同步到投流页快照。 */
  const [extractedEpcCvr, setExtractedEpcCvr] = useState<{
    epc: number | null;
    conversionRate: number | null;
  } | null>(null);
  /** 本次抓取的出价估算（按抓取数据就地算出，仅参考）。 */
  const [bidEstimate, setBidEstimate] = useState<{
    breakEven: number;
    recommended: number;
  } | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.offer;

  const valid =
    name.trim() !== "" &&
    network.trim() !== "" &&
    destinationUrl.trim() !== "";

  /**
   * 智能填入共用逻辑（插件抓取 / 截图识别共用同一套 AI 提取结果）。
   * 只补空不覆盖手填；EPC/转化率暂存（表单无此二栏，创建后同步到投流页）；
   * 有 payout + 转化率时就地用 calcProfit 算出价估算。
   */
  const applyExtractedOffer = (
    o: OfferPageCapture,
    summaryText: string,
    fallbackPrice: number | null
  ) => {
    if (!commissionValue.trim() && o.commissionValue != null && o.commissionType) {
      setCommissionValue(String(o.commissionValue));
      setCommissionType(o.commissionType);
    }
    if (o.network && !network.trim()) setNetwork(o.network);
    if (o.offerName && !name.trim()) setName(o.offerName);
    if (!avgPrice.trim()) {
      if (o.averageOrderValue != null) setAvgPrice(String(o.averageOrderValue));
      else if (fallbackPrice != null) setAvgPrice(String(fallbackPrice));
    }
    // 暂存 EPC / 转化率
    if (o.epc != null || o.conversionRate != null) {
      setExtractedEpcCvr({ epc: o.epc, conversionRate: o.conversionRate });
    } else {
      setExtractedEpcCvr(null);
    }
    // 就地出价估算（按本次提取数据，目标产出比默认 2）
    const effCv = o.commissionValue ?? (commissionValue.trim() ? Number(commissionValue) : NaN);
    const effType = o.commissionType ?? commissionType;
    const effAvg =
      o.averageOrderValue ??
      (avgPrice.trim() ? Number(avgPrice) : NaN) ??
      fallbackPrice;
    let payout: number | null = null;
    if (
      effType === "percentage" &&
      Number.isFinite(effCv) &&
      Number.isFinite(effAvg) &&
      (effAvg as number) > 0
    ) {
      payout = ((effAvg as number) * (effCv as number)) / 100;
    } else if (effType === "fixed" && Number.isFinite(effCv)) {
      payout = effCv as number;
    } else if (o.estimatedPayout != null) {
      payout = o.estimatedPayout;
    }
    const cvrF = o.conversionRate != null ? o.conversionRate / 100 : null;
    if (payout != null && payout > 0 && cvrF != null && cvrF > 0) {
      const r = calcProfit({ payout, cpc: 0, cvrF, targetReturnRatio: 2 });
      if (r.breakEvenCpc != null && r.maxCpcAtTargetRatio != null) {
        setBidEstimate({
          breakEven: Math.round(r.breakEvenCpc * 100) / 100,
          recommended: Math.round(r.maxCpcAtTargetRatio * 100) / 100,
        });
      } else {
        setBidEstimate(null);
      }
    } else {
      setBidEstimate(null);
    }
    // 结果消息
    if (
      o.commissionValue != null ||
      o.estimatedPayout != null ||
      o.averageOrderValue != null ||
      o.epc != null ||
      o.conversionRate != null
    ) {
      let msg = f.captureExtracted.replace("{summary}", summaryText);
      if (o.epc != null || o.conversionRate != null) {
        const parts: string[] = [];
        if (o.epc != null) parts.push(`EPC $${o.epc}`);
        if (o.conversionRate != null) parts.push(`${f.conversionRateLabel}${o.conversionRate}%`);
        msg += `；${f.epcCvrDetected.replace("{parts}", parts.join("、"))}`;
      }
      setCaptureExtractMsg(msg);
      setCaptureExtractEvidence(o.evidence);
    } else {
      setCaptureExtractMsg(f.captureExtractNone);
    }
  };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || pending || hasCoachBlock(coachFindings)) return;
    setError(null);
    const priorityNum = Number(priority);
    start(async () => {
      const cv = Number(commissionValue);
      const ap = Number(avgPrice);
      /* #9/#4：三个新字段走现有 createOfferAction 提交路径（运行时随
         payload 一起 POST）。注意：entity-actions / entities 的 input 类型
         与 API 路由（routes/index.ts）+ offer-engine 尚未接受这三个字段，
         后端补齐前服务端会忽略它们（见补强清单接线说明）。 */
      const payload: Parameters<typeof createOfferAction>[0] & {
        conversionFlow?: string;
        payoutCycleDays?: number;
        skuCommissionNote?: string;
      } = {
        name: name.trim(),
        network: network.trim(),
        source,
        destinationUrl: destinationUrl.trim(),
        affiliateUrl: affiliateUrl.trim() || undefined,
        status,
        priority: Number.isFinite(priorityNum) ? Math.floor(priorityNum) : 100,
        startsAt: toIsoInput(startsAt),
        endsAt: toIsoInput(endsAt),
        commissionValue: commissionValue.trim() !== "" && Number.isFinite(cv) ? cv : undefined,
        commissionType: commissionValue.trim() !== "" ? commissionType : undefined,
        avgPrice: avgPrice.trim() !== "" && Number.isFinite(ap) ? ap : undefined,
        pickedAt: toIsoInput(pickedAt),
        brandName: brandName.trim() || undefined,
        brandNameSource:
          brandName.trim() && brandSource ? brandSource : undefined,
        brandNameConfidence:
          brandName.trim() && brandConfidence !== null
            ? brandConfidence
            : undefined,
        festivalTheme: festivalTheme !== "none" ? festivalTheme : undefined,
        applicationStatus,
        appliedAt: toIsoInput(appliedAt),
        applicationNote: applicationNote.trim() || undefined,
      };
      if (conversionFlow) payload.conversionFlow = conversionFlow;
      const cycleNum = Number(payoutCycleDays);
      if (
        payoutCycleDays.trim() !== "" &&
        Number.isFinite(cycleNum) &&
        cycleNum > 0
      ) {
        payload.payoutCycleDays = Math.floor(cycleNum);
      }
      if (skuCommissionNote.trim()) {
        payload.skuCommissionNote = skuCommissionNote.trim();
      }
      const result = await createOfferAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        const newId = result.data?.offer?.id;
        if (typeof newId === "string" && newId) {
          setLastOfferId(newId);
          /* 保存并一键初筛：与商品库同一阶梯，结论写回 Offer 徽标；
             初筛失败不阻断跳转（列表里可再批量初筛）。 */
          if (prescreenAfterSave) {
            try {
              await prescreenOffersAction([newId]);
            } catch {
              /* 初筛失败不阻断 */
            }
          }
          /* 智能填入暂存的 EPC / 转化率 → 同步到该 offer 的投流页快照（只补空不覆盖）。 */
          if (
            extractedEpcCvr &&
            (extractedEpcCvr.epc != null || extractedEpcCvr.conversionRate != null)
          ) {
            try {
              const loaded = await loadWorkStateAction("traffic-planner", newId);
              const existing =
                loaded.ok && loaded.data.state
                  ? (loaded.data.state as Record<string, unknown>)
                  : {};
              const patch: Record<string, unknown> = {};
              if (extractedEpcCvr.epc != null && !existing.epc) {
                patch.epc = String(extractedEpcCvr.epc);
              }
              if (
                extractedEpcCvr.conversionRate != null &&
                !existing.networkCvr
              ) {
                patch.networkCvr = String(extractedEpcCvr.conversionRate);
              }
              if (Object.keys(patch).length > 0) {
                await saveWorkStateAction(
                  "traffic-planner",
                  { ...existing, ...patch },
                  { offerId: newId }
                );
              }
            } catch {
              /* 同步失败不阻断跳转 */
            }
          }
        }
      } catch {
        /* 记忆写入失败不阻断跳转 */
      }
      router.push(`/offers?tab=${source}`);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 space-y-5 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm"
    >
      <div>
        <label htmlFor="offer-picked" className={labelClassName}>
          挑选日期
        </label>
        <input
          id="offer-picked"
          type="date"
          className={inputClassName}
          value={pickedAt}
          onChange={(e) => setPickedAt(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="offer-name" className={labelClassName}>
          {f.name} *
        </label>
        <input
          id="offer-name"
          className={inputClassName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={f.namePlaceholder}
        />
        {initialAsin && source === "amazon" ? (
          <p className="mt-1 text-xs text-ink/50">来源 ASIN：{initialAsin}</p>
        ) : null}
      </div>
      {/* P1-2：品牌名 + 自动提取（低置信度提示确认，不覆盖人工填写）。 */}
      <div>
        <label htmlFor="offer-brand" className={labelClassName}>
          品牌名
        </label>
        <div className="flex gap-2">
          <input
            id="offer-brand"
            className={inputClassName}
            value={brandName}
            onChange={(e) => {
              setBrandName(e.target.value);
              setBrandManual(true);
              setBrandSource("manual");
              setBrandConfidence(1);
              setBrandExtractNote(null);
            }}
            placeholder="如 Anker（用于品牌词/流量门检测）"
          />
          <button
            type="button"
            className="shrink-0 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:bg-ink/5"
            onClick={() => {
              if (brandManual && brandName.trim()) {
                setBrandExtractNote("已手动填写品牌名，自动提取不会覆盖。");
                return;
              }
              const r = extractBrandName({ title: name, url: destinationUrl });
              if (!r) {
                setBrandExtractNote("无法从 Offer 名称/URL 提取品牌名，请手动填写。");
                return;
              }
              setBrandName(r.brandName);
              setBrandSource(r.source);
              setBrandConfidence(r.confidence);
              setBrandExtractNote(
                r.confidence < 0.6
                  ? "置信度较低，请确认品牌名是否正确。"
                  : null
              );
            }}
          >
            自动提取
          </button>
        </div>
        {brandSource ? (
          <p className="mt-1 text-xs text-ink/50">
            来源：
            {brandSource === "manual"
              ? "人工填写"
              : brandSource === "auto_extracted"
                ? "自动提取"
                : "域名回退"}
            {brandConfidence !== null
              ? ` · 置信度 ${Math.round(brandConfidence * 100)}%`
              : null}
          </p>
        ) : null}
        {brandConfidence !== null && brandConfidence < 0.6 ? (
          <p className="mt-1 text-xs text-amber-700">
            ⚠️ 置信度低于 60%，请确认品牌名是否正确。
          </p>
        ) : null}
        {brandExtractNote ? (
          <p className="mt-1 text-xs text-ink/55">{brandExtractNote}</p>
        ) : null}
      </div>
      {/* P1-15：节日主题（只影响 RSA 文案）。 */}
      <div>
        <label htmlFor="offer-festival" className={labelClassName}>
          节日主题
        </label>
        <select
          id="offer-festival"
          className={inputClassName}
          value={festivalTheme}
          onChange={(e) => setFestivalTheme(e.target.value)}
        >
          {FESTIVAL_THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink/50">
          选节日后，生成 RSA 时会用节日 urgency 话术；节日不改变盈利/条款判定。折扣必须来自你填写的真实优惠，不编造。
        </p>
      </div>
      <div>
        <label htmlFor="offer-network" className={labelClassName}>
          {f.network} *
        </label>
        <input
          id="offer-network"
          className={inputClassName}
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          placeholder={f.networkPlaceholder}
        />
      </div>
      <div>
        <label htmlFor="offer-source" className={labelClassName}>
          {f.source}
        </label>
        <select
          id="offer-source"
          className={inputClassName}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {OFFER_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t.entities.offers.tabs[s as keyof typeof t.entities.offers.tabs]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="offer-url" className={labelClassName}>
          {f.destinationUrl} *
        </label>
        <input
          id="offer-url"
          type="url"
          className={inputClassName}
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          onBlur={() => {
            const url = destinationUrl.trim();
            if (!url) {
              setCoachFindings([]);
              return;
            }
            void coachCheckAction({ url }).then((r) => {
              if (r.ok) setCoachFindings(r.data.findings);
            });
          }}
          placeholder={f.destinationUrlPlaceholder}
        />
        <div className="mt-3">
          <label htmlFor="offer-affiliate-url" className={labelClassName}>
            {f.affiliateUrl}
            <span className="ml-1 text-xs font-normal text-ink/50">（{f.affiliateUrlHint}）</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="offer-affiliate-url"
              type="url"
              className={inputClassName}
              value={affiliateUrl}
              onChange={(e) => setAffiliateUrl(e.target.value)}
              placeholder={f.affiliateUrlPlaceholder}
            />
            {affiliateUrl.trim() ? (
              <a
                href={affiliateUrl.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20"
              >
                ↗ 直达
              </a>
            ) : null}
          </div>
        </div>
        <CapturePicker
          onPick={(c) => {
            if (c.finalUrl) setDestinationUrl(c.finalUrl);
            if (c.title && !name.trim()) setName(c.title);
            void (async () => {
              setCaptureExtracting(true);
              setCaptureExtractMsg(null);
              setCaptureExtractEvidence(null);
              try {
                const r = await parseOfferCaptureAiAction(c.id);
                if (!r.ok) {
                  setCaptureExtractMsg(f.captureExtractFailed);
                  return;
                }
                applyExtractedOffer(r.data.offer, r.data.summaryText, c.price ?? null);
              } catch {
                setCaptureExtractMsg(f.captureExtractFailed);
              } finally {
                setCaptureExtracting(false);
              }
            })();
          }}
        />
        {/* 截图识别：上传联盟后台 offer 详情页截图，走同一套 AI 提取 */}
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1.5 text-xs font-medium text-signal transition hover:bg-signal/20">
          {screenshotExtracting ? f.screenshotExtracting : f.screenshotUpload}
          <input
            ref={screenshotFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={screenshotExtracting}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void (async () => {
                setScreenshotExtracting(true);
                setCaptureExtractMsg(null);
                setCaptureExtractEvidence(null);
                try {
                  const fd = new FormData();
                  fd.append("screenshot", file);
                  const r = await parseOfferScreenshotAction(fd);
                  if (!r.ok) {
                    setCaptureExtractMsg(r.error);
                    return;
                  }
                  applyExtractedOffer(r.data.offer, r.data.summaryText, null);
                } catch {
                  setCaptureExtractMsg(f.captureExtractFailed);
                } finally {
                  setScreenshotExtracting(false);
                  if (screenshotFileRef.current) screenshotFileRef.current.value = "";
                }
              })();
            }}
          />
        </label>
        {captureExtracting && (
          <p className="mt-1 text-xs text-ink/50">{f.captureExtracting}</p>
        )}
        {captureExtractMsg && (
          <div className="mt-1 text-xs text-ink/60">
            <p>{captureExtractMsg}</p>
            {captureExtractEvidence && (
              <p className="mt-0.5 text-ink/50">
                {[captureExtractEvidence.commission, captureExtractEvidence.payout, captureExtractEvidence.price]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
        {bidEstimate && (
          <div className="mt-2 rounded-lg border border-signal/30 bg-signal/[0.04] p-2.5 text-xs">
            <p className="font-medium text-ink">{f.bidEstimateTitle}</p>
            <p className="mt-0.5 text-ink/70">
              {f.bidEstimateBreakEven}：<span className="font-semibold text-ink">${bidEstimate.breakEven}</span>
              <span className="mx-2 text-ink/30">|</span>
              {f.bidEstimateRecommended}：<span className="font-semibold text-signal">${bidEstimate.recommended}</span>
            </p>
            <p className="mt-0.5 text-ink/50">{f.bidEstimateHint}</p>
          </div>
        )}
        <div className="mt-2">
          <CoachGate dict={t.coach} findings={coachFindings} />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor="offer-commission-value" className={labelClassName}>
            佣金 {commissionType === "percentage" ? "(%)" : "($)"}
          </label>
          <input
            id="offer-commission-value"
            type="number"
            step="0.01"
            min="0"
            className={inputClassName}
            value={commissionValue}
            onChange={(e) => setCommissionValue(e.target.value)}
            placeholder={commissionType === "percentage" ? "如 10（表示 10%）" : "如 5（表示 $5）"}
          />
        </div>
        <div>
          <label htmlFor="offer-commission-type" className={labelClassName}>
            佣金类型
          </label>
          <select
            id="offer-commission-type"
            className={inputClassName}
            value={commissionType}
            onChange={(e) => setCommissionType(e.target.value)}
          >
            <option value="percentage">按比例 (%)</option>
            <option value="fixed">固定金额 ($)</option>
          </select>
        </div>
        <div>
          <label htmlFor="offer-avg-price" className={labelClassName}>
            产品平均价 ($)
          </label>
          <input
            id="offer-avg-price"
            type="number"
            step="0.01"
            min="0"
            className={inputClassName}
            value={avgPrice}
            onChange={(e) => setAvgPrice(e.target.value)}
            placeholder="如 49.99"
          />
        </div>
      </div>
      {/* #9/#4：转化流 / 结算周期 / SKU 佣金备注（可空；转化流决定止损分级）。 */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-conversion-flow" className={labelClassName}>
            {f.conversionFlow}
          </label>
          <select
            id="offer-conversion-flow"
            className={inputClassName}
            value={conversionFlow}
            onChange={(e) => setConversionFlow(e.target.value)}
          >
            <option value="">{f.conversionFlowNone}</option>
            {CONVERSION_FLOWS.map((flow) => (
              <option key={flow} value={flow}>
                {f.flowOptions[flow]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="offer-payout-cycle" className={labelClassName}>
            {f.payoutCycleDays}
          </label>
          <input
            id="offer-payout-cycle"
            type="number"
            step="1"
            min="1"
            className={inputClassName}
            value={payoutCycleDays}
            onChange={(e) => setPayoutCycleDays(e.target.value)}
            placeholder={f.payoutCycleDaysPlaceholder}
          />
        </div>
      </div>
      <div>
        <label htmlFor="offer-sku-note" className={labelClassName}>
          {f.skuCommissionNote}
        </label>
        <input
          id="offer-sku-note"
          className={inputClassName}
          value={skuCommissionNote}
          onChange={(e) => setSkuCommissionNote(e.target.value)}
          maxLength={500}
          placeholder={f.skuCommissionNotePlaceholder}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-status" className={labelClassName}>
            {f.status}
          </label>
          <select
            id="offer-status"
            className={inputClassName}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {OFFER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="offer-priority" className={labelClassName}>
            {f.priority}
          </label>
          <input
            id="offer-priority"
            type="number"
            className={inputClassName}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
      </div>
      {/* 申请状态（独立维度）：向网络申请 program 的状态/日期/备注，与上面的 Offer 生命周期状态分开记。 */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-application-status" className={labelClassName}>
            {f.applicationStatus}
          </label>
          <select
            id="offer-application-status"
            className={inputClassName}
            value={applicationStatus}
            onChange={(e) => setApplicationStatus(e.target.value)}
          >
            {(["not_applied", "applied", "approved", "rejected"] as const).map(
              (s) => (
                <option key={s} value={s}>
                  {t.entities.offers.applicationStatus[s]}
                </option>
              )
            )}
          </select>
        </div>
        <div>
          <label htmlFor="offer-applied-at" className={labelClassName}>
            {f.appliedAt}
          </label>
          <input
            id="offer-applied-at"
            type="date"
            className={inputClassName}
            value={appliedAt}
            onChange={(e) => setAppliedAt(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label htmlFor="offer-application-note" className={labelClassName}>
          {f.applicationNote}
        </label>
        <input
          id="offer-application-note"
          className={inputClassName}
          value={applicationNote}
          onChange={(e) => setApplicationNote(e.target.value)}
          maxLength={500}
          placeholder={f.applicationNotePlaceholder}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-starts" className={labelClassName}>
            {f.startsAt}
          </label>
          <input
            id="offer-starts"
            type="datetime-local"
            className={inputClassName}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="offer-ends" className={labelClassName}>
            {f.endsAt}
          </label>
          <input
            id="offer-ends"
            type="datetime-local"
            className={inputClassName}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <label className="flex items-start gap-2 text-sm text-ink/80">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={prescreenAfterSave}
          onChange={(e) => setPrescreenAfterSave(e.target.checked)}
        />
        <span>
          {f.prescreenAfterSave}
          <span className="block text-xs text-ink/50">{f.prescreenAfterSaveHint}</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || !valid}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? f.creating : f.submit}
        </button>
        <button
          type="button"
          onClick={() => router.push("/offers")}
          className="rounded-lg border border-ink/15 bg-white/70 px-4 py-2 text-sm font-medium hover:bg-white"
        >
          {t.common.actions.cancel}
        </button>
      </div>
    </form>
  );
}
