"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOfferAction } from "@/lib/api/entity-actions";
import { setLastOfferId } from "@/lib/current-offer";
import { useI18n } from "@/i18n/I18nProvider";
import { coachCheckAction, type CoachFinding } from "@/lib/api/coach-actions";
import { CoachGate, hasCoachBlock } from "@/components/coach/coach-gate";
import { CapturePicker } from "@/components/ai/capture-picker";
import { extractBrandName } from "@/lib/brand-extract";

const inputClassName =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClassName = "mb-1 block text-sm font-medium text-ink/70";

const OFFER_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

const OFFER_SOURCES = ["affiliate", "amazon", "cashback"] as const;

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

export function OfferForm({ initialSource }: { initialSource?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [network, setNetwork] = useState("");
  const [source, setSource] = useState<string>(
    OFFER_SOURCES.includes(initialSource as (typeof OFFER_SOURCES)[number])
      ? (initialSource as string)
      : "affiliate"
  );
  const [destinationUrl, setDestinationUrl] = useState("");
  const [status, setStatus] = useState<string>("ACTIVE");
  const [priority, setPriority] = useState("100");
  const [commissionValue, setCommissionValue] = useState("");
  const [commissionType, setCommissionType] = useState("percentage");
  const [avgPrice, setAvgPrice] = useState("");
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
  const [error, setError] = useState<string | null>(null);
  const [coachFindings, setCoachFindings] = useState<CoachFinding[]>([]);
  const { t } = useI18n();
  const f = t.entities.forms.offer;

  const valid =
    name.trim() !== "" &&
    network.trim() !== "" &&
    destinationUrl.trim() !== "";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || pending || hasCoachBlock(coachFindings)) return;
    setError(null);
    const priorityNum = Number(priority);
    start(async () => {
      const cv = Number(commissionValue);
      const ap = Number(avgPrice);
      const result = await createOfferAction({
        name: name.trim(),
        network: network.trim(),
        source,
        destinationUrl: destinationUrl.trim(),
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
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        const newId = result.data?.offer?.id;
        if (typeof newId === "string" && newId) setLastOfferId(newId);
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
        <CapturePicker
          onPick={(c) => {
            if (c.finalUrl) setDestinationUrl(c.finalUrl);
            if (c.title && !name.trim()) setName(c.title);
            if (c.price != null && !avgPrice.trim()) setAvgPrice(String(c.price));
          }}
        />
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
