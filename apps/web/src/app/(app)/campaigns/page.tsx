import { entityApi, type Campaign } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
} from "@/lib/api/entities-config";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  Pagination,
  StatusBadge,
  paginationLabels,
  type Column,
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  zh as campaignToggleZh,
  en as campaignToggleEn,
} from "@/i18n/dict/campaign-toggle";
import {
  CampaignToggleButton,
  type CampaignToggleStrings,
} from "./_components/campaign-toggle-button";

export const dynamic = "force-dynamic";

/**
 * Build serializable toggle strings for one campaign row.
 * `confirmBody` is a *function* in the i18n dict; RSC cannot serialize
 * functions into Client Component props, so it is resolved here on the
 * server (this was the "Application error: a server-side exception" on
 * /campaigns).
 */
function toggleStringsFor(
  c: Campaign,
  tt: typeof campaignToggleZh
): CampaignToggleStrings {
  const action = c.status === "PAUSED" ? "ENABLE" : "PAUSE";
  const { confirmBody, ...rest } = tt.toggle;
  return {
    ...rest,
    confirmBody: confirmBody(
      c.name,
      tt.toggle[action === "ENABLE" ? "enable" : "pause"]
    ),
  };
}

function parsePageParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page, 1);
  const pageSize = parsePageParam(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);
  const tt = lang === "en" ? campaignToggleEn : campaignToggleZh;

  let result;
  try {
    result = await entityApi.campaigns.list(page, pageSize);
  } catch (e) {
    // redirect() throws NEXT_REDIRECT — never swallow it, or the login
    // redirect breaks and the user sees a raw "NEXT_REDIRECT" error state.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.campaigns}
          description={t.entities.campaigns.description}
        />
        <ErrorState
          message={mapEntityErrorMessage(e, lang)}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const columns: Array<Column<Campaign>> = [
    {
      header: t.common.misc.name,
      render: (c) => <span className="font-medium text-ink">{c.name}</span>,
    },
    {
      header: t.entities.campaigns.columns.googleCampaignId,
      render: (c) => (
        <span className="font-mono text-[13px]">{c.googleCampaignId}</span>
      ),
    },
    {
      header: t.common.misc.status,
      render: (c) => <StatusBadge value={c.status} />,
    },
    {
      header: t.entities.campaigns.columns.biddingStrategy,
      render: (c) => c.biddingStrategy ?? "—",
    },
    {
      header: t.common.misc.updated,
      render: (c) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(c.updatedAt)}
        </span>
      ),
    },
    {
      header: tt.toggle.actionsColumn,
      render: (c) => (
        <CampaignToggleButton
          campaignId={c.id}
          googleAccountId={c.googleAccountId}
          currentStatus={c.status}
          t={toggleStringsFor(c, tt)}
        />
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.campaigns}
        description={t.entities.campaigns.description}
      />
      <DataTable
        columns={columns}
        rows={result.items}
        emptyText={t.entities.campaigns.empty}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.total}
        basePath="/campaigns"
        labels={paginationLabels(t)}
      />
      {/* 下一步：广告跑起来后做归因和监控 */}
      <div className="mt-4 rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
        <p className="text-sm font-semibold text-ink">🚀 {t.entities.campaigns.nextTitle}</p>
        <p className="mt-1 text-xs text-ink/55">{t.entities.campaigns.nextHint}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href="/tracking-links"
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            🔗 {t.entities.campaigns.toTracking} →
          </a>
          <a
            href="/monitoring"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            📊 {t.entities.campaigns.toMonitoring} →
          </a>
        </div>
      </div>
    </div>
  );
}
