export function TruncateId({
  value,
  title,
}: {
  value: string | null | undefined;
  title?: string;
}) {
  if (!value) return <span className="text-ink/45">—</span>;
  const short =
    value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
  return (
    <span className="font-mono text-xs text-ink/80" title={title ?? value}>
      {short}
    </span>
  );
}

export function TruncateUrl({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-ink/45">—</span>;
  return (
    <span className="block max-w-xs truncate text-sm text-ink/80" title={value}>
      {value}
    </span>
  );
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
