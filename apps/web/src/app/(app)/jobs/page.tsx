import type { ReactNode } from "react";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  Pagination,
  paginationLabels,
  StatusBadge,
} from "@/components/entities/ui";
import { entityApi, type SyncJob } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

import { DeadLetterClient } from "@/components/jobs/dead-letter-client";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function parsePositiveInt(
  value: string | string[] | undefined,
  fallback: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const lang = await getLang();
  const t = getDictionary(lang);
  const params = await searchParams;
  const page = parsePositiveInt(params.page, 1);
  const pageSize = parsePositiveInt(params.pageSize, 20);

  let jobs: SyncJob[] = [];
  let total = 0;
  let error: string | null = null;

  try {
    const res = await entityApi.jobs.list(page, pageSize);
    jobs = res.items;
    total = res.total;
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  const columns = [
    {
      header: t.common.misc.id,
      render: (row: SyncJob) => <Mono>{truncate(row.id, 18)}</Mono>,
    },
    {
      header: t.ops.jobs.columns.type,
      render: (row: SyncJob) => row.type,
    },
    {
      header: t.common.misc.status,
      render: (row: SyncJob) => <StatusBadge value={row.status} />,
    },
    {
      header: t.ops.jobs.columns.provider,
      render: (row: SyncJob) => row.provider,
    },
    {
      header: t.ops.jobs.columns.attempts,
      render: (row: SyncJob) => row.attempts,
    },
    {
      header: t.ops.jobs.columns.started,
      render: (row: SyncJob) => formatDateTime(row.startedAt),
    },
    {
      header: t.ops.jobs.columns.completed,
      render: (row: SyncJob) => formatDateTime(row.completedAt),
    },
    {
      header: t.ops.jobs.columns.error,
      render: (row: SyncJob) => (
        <span className="break-all" title={row.error ?? undefined}>
          {truncate(row.error, 60)}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <EntityPageHeader
        title={t.common.nav.jobs}
        description={t.ops.jobs.description}
      />

      {/* P1-21：DLQ 页签。 */}
      <div className="mt-3 flex gap-2 text-sm">
        <a
          href="/jobs"
          className={`rounded-lg border px-3 py-1.5 ${params.tab !== "dlq" ? "bg-ink text-white" : "bg-white text-ink"}`}
        >
          任务
        </a>
        <a
          href="/jobs?tab=dlq"
          className={`rounded-lg border px-3 py-1.5 ${params.tab === "dlq" ? "bg-ink text-white" : "bg-white text-ink"}`}
        >
          死信队列（DLQ）
        </a>
      </div>

      {params.tab === "dlq" ? (
        <div className="mt-4">
          <DeadLetterClient />
        </div>
      ) : (
        <>
          {error ? <ErrorState message={error} title={t.common.error.title} /> : null}

          <DataTable columns={columns} rows={jobs} emptyText={t.ops.jobs.empty} />
          <Pagination
            labels={paginationLabels(t)}
            page={page}
            pageSize={pageSize}
            total={total}
            basePath="/jobs"
          />
        </>
      )}
    </div>
  );
}
