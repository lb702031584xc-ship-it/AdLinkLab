"use client";

import type { DashboardSyncLog } from "@/lib/api/dashboard-types";
import { ExecutionBadge } from "@/components/dashboard/status-badges";
import { TruncateId, formatTimestamp } from "@/components/dashboard/format";
import { EmptyState } from "@/components/dashboard/states";

export function LogsTable({
  logs,
  emptyMessage = "No sync logs yet.",
}: {
  logs: DashboardSyncLog[];
  emptyMessage?: string;
}) {
  if (logs.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/80 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Sync logs</caption>
        <thead className="border-b border-ink/10 bg-mist/60 text-xs uppercase tracking-wide text-ink/55">
          <tr>
            <th className="px-3 py-3 font-semibold">Log ID</th>
            <th className="px-3 py-3 font-semibold">Target</th>
            <th className="px-3 py-3 font-semibold">Desired</th>
            <th className="px-3 py-3 font-semibold">Reported</th>
            <th className="px-3 py-3 font-semibold">Status</th>
            <th className="px-3 py-3 font-semibold">Conflict</th>
            <th className="px-3 py-3 font-semibold">Execution</th>
            <th className="px-3 py-3 font-semibold">Before → After</th>
            <th className="px-3 py-3 font-semibold">Message</th>
            <th className="px-3 py-3 font-semibold">Created</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.logId} className="border-b border-ink/5 align-top">
              <td className="px-3 py-3">
                <TruncateId value={log.logId} />
              </td>
              <td className="px-3 py-3">
                <TruncateId value={log.targetId} />
              </td>
              <td className="px-3 py-3">{log.desiredVersion}</td>
              <td className="px-3 py-3">{log.reportedVersion ?? "—"}</td>
              <td className="px-3 py-3">
                <ExecutionBadge value={log.status} />
              </td>
              <td className="px-3 py-3 text-xs text-ink/70">
                {log.conflictCode ?? "—"}
              </td>
              <td className="px-3 py-3">
                <TruncateId value={log.executionId} />
              </td>
              <td className="px-3 py-3 text-xs text-ink/70">
                {log.appliedVersionBefore ?? "—"} →{" "}
                {log.appliedVersionAfter ?? "—"}
              </td>
              <td className="max-w-[12rem] px-3 py-3">
                <span className="line-clamp-2 text-xs text-ink/70" title={log.message ?? undefined}>
                  {log.message ?? "—"}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-xs text-ink/65">
                {formatTimestamp(log.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LogsPagination({
  page,
  hasNext,
  total,
  pageSize,
  onPrevious,
  onNext,
  disabled,
}: {
  page: number;
  hasNext: boolean;
  total: number;
  pageSize: number;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink/70">
      <p>
        Page {page} · {pageSize} per page · {total} total
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled || page <= 1}
          className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink enabled:hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-signal"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={disabled || !hasNext}
          className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink enabled:hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-signal"
        >
          Next
        </button>
      </div>
    </div>
  );
}
