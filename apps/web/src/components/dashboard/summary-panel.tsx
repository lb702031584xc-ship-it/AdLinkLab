import type { DashboardSummary } from "@/lib/api/dashboard-types";
import {
  ConnectionHealthBadge,
  ExecutionBadge,
} from "@/components/dashboard/status-badges";
import { TruncateId, formatTimestamp } from "@/components/dashboard/format";

export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const cards = [
    { label: "Targets", value: summary.targets.total },
    { label: "Synced", value: summary.targets.synced },
    { label: "Out of Sync", value: summary.targets.outOfSync },
    { label: "Never Applied", value: summary.targets.neverApplied },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-ink/10 bg-white/80 p-4 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {card.label}
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink">
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function IntegrationOverview({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
      <h2 className="font-display text-xl font-semibold text-ink">
        Integration status
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Name
          </dt>
          <dd className="mt-1 text-sm text-ink">{summary.integration.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Status
          </dt>
          <dd className="mt-1 text-sm font-semibold text-ink">
            {summary.integration.status}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Integration ID
          </dt>
          <dd className="mt-1">
            <TruncateId value={summary.integration.integrationId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Current Desired Version
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {summary.versions.currentDesiredVersion ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Connection Health
          </dt>
          <dd className="mt-1">
            <ConnectionHealthBadge value={summary.health.connection} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Last Execution
          </dt>
          <dd className="mt-1">
            <ExecutionBadge value={summary.health.lastExecution} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Applied Targets
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {summary.versions.appliedTargets}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Pending Targets
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {summary.versions.pendingTargets}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function IntegrationDetailCard({
  name,
  integrationId,
  status,
  googleAccountId,
  configGeneration,
  lastSeenAt,
  createdAt,
}: {
  name: string;
  integrationId: string;
  status: string;
  googleAccountId: string;
  configGeneration: number;
  lastSeenAt: string | null;
  createdAt: string;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
      <h2 className="font-display text-xl font-semibold text-ink">
        Integration details
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Name
          </dt>
          <dd className="mt-1 text-sm text-ink">{name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Integration ID
          </dt>
          <dd className="mt-1">
            <TruncateId value={integrationId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Status
          </dt>
          <dd className="mt-1 text-sm font-semibold text-ink">{status}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Google Account ID
          </dt>
          <dd className="mt-1">
            <TruncateId value={googleAccountId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Config Generation
          </dt>
          <dd className="mt-1 text-sm text-ink">{configGeneration}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Last Seen
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {formatTimestamp(lastSeenAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Created At
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {formatTimestamp(createdAt)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
