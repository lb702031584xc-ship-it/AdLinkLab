"use client";

import { useEffect, useState } from "react";
import { zh as catalogZh } from "@/i18n/dict/catalog";
import {
  batchCreateOffersAction,
  listCatalogBrandsAction,
  saveBrandLandingUrlAction,
  type AdBandKey,
  type AdProbeDetailEntry,
  type AdTrend,
  type BrandPromoMode,
  type CatalogBrand,
  type CatalogBrandTopProduct,
  type TcAdvertiserEntry,
} from "@/lib/api/catalog-actions";
import { updateOfferAction } from "@/lib/api/entity-actions";
import { adCountTier } from "../../../../../packages/shared/src/ad-count-tier";

type Dict = typeof catalogZh;
type ProductsDict = Dict["products"];

const btnGhostSm =
  "rounded-md border border-ink/15 px-2 py-1 text-xs text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";
const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal";

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return "—";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function fmtUsd(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `$${v.toFixed(2)}`;
}

function fmtScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function rowKey(b: CatalogBrand): string {
  return `${b.networkId}|${b.brandKey}|${b.countryCode ?? ""}`;
}

/** 广告分档徽标（品牌行用后端 adBand；缺失时按 adCount 走共享分档兜底）。 */
export function adBandBadge(
  band: AdBandKey | null | undefined,
  adCount: number | null | undefined,
  d: ProductsDict
): { label: string; cls: string } | null {
  let key: AdBandKey | null = band ?? null;
  if (!key) {
    const tier = adCountTier(adCount);
    if (!tier) return null;
    key = tier.key === "red_ocean" ? "redocean" : tier.key;
  }
  switch (key) {
    case "none":
      return { label: d.adTierNone, cls: "bg-gray-100 text-gray-600" };
    case "small":
      return { label: d.adTierSmall, cls: "bg-emerald-50 text-emerald-700" };
    case "sweet":
      return { label: d.adTierSweet, cls: "bg-emerald-100 text-emerald-800" };
    case "hot":
      return { label: d.adTierHot, cls: "bg-amber-100 text-amber-800" };
    case "redocean":
      return { label: d.adTierRedOcean, cls: "bg-red-100 text-red-800" };
    default:
      return null;
  }
}

/**
 * 广告落地类型拆分小字：「首页 {h} · 商品 {p}」。
 * 两值都为 null → null（整行不显示）；只有一个有值 → 只显示那一项；
 * 0 是真实值（查到了、该类型 0 条），照常显示。
 */
