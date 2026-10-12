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
import { TestSpendCell } from "@/components/offers/test-spend-cell";
import {
  QuickCalcButton,
  type QuickCalcDict,
} from "@/components/offers/quick-calc-button";
import { listCashbackOffersAction } from "@/lib/api/cashback-actions";
import type { CashbackOffer } from "@/lib/api/cashback";

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
      render: () => <QuickCalcButton dict={quickCalcDict} />,
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
        <OfferDeleteButton
          offerId={o.id}
          offerName={o.name}
          dict={{
            delete: t.entities.offers.columns.delete,
            deleteConfirm: t.entities.offers.columns.deleteConfirm,
            deleting: t.entities.offers.columns.deleting,
          }}
        />
      ),
      className: "whitespace-nowrap",
    },
  ];

  let data: Awaited<ReturnType<typeof entityApi.offers.list>> | null = null;
  let error: string | null = null;
  try {
    data = await entityApi.offers.list(page, pageSize, tab);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

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
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.offers.loadError}
          title={t.common.error.title}
        />
      ) : (
        <div className="mt-4">
          <DataTable<Offer>
            columns={columns}
            rows={data.items}
            rowHref={(o) => `/offers/${o.id}`}
            emptyText={t.entities.offers.empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/offers"
            extraParams={{ tab }}
            labels={paginationLabels(t)}
          />
        </div>
      )}
    </div>
  );
}
