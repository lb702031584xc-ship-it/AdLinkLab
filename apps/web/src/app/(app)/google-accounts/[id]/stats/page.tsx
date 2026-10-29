import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { getGoogleAdsCampaignStatsAction } from "@/lib/api/google-ads-stats-actions";

export const dynamic = "force-dynamic";

function defaultRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function formatCost(costMicros: number, currency: string): string {
  return `${currency} ${(costMicros / 1_000_000).toFixed(2)}`;
}

export default async function GoogleAccountStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const defaults = defaultRange();
  const startDate = sp.startDate ?? defaults.startDate;
  const endDate = sp.endDate ?? defaults.endDate;
  const lang = await getLang();
  const t = getDictionary(lang);
  const st = t.entities.googleAccounts.stats;

  let error: string | null = null;
  let result: Awaited<
    ReturnType<typeof getGoogleAdsCampaignStatsAction>
  > | null = null;
  try {
    result = await getGoogleAdsCampaignStatsAction(id, startDate, endDate);
  } catch (e) {
    error = e instanceof Error ? e.message : t.common.error.unknown;
  }

  if (error || !result) {
    return (
      <div>
        <EntityPageHeader title={st.title} description={st.description} />
        <ErrorState message={error ?? t.common.error.unknown} title={t.common.error.title} />
      </div>
    );
  }

  const rows = result.stats.map((r) => ({ ...r, id: r.campaignId }));
  const totals = result.stats.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      costMicros: acc.costMicros + r.costMicros,
      conversions: acc.conversions + r.conversions,
    }),
    { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
  );

  const columns: Array<Column<(typeof rows)[number]>> = [
    {
      header: st.columns.campaign,
      render: (r) => (
        <span>
          <span className="font-medium text-ink">{r.campaignName}</span>{" "}
          <span className="font-mono text-[13px] text-ink/60">
            {r.campaignId}
          </span>
        </span>
      ),
    },
    {
      header: st.columns.impressions,
      render: (r) => <span className="tabular-nums">{r.impressions}</span>,
    },
    {
      header: st.columns.clicks,
      render: (r) => <span className="tabular-nums">{r.clicks}</span>,
    },
    {
      header: st.columns.cost,
      render: (r) => (
        <span className="tabular-nums">
          {formatCost(r.costMicros, result.currency)}
        </span>
      ),
    },
    {
      header: st.columns.conversions,
      render: (r) => <span className="tabular-nums">{r.conversions}</span>,
    },
  ];

  return (
    <div>
      <EntityPageHeader title={st.title} description={st.description} />
      <p className="mt-2 text-sm text-ink/70">
        <span className="font-mono text-[13px]">{result.customerId}</span>
        {" · "}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            result.provider === "api"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {result.provider === "api" ? st.liveBadge : st.mockBadge}
        </span>
      </p>
      {result.provider === "mock" ? (
        <p className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-xs text-ink/70">
          {st.mockNote}
        </p>
      ) : null}
      <form method="get" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="text-ink/70">{st.startDate}</label>
        <input
          type="date"
          name="startDate"
          defaultValue={startDate}
          required
          className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
        />
        <label className="text-ink/70">{st.endDate}</label>
        <input
          type="date"
          name="endDate"
          defaultValue={endDate}
          required
          className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
        />
        <button
          type="submit"
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
        >
          {st.filter}
        </button>
      </form>
      <p className="mt-3 text-sm text-ink/70">
        {st.total}：{st.columns.impressions} {totals.impressions} ·{" "}
        {st.columns.clicks} {totals.clicks} · {st.columns.cost}{" "}
        {formatCost(totals.costMicros, result.currency)} · {st.columns.conversions}{" "}
        {totals.conversions}
      </p>
      <DataTable columns={columns} rows={rows} emptyText={st.empty} />
    </div>
  );
}
