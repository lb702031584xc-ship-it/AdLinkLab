import Link from "next/link";
import { entityApi, type Offer } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  Pagination,
  PrimaryLink,
  StatusBadge,
  paginationLabels,
  type Column,
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { OfferScoreCell } from "@/components/offers/offer-score-cell";
import { OfferTestPriorityCell } from "@/components/offers/offer-test-priority-cell";
import OfferLinks from "@/components/entities/offer-links";
import { OfferDeleteButton } from "@/components/offers/offer-delete-button";
import {
  OfferSelectionProvider,
  OfferRowCheckbox,
  OfferSelectAllCheckbox,
  OfferBatchDeleteBar,
  OfferPrescreenBar,
} from "@/components/offers/offer-selection";
import { TestSpendCell } from "@/components/offers/test-spend-cell";
import { OfferApplicationCell } from "@/components/offers/offer-application-cell";
import {
  QuickCalcButton,
  type QuickCalcDict,
} from "@/components/offers/quick-calc-button";
import { listCashbackOffersAction } from "@/lib/api/cashback-actions";
import type { CashbackOffer } from "@/lib/api/cashback";
import { OfferPresetFilterBar } from "@/components/offers/offer-preset-filter";
import { SeasonalRecommendationsClient } from "@/components/offers/seasonal-recommendations-client";

export const dynamic = "force-dynamic";

const TABS = ["affiliate", "amazon", "cashback", "seasonal"] as const;
type OfferTab = (typeof TABS)[number];

function parseTab(value: string | string[] | undefined): OfferTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (TABS as readonly string[]).includes(raw ?? "")
    ? (raw as OfferTab)
    : "affiliate";
}

