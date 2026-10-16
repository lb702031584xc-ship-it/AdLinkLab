import { entityApi, type GoogleAccount } from "@/lib/api/entities";
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
import { SyncAccountButton } from "@/components/entities/sync-account-button";
import { GoogleAccountCurrencySelect } from "@/components/entities/google-account-currency-select";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

function parsePageParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export default async function GoogleAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page, 1);
  const pageSize = parsePageParam(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);

  let result;
  try {
    result = await entityApi.googleAccounts.list(page, pageSize);
  } catch (e) {
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.googleAccounts}
          description={t.entities.googleAccounts.description}
        />
        <ErrorState
          message={mapEntityErrorMessage(e, lang)}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const columns: Array<Column<GoogleAccount>> = [
    {
      header: t.common.misc.name,
      render: (a) => <span className="font-medium text-ink">{a.name}</span>,
    },
    {
      header: t.entities.googleAccounts.columns.customerId,
      render: (a) => (
        <span className="font-mono text-[13px]">{a.customerId}</span>
      ),
    },
    {
      header: t.common.misc.status,
      render: (a) => <StatusBadge value={a.status} />,
    },
    {
      header: t.entities.googleAccounts.columns.currency,
      render: (a) => a.currency,
    },
    {
      header: t.entities.googleAccounts.columns.timezone,
      render: (a) => a.timezone,
    },
    {
      header: t.common.misc.updated,
      render: (a) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(a.updatedAt)}
        </span>
      ),
    },
    {
      header: t.common.misc.actions,
      render: (a) => (
        <span className="inline-flex items-start justify-end gap-2">
          <GoogleAccountCurrencySelect accountId={a.id} currency={a.currency} />
          <SyncAccountButton accountId={a.id} />
        </span>
      ),
      className: "text-right",
    },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <EntityPageHeader
          title={t.common.nav.googleAccounts}
          description={t.entities.googleAccounts.description}
        />
        <a
          href="/google-accounts/new"
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
        >
          新建
        </a>
      </div>
      <DataTable
        columns={columns}
        rows={result.items}
        emptyText={t.entities.googleAccounts.empty}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.total}
        basePath="/google-accounts"
        labels={paginationLabels(t)}
      />
    </div>
  );
}
