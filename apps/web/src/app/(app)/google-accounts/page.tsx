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

import { GoogleAccountRowActions } from "@/components/entities/google-account-row-actions";

export const dynamic = "force-dynamic";

function parsePageParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export default async function GoogleAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; accountType?: string; healthStatus?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page, 1);
  const pageSize = parsePageParam(sp.pageSize, 20);
  const accountTypeFilter = sp.accountType && sp.accountType !== "all" ? sp.accountType : undefined;
  const healthFilter = sp.healthStatus && sp.healthStatus !== "all" ? sp.healthStatus : undefined;
  const lang = await getLang();
  const t = getDictionary(lang);
  const ga = t.entities.googleAccounts;

  let result;
  try {
    result = await entityApi.googleAccounts.list(page, pageSize, {
      accountType: accountTypeFilter,
      healthStatus: healthFilter,
    });
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

  const healthLabel = (a: GoogleAccount) =>
    a.healthStatus === "suspended"
      ? ga.healthSuspended
      : a.healthStatus === "limited"
        ? ga.healthLimited
        : ga.healthActive;

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
      header: ga.columns.accountType,
      render: (a) => (
        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink">
          {(a.accountType ?? "MCC") === "MCC" ? ga.typeMcc : ga.typePersonal}
        </span>
      ),
    },
    {
      header: ga.columns.health,
      render: (a) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            a.healthStatus === "suspended"
              ? "bg-red-100 text-red-800"
              : a.healthStatus === "limited"
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-100 text-emerald-800"
          }`}
          title={a.suspensionReason ?? undefined}
        >
          {healthLabel(a)}
          {a.suspensionReason ? ` · ${a.suspensionReason}` : ""}
        </span>
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
        <span className="inline-flex flex-col items-start justify-end gap-2">
          <span className="inline-flex items-start gap-2">
            <GoogleAccountCurrencySelect accountId={a.id} currency={a.currency} />
            <SyncAccountButton accountId={a.id} />
          </span>
          <GoogleAccountRowActions
            account={a}
            labels={{
              subAccounts: ga.subAccounts,
              personalOnlyNote: ga.personalOnlyNote,
              subAccountsEmpty: ga.subAccountsEmpty,
              recordSuspension: ga.recordSuspension,
              suspensionReasonPlaceholder: ga.suspensionReasonPlaceholder,
              appeals: ga.appeals,
              appealRecord: ga.appealRecord,
              appealNotePlaceholder: ga.appealNotePlaceholder,
              suspensionReason: ga.suspensionReason,
              levels: ga.appealLevels,
              statuses: ga.appealStatuses,
            }}
          />
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
      <p className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-xs text-ink/70">
        {ga.explainer}
      </p>
      {/* P1-7 / P1-8：类型 + 健康筛选（GET 表单，服务端过滤）。 */}
      <form method="get" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="text-ink/70">{ga.filterType}</label>
        <select
          name="accountType"
          defaultValue={accountTypeFilter ?? "all"}
          className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
        >
          <option value="all">{ga.filterAll}</option>
          <option value="MCC">{ga.typeMcc}</option>
          <option value="PERSONAL">{ga.typePersonal}</option>
        </select>
        <label className="text-ink/70">{ga.filterHealth}</label>
        <select
          name="healthStatus"
          defaultValue={healthFilter ?? "all"}
          className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
        >
          <option value="all">{ga.filterAll}</option>
          <option value="active">{ga.healthActive}</option>
          <option value="suspended">{ga.healthSuspended}</option>
          <option value="limited">{ga.healthLimited}</option>
        </select>
        <button
          type="submit"
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
        >
          {t.common.actions.filter}
        </button>
      </form>
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
