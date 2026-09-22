"use client";

import { useState, type ReactNode } from "react";
import type { DashboardTarget } from "@/lib/api/dashboard-types";
import {
  ConnectionHealthBadge,
  ExecutionBadge,
  SyncStateBadge,
} from "@/components/dashboard/status-badges";
import {
  TruncateId,
  TruncateUrl,
  formatTimestamp,
} from "@/components/dashboard/format";
import { EmptyState } from "@/components/dashboard/states";

export function TargetsTable({ targets }: { targets: DashboardTarget[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (targets.length === 0) {
    return <EmptyState message="No targets configured yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/80 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Target sync status</caption>
        <thead className="border-b border-ink/10 bg-mist/60 text-xs uppercase tracking-wide text-ink/55">
          <tr>
            <th className="px-3 py-3 font-semibold">Ad ID</th>
            <th className="px-3 py-3 font-semibold">Campaign</th>
            <th className="px-3 py-3 font-semibold">Ad Group</th>
            <th className="px-3 py-3 font-semibold">Desired</th>
            <th className="px-3 py-3 font-semibold">Applied</th>
            <th className="px-3 py-3 font-semibold">State</th>
            <th className="px-3 py-3 font-semibold">Health</th>
            <th className="px-3 py-3 font-semibold">Last Exec</th>
            <th className="px-3 py-3 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => {
            const open = openId === target.targetId;
            return (
              <TargetRows
                key={target.targetId}
                target={target}
                open={open}
                onToggle={() =>
                  setOpenId(open ? null : target.targetId)
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TargetRows({
  target,
  open,
  onToggle,
}: {
  target: DashboardTarget;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-ink/5 align-top">
        <td className="px-3 py-3">
          <TruncateId value={target.googleAdId} />
        </td>
        <td className="px-3 py-3">
          <TruncateId value={target.campaignId} />
        </td>
        <td className="px-3 py-3">
          <TruncateId value={target.adGroupId} />
        </td>
        <td className="px-3 py-3">{target.desiredVersion ?? "—"}</td>
        <td className="px-3 py-3">{target.appliedVersion ?? "—"}</td>
        <td className="px-3 py-3">
          <SyncStateBadge value={target.syncState} />
        </td>
        <td className="px-3 py-3">
          <ConnectionHealthBadge value={target.connectionHealth} />
        </td>
        <td className="px-3 py-3">
          <ExecutionBadge value={target.lastExecution} />
        </td>
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-ink/15 px-2 py-1 text-xs font-semibold text-ink hover:bg-mist focus:outline-none focus:ring-2 focus:ring-signal"
            aria-expanded={open}
          >
            {open ? "Hide" : "View"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-ink/10 bg-mist/40">
          <td colSpan={9} className="px-4 py-4">
            <TargetDetails target={target} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function TargetDetails({ target }: { target: DashboardTarget }) {
  const noActive =
    target.desiredVersion === null && target.desired.finalUrl === null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Detail label="Target ID" value={<TruncateId value={target.targetId} />} />
        <Detail label="Entity Type" value={target.entityType} />
        <Detail
          label="Google Ad ID"
          value={<TruncateId value={target.googleAdId} />}
        />
        <Detail
          label="Campaign ID"
          value={<TruncateId value={target.campaignId} />}
        />
        <Detail
          label="Ad Group ID"
          value={<TruncateId value={target.adGroupId} />}
        />
        <Detail label="Desired Version" value={target.desiredVersion ?? "—"} />
        <Detail label="Applied Version" value={target.appliedVersion ?? "—"} />
        <Detail
          label="Last Applied"
          value={formatTimestamp(target.lastAppliedAt)}
        />
        <Detail
          label="Last Attempt"
          value={formatTimestamp(target.lastAttemptAt)}
        />
      </dl>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Desired URL
        </p>
        {noActive ? (
          <p className="mt-2 text-sm text-ink/60">No active URL version.</p>
        ) : (
          <dl className="mt-2 space-y-2">
            <Detail
              label="Final URL"
              value={<TruncateUrl value={target.desired.finalUrl} />}
            />
            <Detail
              label="Final Mobile URL"
              value={<TruncateUrl value={target.desired.finalMobileUrl} />}
            />
            <Detail
              label="Final App URL"
              value={<TruncateUrl value={target.desired.finalAppUrl} />}
            />
            <Detail
              label="Tracking Template"
              value={<TruncateUrl value={target.desired.trackingTemplate} />}
            />
            <Detail
              label="Custom Parameters"
              value={
                <pre className="overflow-x-auto rounded bg-white/80 p-2 text-xs text-ink/75">
                  {JSON.stringify(target.desired.customParameters ?? {}, null, 2)}
                </pre>
              }
            />
          </dl>
        )}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}
