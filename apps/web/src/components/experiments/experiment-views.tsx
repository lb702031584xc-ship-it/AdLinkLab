/**
 * Experiment view components (Phase 3): pure components rendering straight
 * from API-shaped data. Receive the experiment dictionary as a prop so they
 * don't depend on the aggregated dictionaries.ts (coordinator-owned).
 */
import type {
  Experiment,
  ExperimentStatus,
  ExperimentVariant,
  ExperimentVariantType,
  ExperimentWinner,
} from "@/lib/api/experiments";
import type { ExperimentDict } from "@/i18n/dict/experiment";

const statusClass: Record<ExperimentStatus, string> = {
  DRAFT: "bg-ink/10 text-ink",
  RUNNING: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-sky-100 text-sky-800",
  CANCELLED: "bg-red-100 text-red-800",
};

const winnerClass: Record<ExperimentWinner, string> = {
  A: "bg-amber-100 text-amber-900",
  B: "bg-amber-100 text-amber-900",
  TIE: "bg-ink/10 text-ink",
};

export function StatusBadge({
  status,
  dict,
}: {
  status: ExperimentStatus;
  dict: ExperimentDict;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass[status]}`}
    >
      {dict.status[status]}
    </span>
  );
}

export function WinnerBadge({
  winner,
  dict,
}: {
  winner: ExperimentWinner | null;
  dict: ExperimentDict;
}) {
  if (!winner) {
    return (
      <span className="inline-block rounded-full bg-ink/5 px-2.5 py-0.5 text-xs text-ink/60">
        {dict.winnerLabel.none}
      </span>
    );
  }
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${winnerClass[winner]}`}
    >
      {dict.winnerLabel[winner]}
    </span>
  );
}

export function variantTypeLabel(
  type: ExperimentVariantType,
  dict: ExperimentDict
): string {
  return dict.variantType[type];
}

export function VariantCard({
  side,
  variant,
  trafficShare,
  dict,
}: {
  side: "A" | "B";
  variant: ExperimentVariant;
  trafficShare: number;
  dict: ExperimentDict;
}) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <p className="text-sm font-semibold text-ink">
        {side} · {variant.label}
      </p>
      <p className="mt-1 text-sm text-ink/70">
        {variantTypeLabel(variant.type, dict)} · {trafficShare}%
      </p>
      {variant.type === "AD_GROUP" ? (
        <div className="mt-2 space-y-1 text-xs text-ink/70">
          {(variant.headlines ?? []).map((h, i) => (
            <p key={`h-${i}`}>H{i + 1}: {h}</p>
          ))}
          {(variant.descriptions ?? []).map((d, i) => (
            <p key={`d-${i}`}>D{i + 1}: {d}</p>
          ))}
        </div>
      ) : (
        <p className="mt-1 break-all font-mono text-xs text-ink/50">
          {variant.trackingLinkId}
        </p>
      )}
    </div>
  );
}

const METRIC_ROWS = [
  "clicks",
  "ctr",
  "cpc",
  "lpViews",
  "affiliateClicks",
  "cvr",
  "cpa",
  "revenue",
  "profit",
  "approvalRate",
  "refundRate",
] as const;

function fmtMetric(v: number | undefined): string {
  return v === undefined || v === null ? "—" : String(v);
}

export function MetricsCompareTable({
  experiment,
  dict,
}: {
  experiment: Experiment;
  dict: ExperimentDict;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-ink/60">
          <th className="py-2 pr-4 font-medium"></th>
          <th className="py-2 pr-4 font-medium">A</th>
          <th className="py-2 font-medium">B</th>
        </tr>
      </thead>
      <tbody>
        {METRIC_ROWS.map((f) => (
          <tr key={f} className="border-b border-ink/5">
            <td className="py-2 pr-4 text-ink/70">{dict.detail.field[f]}</td>
            <td className="py-2 pr-4 font-mono text-ink">
              {fmtMetric(experiment.metricsA[f])}
            </td>
            <td className="py-2 font-mono text-ink">
              {fmtMetric(experiment.metricsB[f])}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WinnerPanel({
  experiment,
  dict,
}: {
  experiment: Experiment;
  dict: ExperimentDict;
}) {
  if (experiment.status !== "COMPLETED" || !experiment.winner) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink/70">{dict.detail.winner}</span>
        <WinnerBadge winner={experiment.winner} dict={dict} />
        {experiment.confidence !== null && experiment.confidence !== undefined && (
          <span className="text-sm text-ink/70">
            {dict.detail.confidence}：
            {Math.round(experiment.confidence * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function PreconditionList({
  experiment,
  dict,
}: {
  experiment: Experiment;
  dict: ExperimentDict;
}) {
  const check = experiment.preconditionCheck;
  if (!check) return null;
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <p className="text-sm font-semibold text-ink">{dict.detail.precondition}</p>
      <ul className="mt-2 space-y-1">
        {check.checks.map((c, i) => (
          <li key={i} className="text-sm text-ink/75">
            <span className={c.passed ? "text-emerald-700" : "text-red-700"}>
              {c.passed ? "✓" : "✗"}
            </span>{" "}
            {c.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExperimentListView({
  items,
  dict,
}: {
  items: Experiment[];
  dict: ExperimentDict;
}) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-ink/60">{dict.list.empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/15 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 bg-ink/5 text-left">
            <th className="px-4 py-2.5 font-medium text-ink/70">{dict.list.name}</th>
            <th className="px-4 py-2.5 font-medium text-ink/70">{dict.list.status}</th>
            <th className="px-4 py-2.5 font-medium text-ink/70">{dict.list.winner}</th>
            <th className="px-4 py-2.5 font-medium text-ink/70">{dict.list.createdAt}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className="border-b border-ink/5 last:border-0 hover:bg-ink/5">
              <td className="px-4 py-2.5">
                <a href={`/experiments/${e.id}`} className="font-medium text-ink hover:underline">
                  {e.name}
                </a>
                <p className="font-mono text-xs text-ink/50">{e.offerId}</p>
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={e.status} dict={dict} />
              </td>
              <td className="px-4 py-2.5">
                <WinnerBadge winner={e.winner} dict={dict} />
              </td>
              <td className="px-4 py-2.5 text-ink/70">
                {new Date(e.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
