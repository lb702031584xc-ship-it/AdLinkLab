export function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div
      className="animate-pulse rounded-xl border border-ink/10 bg-white/60 p-5"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="h-4 w-32 rounded bg-ink/10" />
      <div className="mt-4 h-8 w-20 rounded bg-ink/10" />
      <div className="mt-3 h-3 w-full rounded bg-ink/5" />
      <div className="mt-2 h-3 w-2/3 rounded bg-ink/5" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink/15 bg-white/50 px-4 py-8 text-center text-sm text-ink/60">
      {message}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
      role="alert"
    >
      {message}
    </div>
  );
}