export function adLandingSplitText(
  home: number | null | undefined,
  product: number | null | undefined,
  d: ProductsDict
): string | null {
  const parts: string[] = [];
  if (home != null) parts.push(d.adsHome.replace("{n}", String(home)));
  if (product != null) parts.push(d.adsProduct.replace("{n}", String(product)));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 多探针口径字段（adCountLongtail / adPolicyRisk）的防御式读取：
 * 字段缺失或形状不对 → longtail null（未探）、policyRisk false（无风险），
 * 不猜、不编造。商品 DTO 与品牌 DTO 共用同一口径。
 * 入参取 unknown：DTO 类型补齐前后都可直接传入，不依赖字段是否已声明。
 */
export function adProbeFields(x: unknown): {
  longtail: number | null;
  policyRisk: boolean;
} {
  const o = (
    typeof x === "object" && x !== null ? x : {}
  ) as { adCountLongtail?: unknown; adPolicyRisk?: unknown };
  return {
    longtail:
      typeof o.adCountLongtail === "number" && Number.isFinite(o.adCountLongtail)
        ? o.adCountLongtail
        : null,
    policyRisk: o.adPolicyRisk === true,
  };
}

/**
 * 探针明细的防御式读取：必须是数组且每条形状合格（q 字符串、kind 三值、
 * paid/shopping/total 有限数）才整体采用；任一条不合格 → null（不展示
 * 半真半假的明细）。null/缺失 = 尚未按明细口径计算过。
 */
export function adProbeDetailOf(x: unknown): AdProbeDetailEntry[] | null {
  const o = (
    typeof x === "object" && x !== null ? x : {}
  ) as { adProbeDetail?: unknown };
  if (!Array.isArray(o.adProbeDetail)) return null;
  const out: AdProbeDetailEntry[] = [];
  for (const e of o.adProbeDetail) {
    if (typeof e !== "object" || e === null) return null;
    const r = e as Record<string, unknown>;
    if (typeof r.q !== "string") return null;
    if (r.kind !== "bare" && r.kind !== "model" && r.kind !== "category")
      return null;
    if (
      typeof r.paid !== "number" ||
      !Number.isFinite(r.paid) ||
      typeof r.shopping !== "number" ||
      !Number.isFinite(r.shopping) ||
      typeof r.total !== "number" ||
      !Number.isFinite(r.total)
    )
      return null;
    out.push({
      q: r.q,
      kind: r.kind,
      paid: r.paid,
      shopping: r.shopping,
      total: r.total,
    });
  }
  return out;
}

/**
 * 透明中心旁证字段（tcAdvertisersCount / tcTopAdvertisers）的防御式读取：
 * count 必须是有限数（null = 从未查过，绝不拿空冒充 0）；top 逐条校验
 * （name 非空字符串才收，approxAds 只取有限数、其余 null），不合格条目
 * 丢弃而非整表作废（top 仅展示，半真半假比探针明细宽容）。商品 DTO 与
 * 品牌 DTO 共用同一口径。
 */
export function tcAdvertiserFields(x: unknown): {
  count: number | null;
  top: TcAdvertiserEntry[];
} {
  const o = (
    typeof x === "object" && x !== null ? x : {}
  ) as { tcAdvertisersCount?: unknown; tcTopAdvertisers?: unknown };
  const count =
    typeof o.tcAdvertisersCount === "number" &&
    Number.isFinite(o.tcAdvertisersCount)
      ? o.tcAdvertisersCount
      : null;
  const top: TcAdvertiserEntry[] = [];
  if (Array.isArray(o.tcTopAdvertisers)) {
    for (const e of o.tcTopAdvertisers) {
      if (top.length >= 3) break;
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      if (typeof r.name !== "string" || !r.name) continue;
      top.push({
        name: r.name,
        approxAds:
          typeof r.approxAds === "number" && Number.isFinite(r.approxAds)
            ? r.approxAds
            : null,
      });
    }
  }
  return { count, top };
}

/**
 * 「实际有人投·快照未捕获」标记出现条件：SERP 裸词与长尾都已知为 0，
 * 但透明中心有 ≥1 家广告主——快照没抓到不等于没人投（SERP 只能证有不能证无）。
 */
export function tcRescuedVisible(
  adCount: number | null | undefined,
  longtail: number | null | undefined,
  tcCount: number | null | undefined
): boolean {
  return adCount === 0 && longtail === 0 && tcCount != null && tcCount >= 1;
}

/** 探针类型短标签（裸词/型号/类目）。 */
export function probeKindLabel(
  kind: AdProbeDetailEntry["kind"],
  d: ProductsDict
): string {
  if (kind === "bare") return d.probeKindBare;
  if (kind === "model") return d.probeKindModel;
  return d.probeKindCategory;
}

/** 长尾探针广告数后缀：「· 长尾探针 约 {n} 条·快照」；未探（null）→ null（不显示）。 */
export function adLongtailSuffix(
  longtail: number | null | undefined,
  d: ProductsDict
): string | null {
  if (longtail == null) return null;
  return `· ${d.adsLongtailApprox.replace("{n}", String(longtail))}`;
}

/**
 * 「长尾在投」徽标出现条件：裸品牌词查无广告（0 或未计算 null），
 * 但长尾探针查到 ≥1 条——说明投放在长尾词上，裸词口径会误判无人投放。
 */
export function adLongtailActiveVisible(
  adCount: number | null | undefined,
  longtail: number | null | undefined
): boolean {
  return (adCount == null || adCount === 0) && longtail != null && longtail >= 1;
}

/**
 * 品牌行状态标的有效投放方式：显式标注优先（product/brand 以标注为准）；
 * 未标注时，已填品牌落地页链接视为品牌页；都没有才是未标注。
 * 注意：绝不从"链接为空"推断单品——单品必须显式标注。
 */
export function effectivePromoMode(
  b: Pick<CatalogBrand, "promoMode" | "landingUrl">
): "brand" | "product" | "unmarked" {
  if (b.promoMode === "product") return "product";
  if (b.promoMode === "brand") return "brand";
  if (b.landingUrl) return "brand";
  return "unmarked";
}

/**
 * 广告趋势标记（品牌行与商品行共用）：
 * new ↑ 新投（绿）/ stopped ↓ 疑似停投（红）/ active → 持续在投（灰）/
 * first 首次计算（灰色小字）/ none 与 null 不显示。
 * 有上次条数时 title 写明「上次 {n} 条 · {日期}」。
 */
export function AdTrendMark({
  trend,
  lastAdCount,
  lastAdCountAt,
  d,
}: {
  trend: AdTrend | null | undefined;
  lastAdCount: number | null | undefined;
  lastAdCountAt?: string | null | undefined;
  d: ProductsDict;
}) {
  if (!trend || trend === "none") return null;
  const title =
    lastAdCount != null
      ? lastAdCountAt
        ? d.trendPrevTip
            .replace("{n}", String(lastAdCount))
            .replace("{date}", formatDate(lastAdCountAt))
        : d.trendPrevCountOnly.replace("{n}", String(lastAdCount))
      : undefined;
  if (trend === "new") {
    return (
      <span
        className="ml-1 whitespace-nowrap text-[11px] font-medium text-emerald-700"
        title={title}
      >
        {d.trendNew}
      </span>
    );
  }
  if (trend === "stopped") {
    return (
      <span
        className="ml-1 whitespace-nowrap text-[11px] font-medium text-red-700"
        title={title}
      >
        {d.trendStopped}
      </span>
    );
  }
  if (trend === "active") {
    return (
      <span
        className="ml-1 whitespace-nowrap text-[11px] font-medium text-ink/50"
        title={title}
      >
        {d.trendActive}
      </span>
    );
  }
  // first
  return (
    <span className="ml-1 whitespace-nowrap text-[11px] text-ink/40">
      {d.trendFirst}
    </span>
  );
}

export function CatalogBrandView({
  d,
  networkId,
  country,
  q,
}: {
  d: Dict;
  networkId: string;
  country: string;
  q: string;
}) {
  const p = d.products;
  const [brands, setBrands] = useState<CatalogBrand[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [probeOpen, setProbeOpen] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [promoSavingKey, setPromoSavingKey] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listCatalogBrandsAction({
      networkId: networkId || undefined,
      country: country || undefined,
      q: q || undefined,
    }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        setBrands([]);
        setTotal(0);
        return;
      }
      // 后端已按 brandScore 降序，前端不重排。
      setBrands(res.data.brands);
      setTotal(res.data.total);
    });
    return () => {
      cancelled = true;
    };
  }, [networkId, country, q]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleProbe(key: string) {
    setProbeOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function onCopy(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(
        () => setCopiedKey((cur) => (cur === key ? null : cur)),
        1500
      );
    } catch {
      /* 剪贴板不可用时链接本身可见，用户可手动复制。 */
    }
  }

  async function onSaveLanding(b: CatalogBrand) {
    const key = rowKey(b);
    if (savingKey) return;
    setSavingKey(key);
    setMsg(null);
    const res = await saveBrandLandingUrlAction({
      networkId: b.networkId,
      brandKey: b.brandKey,
      countryCode: b.countryCode,
      landingUrl: draft.trim(),
    });
    setSavingKey(null);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    const raw = res.data.landingUrl;
    const saved =
      typeof raw === "string" && raw.trim() ? raw : draft.trim() || null;
    setBrands((prev) =>
      prev.map((x) =>
        rowKey(x) === key
          ? {
              ...x,
              landingUrl: saved,
              promoMode:
                res.data.promoMode === undefined
                  ? x.promoMode
                  : res.data.promoMode,
            }
          : x
      )
    );
    setEditingKey(null);
    setMsg(p.brandLandingSaved);
  }

  /** 投放方式三态切换：变更即存（只带 promoMode，不动链接）。 */
  async function onPromoModeChange(
    b: CatalogBrand,
    mode: BrandPromoMode | null
  ) {
    const key = rowKey(b);
    if (promoSavingKey || b.promoMode === mode) return;
    setPromoSavingKey(key);
    setMsg(null);
    const res = await saveBrandLandingUrlAction({
      networkId: b.networkId,
      brandKey: b.brandKey,
      countryCode: b.countryCode,
      promoMode: mode,
    });
    setPromoSavingKey(null);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    const savedMode =
      res.data.promoMode === undefined ? mode : res.data.promoMode;
    setBrands((prev) =>
      prev.map((x) => (rowKey(x) === key ? { ...x, promoMode: savedMode } : x))
    );
    setMsg(p.promoModeSaved);
  }

  async function onCreateOffer(b: CatalogBrand, prod: CatalogBrandTopProduct) {
    if (creatingId) return;
    setCreatingId(prod.id);
    setMsg(null);
    try {
      const res = await batchCreateOffersAction([prod.id]);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      const created = res.data.created[0];
      // 幂等回放：Offer 早已建过——不是失败，明示已存在；品牌落地页照样套用
      // （与此前「已存在计入 created」时的实际效果一致）。
      const existing = res.data.skippedExisting?.[0];
      const failedOne = res.data.failed[0];
      const skippedOne = res.data.skippedBlacklist?.[0];
      const target = created ?? existing;
      if (target) {
        let text = created
          ? p.batchResultCreated.replace("{n}", "1")
          : p.offerOneExists;
        // 只有品牌有落地页链接时才套用；无链接 = 单品投放正道，用商品自己的
        // promoUrl，不给任何提示。只有套用成功才注明，失败要如实说。
        if (b.landingUrl) {
          const upd = await updateOfferAction(target.offerId, {
            affiliateUrl: b.landingUrl,
          });
          text += upd.ok
            ? `；${p.brandLandingApplied}`
            : `；${p.brandLandingApplyFailed}`;
        }
        setMsg(text);
      } else if (skippedOne) {
        setMsg(`${p.offerOneSkipped ?? "未创建（黑名单）"}：${skippedOne.reason}`);
      } else {
        setMsg(
          `${p.offerOneFailed ?? "创建失败"}：${failedOne?.reason ?? p.unknownReason ?? "未知原因"}`
        );
      }
    } catch (err) {
      setMsg(
        p.actionFailed.replace(
          "{error}",
          err instanceof Error ? err.message : String(err)
        )
      );
    } finally {
      setCreatingId(null);
    }
  }

  if (loading) {
    return <p className="py-6 text-center text-sm text-ink/50">{p.brandLoading}</p>;
  }
  if (error) {
    return (
      <p className="py-6 text-center text-sm text-red-700">
        {p.brandLoadFailed}：{error}
      </p>
    );
  }
  if (brands.length === 0) {
    return <p className="py-6 text-center text-sm text-ink/50">{p.brandEmpty}</p>;
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-ink/60">
        {p.brandTotal.replace("{n}", String(total))}
      </p>
      {msg && (
        <p className="mt-2 rounded-lg bg-slate-50 px-4 py-2 text-sm text-ink/80">
          {msg}
        </p>
      )}
      <div className="mt-3 space-y-3">
        {brands.map((b) => {
          const key = rowKey(b);
          const band = adBandBadge(b.adBand, b.adCount, p);
          const probe = adProbeFields(b);
          const longtailSuffix = adLongtailSuffix(probe.longtail, p);
          const longtailActive = adLongtailActiveVisible(
            b.adCount,
            probe.longtail
          );
          const splitText =
            b.adCount != null
              ? adLandingSplitText(b.adCountHome, b.adCountProduct, p)
              : null;
          const mode = effectivePromoMode(b);
          const probeDetail = adProbeDetailOf(b);
          const tc = tcAdvertiserFields(b);
          const tcRescued = tcRescuedVisible(b.adCount, probe.longtail, tc.count);
          const probeIsOpen = probeOpen.has(key);
          const isOpen = expanded.has(key);
          const isEditing = editingKey === key;
          const priceBand =
            b.priceMin != null && b.priceMax != null
              ? `${fmtUsd(b.priceMin)} – ${fmtUsd(b.priceMax)}`
              : (fmtUsd(b.priceMin) ?? fmtUsd(b.priceMax) ?? "—");
          return (
            <article
              key={key}
              className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">
                      {b.brand}
                    </span>
                    {b.countryCode && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {b.countryCode}
                      </span>
                    )}
                    {mode === "brand" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        {p.brandModeBrandPage}
                      </span>
                    ) : mode === "product" ? (
                      <span
                        className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                        title={p.brandModeProductTip}
                      >
                        {p.brandModeProduct}
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {p.brandModeUnmarked}
                      </span>
                    )}
                  </p>
                  <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/70">
                    <span>
                      {p.brandProducts}{" "}
                      <span className="font-medium text-ink tabular-nums">
                        {b.productCount} {p.brandCountUnit}
                      </span>
                    </span>
                    <span>
                      {p.brandPriceRange}{" "}
                      <span className="font-medium text-ink tabular-nums">
                        {priceBand}
                      </span>
                    </span>
                    <span>
                      {p.brandMaxCommission}{" "}
                      <span className="font-medium text-ink tabular-nums">
                        {fmtUsd(b.maxCommissionUsd) ?? p.brandUnknown}
                      </span>
                    </span>
                    <span>
                      {p.brandMaxRate}{" "}
                      <span className="font-medium text-ink tabular-nums">
                        {b.maxRatePct != null ? `${b.maxRatePct}%` : "—"}
                      </span>
                    </span>
                    <span>
                      {p.brandGe80}{" "}
                      <span className="font-medium text-ink tabular-nums">
                        {b.ge80Count} {p.brandCountUnit}
                      </span>
                    </span>
                    <span className="inline-flex items-center">
                      {p.colAds}{" "}
                      {b.adCount == null ? (
                        <span className="ml-1 text-xs text-ink/40">
                          {p.adsNotCalculated}
                        </span>
                      ) : (
                        <>
                          <span className="ml-1 font-medium text-ink tabular-nums">
                            {p.adsApprox.replace("{n}", String(b.adCount))}
                          </span>
                          {band && (
                            <span
                              className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${band.cls}`}
                              title={p.adTierTip}
                            >
                              {band.label}
                            </span>
                          )}
                          <AdTrendMark
                            trend={b.adTrend}
                            lastAdCount={b.lastAdCount}
                            d={p}
                          />
                        </>
                      )}
                      {longtailSuffix && (
                        <span className="ml-1 tabular-nums text-ink/70">
                          {longtailSuffix}
                        </span>
                      )}
                      {longtailActive && (
                        <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          {p.adLongtailActive}
                        </span>
                      )}
                      {tc.count != null && (
                        <span
                          className="ml-1 tabular-nums text-ink/70"
                          title={
                            tc.top.length > 0
                              ? tc.top
                                  .map((t) =>
                                    t.approxAds != null
                                      ? `${t.name} (~${t.approxAds})`
                                      : t.name
                                  )
                                  .join(" · ")
                              : undefined
                          }
                        >
                          · {p.tcAdvertisers.replace("{n}", String(tc.count))}
                        </span>
                      )}
                      {tcRescued && (
                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          {p.tcRescuedBadge}
                        </span>
                      )}
                      {probe.policyRisk && (
                        <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                          {p.adPolicyRiskCategory}
                        </span>
                      )}
                    </span>
                  </p>
                  {b.adCountSelf != null && b.adCountOthers != null && (
                    <p className="mt-0.5 text-[11px] text-ink/50">
                      {p.adsSelfOthers
                        .replace("{s}", String(b.adCountSelf))
                        .replace("{o}", String(b.adCountOthers))}
                    </p>
                  )}
                  {splitText && (
                    <p className="mt-0.5 text-[11px] text-ink/50">{splitText}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink/50">{p.brandScore}</p>
                  <p className="text-2xl font-bold leading-none text-signal tabular-nums">
                    {fmtScore(b.brandScore)}
                  </p>
                </div>
              </div>

              {/* 落地页 / 投放方式行 */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/5 pt-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-ink/50">{p.promoModeLabel}</span>
                  <span className="inline-flex overflow-hidden rounded-md border border-ink/15">
                    {(
                      [
                        [null, p.brandModeUnmarked],
                        ["brand", p.promoModeBrand],
                        ["product", p.promoModeProduct],
                      ] as Array<[BrandPromoMode | null, string]>
                    ).map(([m, label]) => (
                      <button
                        key={label}
                        className={
                          b.promoMode === m
                            ? "bg-signal px-2 py-1 text-xs font-medium text-white"
                            : "px-2 py-1 text-xs text-ink/60 transition hover:bg-ink/5"
                        }
                        onClick={() => void onPromoModeChange(b, m)}
                        disabled={promoSavingKey === key}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </span>
                {isEditing ? (
                  <>
                    <input
                      className={inputCls}
                      style={{ maxWidth: 520 }}
                      placeholder={p.brandLandingPlaceholder}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button
                      className={btnGhostSm}
                      onClick={() => void onSaveLanding(b)}
                      disabled={savingKey === key}
                    >
                      {savingKey === key ? p.brandLandingSaving : p.brandLandingSave}
                    </button>
                    <button
                      className={btnGhostSm}
                      onClick={() => setEditingKey(null)}
                      disabled={savingKey === key}
                    >
                      {p.brandLandingCancel}
                    </button>
                  </>
                ) : b.landingUrl ? (
                  <>
                    <a
                      href={b.landingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-[420px] truncate text-sm text-signal hover:underline"
                      title={b.landingUrl}
                    >
                      {b.landingUrl}
                    </a>
                    <button
                      className={btnGhostSm}
                      onClick={() => void onCopy(key, b.landingUrl as string)}
                    >
                      {copiedKey === key ? p.brandCopied : p.brandCopy}
                    </button>
                    <button
                      className={btnGhostSm}
                      onClick={() => {
                        setDraft(b.landingUrl ?? "");
                        setEditingKey(key);
                      }}
                    >
                      {p.brandLandingEdit}
                    </button>
                  </>
                ) : mode === "product" ? (
                  /* 单品品牌：落地页入口弱化呈现，但保留（以后找到品牌链接可补填）。 */
                  <button
                    className="text-xs text-ink/40 underline-offset-2 transition hover:text-ink/60 hover:underline"
                    onClick={() => {
                      setDraft("");
                      setEditingKey(key);
                    }}
                  >
                    {p.brandLandingSet}
                  </button>
                ) : (
                  <button
                    className={btnGhostSm}
                    onClick={() => {
                      setDraft("");
                      setEditingKey(key);
                    }}
                  >
                    {p.brandLandingSet}
                  </button>
                )}
                <button
                  className={`${btnGhostSm} ml-auto`}
                  onClick={() => toggleProbe(key)}
                >
                  {probeIsOpen ? p.probeDetailHide : p.probeDetailShow}
                </button>
                <button
                  className={btnGhostSm}
                  onClick={() => toggleExpand(key)}
                >
                  {isOpen ? p.brandHideTop : p.brandShowTop}
                </button>
              </div>

              {probeIsOpen && (
                <div className="mt-2 border-t border-ink/5 pt-2">
                  <p className="text-xs font-medium text-ink/60">
                    {p.probeDetailTitle}
                  </p>
                  {probeDetail === null ? (
                    <p className="mt-1 text-xs text-ink/40">
                      {p.probeDetailEmpty}
                    </p>
                  ) : (
                    <ul className="mt-1 divide-y divide-ink/5">
                      {probeDetail.map((e, i) => (
                        <li
                          key={`${e.q}-${i}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-xs text-ink/70"
                        >
                          <span className="font-medium text-ink">{e.q}</span>
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {probeKindLabel(e.kind, p)}
                          </span>
                          <span className="tabular-nums">
                            {p.probePaid.replace("{n}", String(e.paid))}
                          </span>
                          <span className="tabular-nums">
                            {p.probeShopping.replace("{n}", String(e.shopping))}
                          </span>
                          <span className="font-medium tabular-nums text-ink">
                            {p.probeTotal.replace("{n}", String(e.total))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {tc.top.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-ink/60">
                        {p.tcTopTitle}
                      </p>
                      <ul className="mt-1 divide-y divide-ink/5">
                        {tc.top.map((t, i) => (
                          <li
                            key={`${t.name}-${i}`}
                            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-xs text-ink/70"
                          >
                            <span className="font-medium text-ink">
                              {t.name}
                            </span>
                            {t.approxAds != null && (
                              <span className="tabular-nums">
                                {p.tcApproxAds.replace(
                                  "{n}",
                                  String(t.approxAds)
                                )}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {isOpen && (
                <div className="mt-2 divide-y divide-ink/5 border-t border-ink/5">
                  {b.topProducts.map((prod) => {
                    const stageLabel = prod.poolStage
                      ? (p.poolStage as Record<string, string>)[prod.poolStage]
                      : undefined;
                    return (
                      <div
                        key={prod.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-ink" title={prod.name}>
                          {prod.name}
                        </span>
                        {stageLabel && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                            {stageLabel}
                          </span>
                        )}
                        <span className="tabular-nums text-ink/70">
                          {fmtUsd(prod.price) ?? "—"}
                        </span>
                        <span className="tabular-nums text-ink/70">
                          {p.brandMaxCommission}{" "}
                          {fmtUsd(prod.commissionUsd) ?? p.brandUnknown}
                        </span>
                        <span className="tabular-nums text-ink/70">
                          {prod.ratePct != null ? `${prod.ratePct}%` : "—"}
                        </span>
                        <span className="tabular-nums text-ink/70">
                          {prod.score != null ? `⭐ ${fmtScore(prod.score)}` : "—"}
                        </span>
                        {prod.promoUrl && (
                          <a
                            href={prod.promoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-signal hover:underline"
                            title={p.colPromo}
                          >
                            ↗
                          </a>
                        )}
                        <button
                          className={btnGhostSm}
                          onClick={() => void onCreateOffer(b, prod)}
                          disabled={creatingId != null}
                        >
                          {p.createOfferOne}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