function parsePositiveInt(
  value: string | string[] | undefined,
  fallback: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 排序切换链接：保留 tab 与预设筛选参数，切排序即回到第 1 页。 */
function buildOffersHref(
  sp: { [key: string]: string | string[] | undefined },
  tab: OfferTab,
  sort: string | undefined
): string {
  const qs = new URLSearchParams();
  qs.set("tab", tab);
  for (const key of [
    "preset",
    "minReviews",
    "minCommission",
    "minRate",
    "minPrice",
    "maxPrice",
    "minScore",
  ]) {
    const v = sp[key];
    if (typeof v === "string" && v !== "") qs.set(key, v);
  }
  if (sort) qs.set("sort", sort);
  return `/offers?${qs.toString()}`;
}

/** P1-30：解析可选数值筛选参数（空/非法 → null = 不筛选）。 */
function parseFilterNum(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface OfferPresetFilter {
  minReviews: number | null;
  minCommission: number | null;
  minRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minScore: number | null;
}

/**
 * P1-30：派生佣金金额/比例。口径以写入方为准（与 API offer-priority 同源）：
 * catalog-sync 写入的 "PERCENT"，其 commissionValue 已是换算好的美元金额
 * （如 899×13% 存 116.87），不能再当费率乘均价；费率由 金额÷均价 反推。
 * offer-form 的 "percentage"/"%" 才是真费率；"fixed" 值即金额。
 * 缺数据 → null。
 */
function derivedCommission(o: Offer): { amount: number | null; rate: number | null } {
  const cv = o.commissionValue == null ? null : Number(o.commissionValue);
  const price = o.avgPrice == null ? null : Number(o.avgPrice);
  const t = (o.commissionType ?? "").trim().toLowerCase();
  if (t === "percentage" || t === "%") {
    return {
      amount: cv != null && price != null ? (price * cv) / 100 : null,
      rate: cv,
    };
  }
  if (t === "percent") {
    return {
      amount: cv,
      rate: cv != null && price != null && price > 0 ? (cv / price) * 100 : null,
    };
  }
  if (t === "fixed") {
    return { amount: cv, rate: null };
  }
  return { amount: null, rate: null };
}

/**
 * P1-30：预设筛选（缺数据的 Offer 不通过已设置的该项条件——无法验证即不计入）。
 * 默认阈值来自默认预设（讲师经验），不在此处硬编码。
 */
function passesPresetFilter(o: Offer, f: OfferPresetFilter): boolean {
  const { amount, rate } = derivedCommission(o);
  if (f.minCommission != null && (amount == null || amount < f.minCommission)) return false;
  if (f.minRate != null && (rate == null || rate < f.minRate)) return false;
  const price = o.avgPrice == null ? null : Number(o.avgPrice);
  if (f.minPrice != null && (price == null || price < f.minPrice)) return false;
  if (f.maxPrice != null && (price == null || price > f.maxPrice)) return false;
  const reviews = o.metricsSummary?.reviewCount ?? null;
  if (f.minReviews != null && (reviews == null || reviews < f.minReviews)) return false;
  const score = o.metricsSummary?.score ?? null;
  if (f.minScore != null && (score == null || score < f.minScore)) return false;
  return true;
}

function sourceBadgeClass(source: string): string {
  switch (source) {
    case "amazon":
      return "bg-amber-100 text-amber-800";
    case "cashback":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function SourceBadge({ source, label }: { source: string; label: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${sourceBadgeClass(source)}`}
    >
      {label}
    </span>
  );
}

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const page = parsePositiveInt(sp.page, 1);
  const pageSize = parsePositiveInt(sp.pageSize, 20);
  /** 测试优先排序（把握最大在前）：仅 priority 有意义，其余值按默认。 */
  const sortParam = sp.sort === "priority" ? "priority" : undefined;
  // P1-30：筛选预设参数（preset=1 时用默认预设；显式参数优先）。
  const presetDefaults =
    sp.preset === "1"
      ? { minCommission: 10, minRate: 10, minPrice: 80, maxPrice: 150 }
      : {};
  const presetFilter: OfferPresetFilter = {
    minReviews: parseFilterNum(sp.minReviews),
    minCommission: parseFilterNum(sp.minCommission) ?? presetDefaults.minCommission ?? null,
    minRate: parseFilterNum(sp.minRate) ?? presetDefaults.minRate ?? null,
    minPrice: parseFilterNum(sp.minPrice) ?? presetDefaults.minPrice ?? null,
    maxPrice: parseFilterNum(sp.maxPrice) ?? presetDefaults.maxPrice ?? null,
    minScore: parseFilterNum(sp.minScore),
  };
  const filterActive = Object.values(presetFilter).some((v) => v != null);
  const lang = await getLang();
  const t = getDictionary(lang);
  const tabsDict = t.entities.offers.tabs;
  const tabLabel: Record<OfferTab, string> = {
    affiliate: tabsDict.affiliate,
    amazon: tabsDict.amazon,
    cashback: tabsDict.cashback,
    seasonal: tabsDict.seasonal,
  };
  const qc = t.entities.offers.quickCalc;
  const quickCalcDict: QuickCalcDict = {
    button: qc.button,
    title: qc.title,
    payout: qc.payout,
    payoutPlaceholder: qc.payoutPlaceholder,
    cpc: qc.cpc,
    cpcPlaceholder: qc.cpcPlaceholder,
    cvr: qc.cvr,
    cvrPlaceholder: qc.cvrPlaceholder,
    calculate: qc.calculate,
    epc: qc.epc,
    breakEvenCvr: qc.breakEvenCvr,
    recommendedBid: qc.recommendedBid,
    perClickProfit: qc.perClickProfit,
    verdictProfitable: qc.verdictProfitable,
    verdictLoss: qc.verdictLoss,
    verdictNeedCvr: qc.verdictNeedCvr,
    close: qc.close,
  };

  const tabClass = (active: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition ${
      active ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
    }`;

  const tabsUi = (
    <div className="mt-4 inline-flex rounded-xl bg-ink/5 p-1">
      {TABS.map((key) => (
        <Link
          key={key}
          href={`/offers?tab=${key}`}
          className={tabClass(tab === key)}
        >
          {tabLabel[key]}
        </Link>
      ))}
    </div>
  );

  // 返利 Tab：独立 cashback_offers 表，UI 与 Offer 列表统一。
  if (tab === "cashback") {
    const res = await listCashbackOffersAction();
    const columns: Array<Column<CashbackOffer>> = [
      {
        header: t.common.misc.name,
        render: (o) => (
          <span title={o.originalUrl}>{truncate(o.originalUrl, 48)}</span>
        ),
      },
      {
        header: t.entities.offers.columns.source,
        render: () => (
          <SourceBadge source="cashback" label={tabLabel.cashback} />
        ),
        className: "whitespace-nowrap",
      },
      {
        header: t.entities.offers.columns.network,
        render: (o) => o.cashbackNetwork,
      },
      {
        header: t.common.misc.status,
        render: (o) => <StatusBadge value={o.status} />,
      },
      {
        header: t.entities.offers.quickCalc.button,
        render: () => <QuickCalcButton dict={quickCalcDict} />,
        className: "whitespace-nowrap",
      },
      {
        header: t.entities.offers.columns.pickedAt,
        render: (o) => formatDateTime(o.createdAt).slice(0, 10),
        className: "whitespace-nowrap",
      },
      {
        header: t.common.misc.updated,
        render: (o) => formatDateTime(o.createdAt),
        className: "whitespace-nowrap",
      },
    ];
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.offers}
          description={t.entities.offers.description}
          actions={
            <PrimaryLink href="/offers/new?source=cashback">
              {t.entities.offers.newOffer}
            </PrimaryLink>
          }
        />
        {tabsUi}
        {!res.ok ? (
          <ErrorState
            message={res.error}
            title={t.common.error.title}
          />
        ) : (
          <div className="mt-4">
            <DataTable<CashbackOffer>
              columns={columns}
              rows={res.data.items}
              emptyText={t.entities.offers.empty}
            />
          </div>
        )}
      </div>
    );
  }

  // 季节推荐 Tab：不走 Offer 表格；加载联盟 + 亚马逊 Offer（各前 100）供逐行查季节信号。
  if (tab === "seasonal") {
    let seasonalOffers: Offer[] = [];
    let seasonalError: string | null = null;
    try {
      const [affiliateRes, amazonRes] = await Promise.all([
        entityApi.offers.list(1, 100, "affiliate"),
        entityApi.offers.list(1, 100, "amazon"),
      ]);
      const seen = new Set<string>();
      for (const o of [...affiliateRes.items, ...amazonRes.items]) {
        if (!seen.has(o.id)) {
          seen.add(o.id);
          seasonalOffers.push(o);
        }
      }
    } catch (e) {
      seasonalError = mapEntityErrorMessage(e, lang);
    }
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.offers}
          description={t.entities.offers.description}
          actions={
            <PrimaryLink href="/offers/new">
              {t.entities.offers.newOffer}
            </PrimaryLink>
          }
        />
        {tabsUi}
        {seasonalError ? (
          <ErrorState message={seasonalError} title={t.common.error.title} />
        ) : (
          <div className="mt-4">
            <SeasonalRecommendationsClient
              offers={seasonalOffers.map((o) => ({
                id: o.id,
                name: o.name,
                network: o.network,
              }))}
              dict={t.entities.offers.seasonal}
              lang={lang}
            />
          </div>
        )}
      </div>
    );
  }

  // 测试优先排序时每条 Offer 的全局名次（数据取回后填充，供「先测」徽标）。
  const priorityRankById = new Map<string, number>();

  const columns: Array<Column<Offer>> = [
    {
      header: "",
      noLink: true,
      render: (o) => <OfferRowCheckbox offerId={o.id} />,
      className: "whitespace-nowrap",
    },
    {
      header: t.common.misc.name,
      render: (o) => (
        <span>
          {o.name}
          {o.prescreenVerdict === "go" && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              {t.entities.forms.offer.prescreenVerdictGo}
            </span>
          )}
          {o.prescreenVerdict === "unknown" && (
            <span
              className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
              title={o.prescreenReason ?? undefined}
            >
              {t.entities.forms.offer.prescreenVerdictUnknown}
            </span>
          )}
          {o.prescreenVerdict === "stop" && (
            <span
              className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
              title={o.prescreenReason ?? undefined}
            >
              {t.entities.forms.offer.prescreenVerdictStop}
            </span>
          )}
        </span>
      ),
    },
    {
      header: t.entities.offers.columns.mid,
      render: (o) => (
        <span className="text-xs text-ink/60" title={o.merchantId ?? ""}>
          {o.merchantId ? String(o.merchantId).slice(0, 8) + "…" : "—"}
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.columns.commission,
      render: (o) => {
        if (o.commissionValue == null) return "—";
        const v = String(o.commissionValue);
        return o.commissionType === "percentage" ? `${v}%` : `$${v}`;
      },
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.columns.source,
      render: (o) => (
        <SourceBadge
          source={o.source ?? "affiliate"}
          label={tabLabel[(o.source as OfferTab) ?? "affiliate"] ?? o.source}
        />
      ),
      className: "whitespace-nowrap",
    },
    { header: t.entities.offers.columns.network, render: (o) => o.network },
    {
      header: t.common.misc.status,
      render: (o) => <StatusBadge value={o.status} />,
    },
    {
      header: t.entities.offers.columns.applicationStatus,
      render: (o) => (
        <OfferApplicationCell
          offerId={o.id}
          status={o.applicationStatus}
          appliedAt={o.appliedAt}
          note={o.applicationNote}
          labels={t.entities.offers.applicationStatus}
          notePlaceholder={t.entities.forms.offer.applicationNotePlaceholder}
        />
      ),
    },
    { header: t.entities.offers.columns.priority, render: (o) => String(o.priority) },
    {
      header: t.entities.offers.scoreColumn,
      render: (o) => (
        <OfferScoreCell
          offerId={o.id}
          initial={o.metricsSummary}
          dict={{
            scoreColumn: t.entities.offers.scoreColumn,
            fetchMetrics: t.entities.offers.fetchMetrics,
            fetching: t.entities.offers.fetching,
            noData: t.entities.offers.scoreNoData,
            breakdownTitle: t.entities.offers.breakdownTitle,
            rating: t.entities.offers.rating,
            reviewCount: t.entities.offers.reviewCount,
            soldCount: t.entities.offers.soldCount,
            notFetched: t.entities.offers.notFetched,
            formulaHint: t.entities.offers.formulaHint,
            gradeStrong: t.entities.offers.gradeStrong,
            gradeGood: t.entities.offers.gradeGood,
            gradeCaution: t.entities.offers.gradeCaution,
            gradeAvoid: t.entities.offers.gradeAvoid,
            fetchedAt: t.entities.offers.fetchedAt,
            failuresLabel: t.entities.offers.failuresLabel,
          }}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.testPriorityColumn,
      render: (o) => (
        <OfferTestPriorityCell
          priority={o.testPriority}
          rank={priorityRankById.get(o.id) ?? null}
          dict={{ testFirst: t.entities.offers.testFirstBadge }}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.testStopLoss.listColumn,
      render: (o) => (
        <TestSpendCell
          offerId={o.id}
          dict={{
            column: t.entities.offers.testStopLoss.listColumn,
            spent: t.entities.offers.testStopLoss.spent,
            noData: t.entities.offers.scoreNoData,
          }}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.columns.destinationUrl,
      render: (o) => (
        <OfferLinks
          affiliateUrl={o.affiliateUrl}
          destinationUrl={o.destinationUrl}
          affiliateLabel={t.entities.offers.affiliateUrlLabel}
          destinationLabel={t.entities.offers.destinationUrlLabel}
          openLabel={t.entities.offers.openLink}
          className="flex-col items-start gap-y-1"
        />
      ),
    },
    {
      header: t.entities.offers.quickCalc.button,
      render: (o) => (
        <QuickCalcButton
          dict={quickCalcDict}
          offer={{
            commissionValue: o.commissionValue,
            commissionType: o.commissionType,
            avgPrice: o.avgPrice,
          }}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.columns.pickedAt,
      render: (o) => (o.pickedAt ? formatDateTime(o.pickedAt).slice(0, 10) : "—"),
      className: "whitespace-nowrap",
    },
    {
      header: t.common.misc.updated,
      render: (o) => formatDateTime(o.updatedAt),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.columns.actions,
      render: (o) => (
        <div className="flex items-center gap-2">
          <Link
            href={`/ai/analyze?offerId=${encodeURIComponent(o.id)}`}
            className="text-xs text-signal hover:underline"
          >
            {t.entities.offers.columns.analyze}
          </Link>
          <Link
            href={`/ai/traffic-planner?offerId=${encodeURIComponent(o.id)}`}
            className="text-xs text-signal hover:underline"
          >
            {t.entities.offers.columns.trafficPlan}
          </Link>
          <OfferDeleteButton
            offerId={o.id}
            offerName={o.name}
            dict={{
              delete: t.entities.offers.columns.delete,
              deleteConfirm: t.entities.offers.columns.deleteConfirm,
              deleting: t.entities.offers.columns.deleting,
            }}
          />
        </div>
      ),
      className: "whitespace-nowrap",
    },
  ];

  let data: Awaited<ReturnType<typeof entityApi.offers.list>> | null = null;
  let error: string | null = null;
  try {
    if (filterActive) {
      // P1-30：筛选应用于全部 Offer（分页拉取，至多 2000 条），非仅当前页。
      const all: Offer[] = [];
      let p = 1;
      let total = Infinity;
      while (all.length < total && p <= 20) {
        const chunk = await entityApi.offers.list(p, 100, tab);
        all.push(...chunk.items);
        total = chunk.total;
        if (chunk.items.length === 0) break;
        p += 1;
      }
      const filtered = all.filter((o) => passesPresetFilter(o, presetFilter));
      if (sortParam === "priority") {
        // 筛选模式在前端拿到全集：按后端附带的测试优先分现排（同分 createdAt 降序）。
        filtered.sort(
          (a, b) =>
            (b.testPriority?.score ?? -1) - (a.testPriority?.score ?? -1) ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }
      data = { items: filtered, page: 1, pageSize: Math.max(filtered.length, 1), total: filtered.length };
    } else {
      data = await entityApi.offers.list(page, pageSize, tab, sortParam);
    }
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  if (sortParam === "priority" && data) {
    data.items.forEach((o, idx) => {
      priorityRankById.set(o.id, (data.page - 1) * data.pageSize + idx + 1);
    });
  }

  const tableColumns: Array<Column<Offer>> = data
    ? [
        {
          ...columns[0],
          headerRender: (
            <OfferSelectAllCheckbox ids={data.items.map((o) => o.id)} />
          ),
        },
        ...columns.slice(1),
      ]
    : columns;

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.offers}
        description={t.entities.offers.description}
        actions={
          <PrimaryLink
            href={tab === "affiliate" ? "/offers/new" : `/offers/new?source=${tab}`}
          >
            {t.entities.offers.newOffer}
          </PrimaryLink>
        }
      />
      {tabsUi}
      {/* P1-30：商品筛选预设栏（返利 Tab 已在上方提前 return，此处只剩联盟/亚马逊 Tab）。 */}
      <OfferPresetFilterBar
          dict={t.entities.offers.presetFilter}
          tab={tab}
          values={{
            minReviews: sp.minReviews != null && !Array.isArray(sp.minReviews) ? sp.minReviews : "",
            minCommission:
              sp.minCommission != null && !Array.isArray(sp.minCommission)
                ? sp.minCommission
                : sp.preset === "1"
                  ? "10"
                  : "",
            minRate:
              sp.minRate != null && !Array.isArray(sp.minRate)
                ? sp.minRate
                : sp.preset === "1"
                  ? "10"
                  : "",
            minPrice:
              sp.minPrice != null && !Array.isArray(sp.minPrice)
                ? sp.minPrice
                : sp.preset === "1"
                  ? "80"
                  : "",
            maxPrice:
              sp.maxPrice != null && !Array.isArray(sp.maxPrice)
                ? sp.maxPrice
                : sp.preset === "1"
                  ? "150"
                  : "",
            minScore: sp.minScore != null && !Array.isArray(sp.minScore) ? sp.minScore : "",
          }}
        />
      {/* 排序切换：默认（最新在前）/ 测试优先（把握最大在前，前 5 标「先测」）。 */}
      <div className="mt-3 inline-flex rounded-xl bg-ink/5 p-1">
        <Link
          href={buildOffersHref(sp, tab, undefined)}
          className={tabClass(sortParam === undefined)}
        >
          {t.entities.offers.sortDefault}
        </Link>
        <Link
          href={buildOffersHref(sp, tab, "priority")}
          className={tabClass(sortParam === "priority")}
        >
          {t.entities.offers.sortPriority}
        </Link>
      </div>
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.offers.loadError}
          title={t.common.error.title}
        />
      ) : (
        <div className="mt-4">
          <OfferSelectionProvider>
            <OfferBatchDeleteBar
              dict={{
                selectedCount: t.entities.offers.columns.selectedCount,
                deleteSelected: t.entities.offers.columns.deleteSelected,
                deleteSelectedConfirm:
                  t.entities.offers.columns.deleteSelectedConfirm,
                deleting: t.entities.offers.columns.deleting,
              }}
            />
            <OfferPrescreenBar
              dict={{
                prescreenBatch: t.entities.forms.offer.prescreenBatch,
                prescreenBatching: t.entities.forms.offer.prescreenBatching,
                prescreenBatchDone: t.entities.forms.offer.prescreenBatchDone,
              }}
            />
            <DataTable<Offer>
              columns={tableColumns}
              rows={data.items}
              rowHref={(o) => `/offers/${o.id}`}
              emptyText={t.entities.offers.empty}
            />
          </OfferSelectionProvider>
          {filterActive ? null : (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              basePath="/offers"
              extraParams={{ tab, ...(sortParam ? { sort: sortParam } : {}) }}
              labels={paginationLabels(t)}
            />
          )}
          {filterActive ? (
            <p className="mt-2 text-xs text-ink/60">
              {t.entities.offers.presetFilter.filteredCount.replace("{n}", String(data.total))}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
