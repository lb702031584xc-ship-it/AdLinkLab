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
import { OfferDeleteButton } from "@/components/offers/offer-delete-button";
import {
  OfferSelectionProvider,
  OfferRowCheckbox,
  OfferSelectAllCheckbox,
  OfferBatchDeleteBar,
} from "@/components/offers/offer-selection";
import { TestSpendCell } from "@/components/offers/test-spend-cell";
import {
  QuickCalcButton,
  type QuickCalcDict,
} from "@/components/offers/quick-calc-button";
import { listCashbackOffersAction } from "@/lib/api/cashback-actions";
import type { CashbackOffer } from "@/lib/api/cashback";
import { OfferPresetFilterBar } from "@/components/offers/offer-preset-filter";

export const dynamic = "force-dynamic";

const TABS = ["affiliate", "amazon", "cashback"] as const;
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

/** P1-30：派生佣金金额/比例（电商：均价×比例；固定：佣金值；缺数据 → null）。 */
function derivedCommission(o: Offer): { amount: number | null; rate: number | null } {
  const cv = o.commissionValue == null ? null : Number(o.commissionValue);
  const price = o.avgPrice == null ? null : Number(o.avgPrice);
  if (o.commissionType === "percentage") {
    return {
      amount: cv != null && price != null ? (price * cv) / 100 : null,
      rate: cv,
    };
  }
  if (o.commissionType === "fixed") {
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

  const columns: Array<Column<Offer>> = [
    {
      header: "",
      noLink: true,
      render: (o) => <OfferRowCheckbox offerId={o.id} />,
      className: "whitespace-nowrap",
    },
    { header: t.common.misc.name, render: (o) => o.name },
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
        <a
          href={o.destinationUrl}
          target="_blank"
          rel="noreferrer"
          title={o.destinationUrl}
          className="text-signal hover:underline"
        >
          {truncate(o.destinationUrl, 40)}
        </a>
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
      data = { items: filtered, page: 1, pageSize: Math.max(filtered.length, 1), total: filtered.length };
    } else {
      data = await entityApi.offers.list(page, pageSize, tab);
    }
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
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
              extraParams={{ tab }}
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
