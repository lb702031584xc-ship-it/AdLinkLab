import type {
  ScriptConnectionHealth,
  ScriptExecutionResult,
  ScriptSyncState,
} from "@/lib/api/dashboard-types";

const syncStyles: Record<ScriptSyncState, string> = {
  SYNCED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  OUT_OF_SYNC: "bg-amber-50 text-amber-900 ring-amber-200",
  NEVER_APPLIED: "bg-slate-100 text-slate-700 ring-slate-200",
};

const connectionStyles: Record<ScriptConnectionHealth, string> = {
  CONNECTED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  STALE: "bg-amber-50 text-amber-900 ring-amber-200",
  DISABLED: "bg-rose-50 text-rose-800 ring-rose-200",
};

const executionStyles: Record<ScriptExecutionResult, string> = {
  SUCCESS: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILED: "bg-rose-50 text-rose-800 ring-rose-200",
  PARTIAL: "bg-amber-50 text-amber-900 ring-amber-200",
  NO_CHANGE: "bg-slate-100 text-slate-700 ring-slate-200",
};

function Badge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${className}`}
      title={label}
    >
      {label}
    </span>
  );
}

export function SyncStateBadge({
  value,
}: {
  value: ScriptSyncState | string | null | undefined;
}) {
  if (!value) return <span className="text-sm text-ink/50">—</span>;
  const style =
    syncStyles[value as ScriptSyncState] ??
    "bg-slate-100 text-slate-700 ring-slate-200";
  return <Badge label={value} className={style} />;
}

export function ConnectionHealthBadge({
  value,
}: {
  value: ScriptConnectionHealth | string | null | undefined;
}) {
  if (!value) return <span className="text-sm text-ink/50">—</span>;
  const style =
    connectionStyles[value as ScriptConnectionHealth] ??
    "bg-slate-100 text-slate-700 ring-slate-200";
  return <Badge label={value} className={style} />;
}

export function ExecutionBadge({
  value,
}: {
  value: ScriptExecutionResult | string | null | undefined;
}) {
  if (!value) return <span className="text-sm text-ink/50">—</span>;
  const style =
    executionStyles[value as ScriptExecutionResult] ??
    "bg-slate-100 text-slate-700 ring-slate-200";
  return <Badge label={value} className={style} />;
}
