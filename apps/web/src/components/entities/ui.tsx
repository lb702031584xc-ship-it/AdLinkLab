import Link from "next/link";
import type { ReactNode } from "react";
import type { Dict } from "@/i18n/dictionaries";

/* ---------- Pagination labels ---------- */

/** Translated strings rendered inside {@link Pagination}. */
export interface PaginationLabels {
  items: (total: number) => string;
  pageOf: (page: number, totalPages: number) => string;
  previous: string;
  next: string;
}

/** Build {@link PaginationLabels} from the current dictionary. */
export function paginationLabels(t: Dict): PaginationLabels {
  return {
    items: t.entities.ui.pagination.items,
    pageOf: t.entities.ui.pagination.pageOf,
    previous: t.common.pagination.previous,
    next: t.common.pagination.next,
  };
}

/* ---------- Status badge ---------- */

const STATUS_STYLES: Array<[RegExp, string]> = [
  [/^(ACTIVE|ENABLED|SYNCED|SUCCESS|SUCCEEDED|CONFIRMED|CONNECTED)$/, "bg-emerald-50 text-emerald-800 ring-emerald-200"],
  [/^(PAUSED|QUEUED|PENDING|DRAFT|VALIDATED|STALE|PARTIAL)$/, "bg-amber-50 text-amber-900 ring-amber-200"],
  [/^(FAILED|DISABLED|CANCELLED|ARCHIVED|REFUNDED|OUT_OF_SYNC|ROLLED_BACK)$/, "bg-rose-50 text-rose-800 ring-rose-200"],
  [/^(RUNNING)$/, "bg-sky-50 text-sky-800 ring-sky-200"],
  [/^(SUPERSEDED)$/, "bg-violet-50 text-violet-800 ring-violet-200"],
];

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-sm text-ink/50">—</span>;
  const style =
    STATUS_STYLES.find(([re]) => re.test(value))?.[1] ??
    "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${style}`}
      title={value}
    >
      {value}
    </span>
  );
}

/* ---------- Page header ---------- */

export function EntityPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-signal">
          AdLinkLab
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/70">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85"
    >
      {children}
    </Link>
  );
}

/* ---------- Table ---------- */

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** 自定义表头渲染（不提供则显示 header 文本） */
  headerRender?: ReactNode;
  /** 为 true 时，即使有 rowHref 也不把该列包进链接（复选框列用） */
  noLink?: boolean;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  rowHref,
  emptyText = "No data yet",
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowHref?: (row: T) => string;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-ink/20 bg-white/60 p-10 text-center text-sm text-ink/60">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-ink/10 bg-white/80 shadow-sm">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-ink/10 bg-ink/[0.03]">
            {columns.map((c, ci) => (
              <th
                key={`${c.header}-${ci}`}
                className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink/60 ${c.className ?? ""}`}
              >
                {c.headerRender ?? c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            const linkIdx = columns.findIndex((c) => !c.noLink);
            const cells = columns.map((c) => (
              <td key={c.header} className={`px-4 py-3 align-top ${c.className ?? ""}`}>
                {c.render(row)}
              </td>
            ));
            return href ? (
              <tr key={row.id} className="border-b border-ink/5 transition last:border-0 hover:bg-signal/[0.04]">
                {cells.map((cell, i) =>
                  i === linkIdx ? (
                    <td key={columns[i].header} className={`px-4 py-3 align-top ${columns[i].className ?? ""}`}>
                      <Link href={href} className="font-semibold text-signal hover:underline">
                        {columns[i].render(row)}
                      </Link>
                    </td>
                  ) : (
                    cell
                  )
                )}
              </tr>
            ) : (
              <tr key={row.id} className="border-b border-ink/5 transition last:border-0 hover:bg-ink/[0.02]">
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Pagination ---------- */

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  pageParam = "page",
  pageSizeParam = "pageSize",
  extraParams,
  labels,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  pageParam?: string;
  pageSizeParam?: string;
  extraParams?: Record<string, string>;
  labels?: PaginationLabels;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const itemsText = labels ? labels.items(total) : `${total} items`;
  const pageText = labels
    ? labels.pageOf(page, totalPages)
    : `Page ${page} of ${totalPages}`;
  const previousText = labels?.previous ?? "Previous";
  const nextText = labels?.next ?? "Next";
  if (totalPages <= 1) {
    return <p className="mt-4 text-sm text-ink/55">{itemsText}</p>;
  }
  const href = (p: number) => {
    const qs = new URLSearchParams();
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) qs.set(k, v);
    }
    qs.set(pageParam, String(p));
    qs.set(pageSizeParam, String(pageSize));
    return `${basePath}?${qs.toString()}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <p className="text-ink/55">
        {itemsText} · {pageText}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            className="rounded-lg border border-ink/15 bg-white/70 px-3 py-1.5 font-medium hover:bg-white"
          >
            {previousText}
          </Link>
        ) : (
          <span className="rounded-lg border border-ink/10 px-3 py-1.5 text-ink/35">{previousText}</span>
        )}
        {page < totalPages ? (
          <Link
            href={href(page + 1)}
            className="rounded-lg border border-ink/15 bg-white/70 px-3 py-1.5 font-medium hover:bg-white"
          >
            {nextText}
          </Link>
        ) : (
          <span className="rounded-lg border border-ink/10 px-3 py-1.5 text-ink/35">{nextText}</span>
        )}
      </div>
    </div>
  );
}

/* ---------- States ---------- */

export function ErrorState({
  message,
  title = "Failed to load",
}: {
  message: string;
  title?: string;
}) {
  return (
    <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50/70 p-6 text-sm text-rose-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

/* ---------- Detail list ---------- */

export function DetailList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="mt-6 overflow-hidden rounded-xl border border-ink/10 bg-white/80 shadow-sm">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`grid grid-cols-[180px_1fr] gap-4 px-5 py-3 text-sm ${i % 2 === 1 ? "bg-ink/[0.02]" : ""}`}
        >
          <dt className="font-medium text-ink/55">{item.label}</dt>
          <dd className={`text-ink ${item.mono ? "font-mono text-[13px] break-all" : "break-words"}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Section title ---------- */

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-10 font-display text-2xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  );
}
