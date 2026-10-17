"use client";

import { useCallback, useEffect, useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import type { LaunchArchiveDict } from "@/i18n/dict/launch-archive";
import {
  listLaunchArchivesAction,
  getLaunchArchiveAction,
  createLaunchArchiveAction,
  updateLaunchArchiveAction,
  deleteLaunchArchiveAction,
  exportLaunchArchivesAction,
  type LaunchArchive,
  type LaunchArchiveCreateInput,
  type LaunchArchivePatchInput,
} from "@/lib/api/launch-archive-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";
const thClass = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-ink/60";
const tdClass = "whitespace-nowrap px-3 py-2 text-sm text-ink";
const modalClass =
  "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4";
const modalPanelClass = "my-8 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl";

const PAGE_SIZE = 20;

interface AppliedFilters {
  from: string;
  to: string;
  network: string;
  status: string;
  decision: string;
  offerName: string;
}

const EMPTY_FILTERS: AppliedFilters = {
  from: "",
  to: "",
  network: "",
  status: "",
  decision: "",
  offerName: "",
};

/** Display a number without inventing units (API returns derived values as-is). */
function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

/** Display a ratio (e.g. 0.02) as a percentage (e.g. 2%). API returns ratios. */
function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits).replace(/\.?0+$/, "");
  const out = s === "-0" || s === "" ? "0" : s;
  return `${out}%`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return v.slice(0, 10);
}

function numOrUndefined(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function linesOrUndefined(s: string): string[] | undefined {
  const lines = s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function toEditForm(a: LaunchArchive): Record<string, string> {
  const str = (v: number | null | undefined) => (v != null ? String(v) : "");
  return {
    offerName: a.offerName ?? "",
    network: a.network ?? "",
    decision: a.decision ?? "",
    decisionReason: a.decisionReason ?? "",
    termsBrandBidding: a.termsBrandBidding ?? "",
    termsDirectLinking: a.termsDirectLinking ?? "",
    termsSummary: a.termsSummary ?? "",
    myBid: str(a.myBid),
    officialBid: str(a.officialBid),
    impressions: str(a.impressions),
    clicks: str(a.clicks),
    spend: str(a.spend),
    conversions: str(a.conversions),
    revenue: str(a.revenue),
    status: a.status ?? "",
    notes: a.notes ?? "",
    launchedAt: a.launchedAt ? a.launchedAt.slice(0, 10) : "",
    endedAt: a.endedAt ? a.endedAt.slice(0, 10) : "",
  };
}

/** Launch archive report: filters + table + detail/edit + create + CSV export. */
export function LaunchArchiveClient({
  dict,
  initialOfferId,
}: {
  dict: LaunchArchiveDict;
  initialOfferId?: string | null;
}) {
  const d = dict;
  const f = d.fields;

  const [draft, setDraft] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [offerIdFilter, setOfferIdFilter] = useState<string | null>(initialOfferId ?? null);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LaunchArchive[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<LaunchArchive | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<Record<string, string>>({ status: "draft" });
  const [creating, setCreating] = useState(false);

  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (flt: AppliedFilters, oid: string | null, p: number) => {
    setLoading(true);
    setError(null);
    const res = await listLaunchArchivesAction({
      from: flt.from || undefined,
      to: flt.to || undefined,
      network: flt.network || undefined,
      status: flt.status || undefined,
      decision: flt.decision || undefined,
      offerId: oid || undefined,
      page: p,
      pageSize: PAGE_SIZE,
    });
    if (res.ok) {
      setItems(res.data.items);
      setTotal(res.data.total);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(applied, offerIdFilter, page);
  }, [applied, offerIdFilter, page, load]);

  function onSearch() {
    setApplied(draft);
    setPage(1);
  }

  function onReset() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  // Offer-name text search is client-side (the list API has no offerName
  // param); it filters the fetched page only.
  const displayed =
    applied.offerName.trim()
      ? items.filter((it) => it.offerName.toLowerCase().includes(applied.offerName.trim().toLowerCase()))
      : items;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function decisionLabel(v: string | null | undefined): string {
    if (!v) return "—";
    const map = d.decision as Record<string, string>;
    return map[v] ?? v;
  }

  function statusLabel(v: string | null | undefined): string {
    if (!v) return "—";
    const map = d.status as Record<string, string>;
    return map[v] ?? v;
  }

  function termsLabel(v: string | null | undefined): string {
    if (!v) return d.termsValues.empty;
    const map = d.termsValues as Record<string, string>;
    return map[v] ?? v;
  }

  async function openDetail(row: LaunchArchive) {
    setSelected(row);
    setEditing(false);
    setNotice(null);
    setError(null);
    // Fetch the full record (list items may omit keywords / ad copy).
    const res = await getLaunchArchiveAction(row.id);
    if (res.ok) setSelected(res.data);
    else setError(res.error);
  }

  function closeDetail() {
    setSelected(null);
    setEditing(false);
  }

  async function onSaveEdit() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const patch: LaunchArchivePatchInput = {};
    const setStr = (k: keyof LaunchArchivePatchInput, v: string) => {
      const t = v.trim();
      if (t) (patch as Record<string, unknown>)[k] = t;
    };
    const setNum = (k: keyof LaunchArchivePatchInput, v: string) => {
      const n = numOrUndefined(v);
      if (n !== undefined) (patch as Record<string, unknown>)[k] = n;
    };
    setStr("offerName", editForm.offerName ?? "");
    setStr("network", editForm.network ?? "");
    setStr("decision", editForm.decision ?? "");
    setStr("decisionReason", editForm.decisionReason ?? "");
    setStr("termsBrandBidding", editForm.termsBrandBidding ?? "");
    setStr("termsDirectLinking", editForm.termsDirectLinking ?? "");
    setStr("termsSummary", editForm.termsSummary ?? "");
    setNum("myBid", editForm.myBid ?? "");
    setNum("officialBid", editForm.officialBid ?? "");
    setNum("impressions", editForm.impressions ?? "");
    setNum("clicks", editForm.clicks ?? "");
    setNum("spend", editForm.spend ?? "");
    setNum("conversions", editForm.conversions ?? "");
    setNum("revenue", editForm.revenue ?? "");
    setStr("status", editForm.status ?? "");
    setStr("notes", editForm.notes ?? "");
    setStr("launchedAt", editForm.launchedAt ?? "");
    setStr("endedAt", editForm.endedAt ?? "");
    const res = await updateLaunchArchiveAction(selected.id, patch);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSelected(res.data);
    setEditing(false);
    setNotice(d.detail.saved);
    void load(applied, offerIdFilter, page);
  }

  async function onDelete() {
    if (!selected) return;
    if (!window.confirm(d.detail.deleteConfirm)) return;
    setDeleting(true);
    setError(null);
    const res = await deleteLaunchArchiveAction(selected.id);
    setDeleting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSelected(null);
    setEditing(false);
    setNotice(d.detail.deleted);
    void load(applied, offerIdFilter, page);
  }

  async function onCreate() {
    const offerName = (createForm.offerName ?? "").trim();
    const network = (createForm.network ?? "").trim();
    if (!offerName || !network) {
      setError(`${f.offerName} / ${f.network} ${d.createForm.required}`);
      return;
    }
    setCreating(true);
    setError(null);
    setNotice(null);
    const headlines = linesOrUndefined(createForm.adCopyHeadlines ?? "");
    const descriptions = linesOrUndefined(createForm.adCopyDescriptions ?? "");
    const input: LaunchArchiveCreateInput = {
      offerName,
      network,
      offerId: (createForm.offerId ?? "").trim() || undefined,
      offerUrl: (createForm.offerUrl ?? "").trim() || undefined,
      decision: (createForm.decision ?? "").trim() || undefined,
      decisionReason: (createForm.decisionReason ?? "").trim() || undefined,
      termsBrandBidding: (createForm.termsBrandBidding ?? "").trim() || undefined,
      termsDirectLinking: (createForm.termsDirectLinking ?? "").trim() || undefined,
      termsSummary: (createForm.termsSummary ?? "").trim() || undefined,
      payout: numOrUndefined(createForm.payout ?? ""),
      epc: numOrUndefined(createForm.epc ?? ""),
      breakevenCpc: numOrUndefined(createForm.breakevenCpc ?? ""),
      breakevenCvrPct: numOrUndefined(createForm.breakevenCvrPct ?? ""),
      recommendedBid: numOrUndefined(createForm.recommendedBid ?? ""),
      myBid: numOrUndefined(createForm.myBid ?? ""),
      officialBid: numOrUndefined(createForm.officialBid ?? ""),
      dailyBudget: numOrUndefined(createForm.dailyBudget ?? ""),
      budgetCurrency: (createForm.budgetCurrency ?? "").trim() || undefined,
      keywords: linesOrUndefined(createForm.keywords ?? ""),
      adCopy: headlines || descriptions ? { headlines: headlines ?? [], descriptions: descriptions ?? [] } : undefined,
      impressions: numOrUndefined(createForm.impressions ?? ""),
      clicks: numOrUndefined(createForm.clicks ?? ""),
      spend: numOrUndefined(createForm.spend ?? ""),
      conversions: numOrUndefined(createForm.conversions ?? ""),
      revenue: numOrUndefined(createForm.revenue ?? ""),
      status: (createForm.status ?? "").trim() || undefined,
      notes: (createForm.notes ?? "").trim() || undefined,
      launchedAt: (createForm.launchedAt ?? "").trim() || undefined,
      endedAt: (createForm.endedAt ?? "").trim() || undefined,
    };
    const res = await createLaunchArchiveAction(input);
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setShowCreate(false);
    setCreateForm({ status: "draft" });
    setNotice(d.createForm.created);
    setPage(1);
    void load(applied, offerIdFilter, 1);
  }

  async function onExport() {
    setExporting(true);
    setError(null);
    const res = await exportLaunchArchivesAction({
      from: applied.from || undefined,
      to: applied.to || undefined,
      network: applied.network || undefined,
      status: applied.status || undefined,
      decision: applied.decision || undefined,
      offerId: offerIdFilter || undefined,
    });
    setExporting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "launch-archives.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const setDraftField = (k: keyof AppliedFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((prev) => ({ ...prev, [k]: e.target.value }));
  const setEditField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditForm((prev) => ({ ...prev, [k]: e.target.value }));
  const setCreateField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCreateForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <EntityPageHeader title={d.title} description={d.description} />

      {notice ? (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-600/30 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      {/* Filters */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className={labelClass} htmlFor="la-from">{d.filters.from}</label>
            <input id="la-from" type="date" className={inputClass} value={draft.from} onChange={setDraftField("from")} />
          </div>
          <div>
            <label className={labelClass} htmlFor="la-to">{d.filters.to}</label>
            <input id="la-to" type="date" className={inputClass} value={draft.to} onChange={setDraftField("to")} />
          </div>
          <div>
            <label className={labelClass} htmlFor="la-network">{d.filters.network}</label>
            <input
              id="la-network"
              className={inputClass}
              placeholder={d.filters.networkPlaceholder}
              value={draft.network}
              onChange={setDraftField("network")}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="la-status">{d.filters.status}</label>
            <select id="la-status" className={inputClass} value={draft.status} onChange={setDraftField("status")}>
              <option value="">{d.filters.statusAll}</option>
              {Object.entries(d.status).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="la-decision">{d.filters.decision}</label>
            <select id="la-decision" className={inputClass} value={draft.decision} onChange={setDraftField("decision")}>
              <option value="">{d.filters.decisionAll}</option>
              {Object.entries(d.decision).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="la-offer">{d.filters.offer}</label>
            <input
              id="la-offer"
              className={inputClass}
              placeholder={d.filters.offerPlaceholder}
              value={draft.offerName}
              onChange={setDraftField("offerName")}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} onClick={onSearch} disabled={loading}>
            {d.filters.search}
          </button>
          <button type="button" className={btnGhost} onClick={onReset}>
            {d.filters.reset}
          </button>
          <button type="button" className={btnGhost} onClick={() => setShowCreate(true)}>
            {d.create}
          </button>
          <button type="button" className={btnGhost} onClick={onExport} disabled={exporting}>
            {exporting ? d.downloading : d.downloadCsv}
          </button>
          {offerIdFilter ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-signal/10 px-2 py-1 text-xs text-ink/70">
              {d.filters.offerIdFilter}: {offerIdFilter}
              <button
                type="button"
                className="font-bold hover:text-red-600"
                onClick={() => {
                  setOfferIdFilter(null);
                  setPage(1);
                }}
                aria-label={d.filters.clearOfferIdFilter}
              >
                ✕
              </button>
            </span>
          ) : null}
        </div>
      </section>

      {/* List */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="mb-3 flex items-center justify-between text-sm text-ink/60">
          <span>
            {d.total.replace("{n}", String(total))}
            {applied.offerName.trim() ? ` · ${d.showingFiltered.replace("{n}", String(displayed.length))}` : ""}
          </span>
          <span>
            {d.pageInfo.replace("{page}", String(page)).replace("{pages}", String(pageCount))}
          </span>
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-ink/50">…</p>
        ) : displayed.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/50">{d.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left">
              <thead>
                <tr className="border-b border-ink/10">
                  <th className={thClass}>{d.columns.offer}</th>
                  <th className={thClass}>{d.columns.network}</th>
                  <th className={thClass}>{d.columns.decision}</th>
                  <th className={thClass}>{d.columns.status}</th>
                  <th className={thClass}>{d.columns.createdAt}</th>
                  <th className={thClass}>{d.columns.myBid}</th>
                  <th className={thClass}>{d.columns.recommendedBid}</th>
                  <th className={thClass}>{d.columns.officialBid}</th>
                  <th className={thClass}>{d.columns.impressions}</th>
                  <th className={thClass}>{d.columns.clicks}</th>
                  <th className={thClass}>{d.columns.spend}</th>
                  <th className={thClass}>{d.columns.conversions}</th>
                  <th className={thClass}>{d.columns.roi}</th>
                  <th className={thClass}>{d.columns.diagnosis}</th>
                  <th className={thClass}>{d.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((it) => (
                  <tr
                    key={it.id}
                    className="cursor-pointer border-b border-ink/5 hover:bg-ink/[0.02]"
                    onClick={() => void openDetail(it)}
                  >
                    <td className={tdClass}>{it.offerName}</td>
                    <td className={tdClass}>{it.network}</td>
                    <td className={tdClass}>{decisionLabel(it.decision)}</td>
                    <td className={tdClass}>{statusLabel(it.status)}</td>
                    <td className={tdClass}>{fmtDate(it.createdAt)}</td>
                    <td className={tdClass}>{fmtNum(it.myBid)}</td>
                    <td className={tdClass}>{fmtNum(it.recommendedBid)}</td>
                    <td className={tdClass}>{fmtNum(it.officialBid)}</td>
                    <td className={tdClass}>{it.impressions != null ? String(it.impressions) : "—"}</td>
                    <td className={tdClass}>{it.clicks != null ? String(it.clicks) : "—"}</td>
                    <td className={tdClass}>{it.spend != null ? fmtNum(it.spend) : "—"}</td>
                    <td className={tdClass}>{it.conversions != null ? String(it.conversions) : "—"}</td>
                    <td className={tdClass}>{fmtPct(it.actualRoi)}</td>
                    <td className={`${tdClass} max-w-[240px] truncate`} title={it.diagnosis ?? ""}>
                      {it.diagnosis ?? "—"}
                    </td>
                    <td className={tdClass}>
                      <button
                        type="button"
                        className="text-signal hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDetail(it);
                        }}
                      >
                        {d.view}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" className={btnGhost} disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {d.pagePrev}
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={page >= pageCount || loading}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            {d.pageNext}
          </button>
        </div>
      </section>

      {/* Detail / edit modal */}
      {selected ? (
        <div className={modalClass} role="dialog" aria-modal="true" aria-label={d.detail.title}>
          <div className={modalPanelClass}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">{d.detail.title}</h2>
              <button type="button" className={btnGhost} onClick={closeDetail}>
                {d.detail.close}
              </button>
            </div>

            <h3 className="text-sm font-semibold text-ink">{d.detail.snapshot}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              <div><dt className="text-ink/50">{f.offerName}</dt><dd>{selected.offerName}</dd></div>
              <div><dt className="text-ink/50">{f.network}</dt><dd>{selected.network}</dd></div>
              <div><dt className="text-ink/50">{f.offerUrl}</dt><dd className="break-all">{selected.offerUrl ?? "—"}</dd></div>
              <div><dt className="text-ink/50">{f.payout}</dt><dd>{fmtNum(selected.payout)}</dd></div>
              <div><dt className="text-ink/50">{f.epc}</dt><dd>{fmtNum(selected.epc)}</dd></div>
              <div><dt className="text-ink/50">{f.breakevenCpc}</dt><dd>{fmtNum(selected.breakevenCpc)}</dd></div>
              <div><dt className="text-ink/50">{f.breakevenCvrPct}</dt><dd>{fmtNum(selected.breakevenCvrPct)}</dd></div>
              <div><dt className="text-ink/50">{f.recommendedBid}</dt><dd>{fmtNum(selected.recommendedBid)}</dd></div>
              <div><dt className="text-ink/50">{f.dailyBudget}</dt><dd>{fmtNum(selected.dailyBudget)}</dd></div>
              <div><dt className="text-ink/50">{f.budgetCurrency}</dt><dd>{selected.budgetCurrency ?? "—"}</dd></div>
              <div><dt className="text-ink/50">{f.createdAt}</dt><dd>{fmtDate(selected.createdAt)}</dd></div>
            </dl>
            <div className="mt-3 space-y-2 text-sm">
              <div>
                <span className="text-ink/50">{f.keywords}: </span>
                {(selected.keywords ?? []).length > 0 ? selected.keywords.join("、") : "—"}
              </div>
              {selected.adCopy ? (
                <>
                  <div>
                    <span className="text-ink/50">{f.adCopyHeadlines}: </span>
                    {selected.adCopy.headlines.length > 0 ? selected.adCopy.headlines.join(" | ") : "—"}
                  </div>
                  <div>
                    <span className="text-ink/50">{f.adCopyDescriptions}: </span>
                    {selected.adCopy.descriptions.length > 0 ? selected.adCopy.descriptions.join(" | ") : "—"}
                  </div>
                </>
              ) : null}
            </div>

            <h3 className="mt-6 text-sm font-semibold text-ink">{d.detail.performance}</h3>
            {editing ? (
              <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className={labelClass} htmlFor="la-edit-offerName">{f.offerName}</label>
                  <input id="la-edit-offerName" className={inputClass} value={editForm.offerName ?? ""} onChange={setEditField("offerName")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-network">{f.network}</label>
                  <input id="la-edit-network" className={inputClass} value={editForm.network ?? ""} onChange={setEditField("network")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-decision">{f.decision}</label>
                  <select id="la-edit-decision" className={inputClass} value={editForm.decision ?? ""} onChange={setEditField("decision")}>
                    <option value="">—</option>
                    {Object.entries(d.decision).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-status">{f.status}</label>
                  <select id="la-edit-status" className={inputClass} value={editForm.status ?? ""} onChange={setEditField("status")}>
                    <option value="">—</option>
                    {Object.entries(d.status).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-myBid">{f.myBid}</label>
                  <input id="la-edit-myBid" inputMode="decimal" className={inputClass} value={editForm.myBid ?? ""} onChange={setEditField("myBid")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-officialBid">{f.officialBid}</label>
                  <input id="la-edit-officialBid" inputMode="decimal" className={inputClass} value={editForm.officialBid ?? ""} onChange={setEditField("officialBid")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-impressions">{f.impressions}</label>
                  <input id="la-edit-impressions" inputMode="numeric" className={inputClass} value={editForm.impressions ?? ""} onChange={setEditField("impressions")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-clicks">{f.clicks}</label>
                  <input id="la-edit-clicks" inputMode="numeric" className={inputClass} value={editForm.clicks ?? ""} onChange={setEditField("clicks")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-spend">{f.spend}</label>
                  <input id="la-edit-spend" inputMode="decimal" className={inputClass} value={editForm.spend ?? ""} onChange={setEditField("spend")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-conversions">{f.conversions}</label>
                  <input id="la-edit-conversions" inputMode="numeric" className={inputClass} value={editForm.conversions ?? ""} onChange={setEditField("conversions")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-revenue">{f.revenue}</label>
                  <input id="la-edit-revenue" inputMode="decimal" className={inputClass} value={editForm.revenue ?? ""} onChange={setEditField("revenue")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-launchedAt">{f.launchedAt}</label>
                  <input id="la-edit-launchedAt" type="date" className={inputClass} value={editForm.launchedAt ?? ""} onChange={setEditField("launchedAt")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-endedAt">{f.endedAt}</label>
                  <input id="la-edit-endedAt" type="date" className={inputClass} value={editForm.endedAt ?? ""} onChange={setEditField("endedAt")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-termsBrand">{f.termsBrandBidding}</label>
                  <select id="la-edit-termsBrand" className={inputClass} value={editForm.termsBrandBidding ?? ""} onChange={setEditField("termsBrandBidding")}>
                    <option value="">{d.termsValues.empty}</option>
                    {["allowed", "forbidden", "restricted", "unknown"].map((k) => (
                      <option key={k} value={k}>{(d.termsValues as Record<string, string>)[k]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-termsDirect">{f.termsDirectLinking}</label>
                  <select id="la-edit-termsDirect" className={inputClass} value={editForm.termsDirectLinking ?? ""} onChange={setEditField("termsDirectLinking")}>
                    <option value="">{d.termsValues.empty}</option>
                    {["allowed", "forbidden", "restricted", "unknown"].map((k) => (
                      <option key={k} value={k}>{(d.termsValues as Record<string, string>)[k]}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass} htmlFor="la-edit-decisionReason">{f.decisionReason}</label>
                  <textarea id="la-edit-decisionReason" rows={2} className={inputClass} value={editForm.decisionReason ?? ""} onChange={setEditField("decisionReason")} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass} htmlFor="la-edit-termsSummary">{f.termsSummary}</label>
                  <textarea id="la-edit-termsSummary" rows={2} className={inputClass} value={editForm.termsSummary ?? ""} onChange={setEditField("termsSummary")} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass} htmlFor="la-edit-notes">{f.notes}</label>
                  <textarea id="la-edit-notes" rows={2} className={inputClass} value={editForm.notes ?? ""} onChange={setEditField("notes")} />
                </div>
              </div>
            ) : (
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                <div><dt className="text-ink/50">{f.decision}</dt><dd>{decisionLabel(selected.decision)}</dd></div>
                <div><dt className="text-ink/50">{f.status}</dt><dd>{statusLabel(selected.status)}</dd></div>
                <div><dt className="text-ink/50">{f.myBid}</dt><dd>{fmtNum(selected.myBid)}</dd></div>
                <div><dt className="text-ink/50">{f.officialBid}</dt><dd>{fmtNum(selected.officialBid)}</dd></div>
                <div><dt className="text-ink/50">{f.impressions}</dt><dd>{selected.impressions != null ? String(selected.impressions) : "—"}</dd></div>
                <div><dt className="text-ink/50">{f.clicks}</dt><dd>{selected.clicks != null ? String(selected.clicks) : "—"}</dd></div>
                <div><dt className="text-ink/50">{f.spend}</dt><dd>{fmtNum(selected.spend)}</dd></div>
                <div><dt className="text-ink/50">{f.conversions}</dt><dd>{selected.conversions != null ? String(selected.conversions) : "—"}</dd></div>
                <div><dt className="text-ink/50">{f.revenue}</dt><dd>{fmtNum(selected.revenue)}</dd></div>
                <div><dt className="text-ink/50">{f.launchedAt}</dt><dd>{fmtDate(selected.launchedAt)}</dd></div>
                <div><dt className="text-ink/50">{f.endedAt}</dt><dd>{fmtDate(selected.endedAt)}</dd></div>
                <div><dt className="text-ink/50">{f.termsBrandBidding}</dt><dd>{termsLabel(selected.termsBrandBidding)}</dd></div>
                <div><dt className="text-ink/50">{f.termsDirectLinking}</dt><dd>{termsLabel(selected.termsDirectLinking)}</dd></div>
              </dl>
            )}
            {!editing ? (
              <div className="mt-3 space-y-2 text-sm">
                <div><span className="text-ink/50">{f.decisionReason}: </span>{selected.decisionReason ?? "—"}</div>
                <div><span className="text-ink/50">{f.termsSummary}: </span>{selected.termsSummary ?? "—"}</div>
                <div><span className="text-ink/50">{f.notes}: </span>{selected.notes ?? "—"}</div>
              </div>
            ) : null}

            <h3 className="mt-6 text-sm font-semibold text-ink">{d.detail.derived}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              <div><dt className="text-ink/50">{f.actualCpc}</dt><dd>{fmtNum(selected.actualCpc)}</dd></div>
              <div><dt className="text-ink/50">{f.actualCvr}</dt><dd>{fmtPct(selected.actualCvr)}</dd></div>
              <div><dt className="text-ink/50">{f.actualRoi}</dt><dd>{fmtPct(selected.actualRoi)}</dd></div>
              <div><dt className="text-ink/50">{f.profit}</dt><dd>{fmtNum(selected.profit)}</dd></div>
            </dl>
            <p className="mt-2 text-sm"><span className="text-ink/50">{f.diagnosis}: </span>{selected.diagnosis ?? "—"}</p>

            <div className="mt-6 flex flex-wrap gap-2">
              {editing ? (
                <>
                  <button type="button" className={btnPrimary} onClick={onSaveEdit} disabled={saving}>
                    {saving ? d.detail.saving : d.detail.save}
                  </button>
                  <button type="button" className={btnGhost} onClick={() => setEditing(false)}>
                    {d.detail.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => {
                    setEditForm(toEditForm(selected));
                    setEditing(true);
                  }}
                >
                  {d.detail.edit}
                </button>
              )}
              <button
                type="button"
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                onClick={onDelete}
                disabled={deleting}
              >
                {d.detail.delete}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create modal */}
      {showCreate ? (
        <div className={modalClass} role="dialog" aria-modal="true" aria-label={d.createForm.title}>
          <div className={modalPanelClass}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">{d.createForm.title}</h2>
              <button type="button" className={btnGhost} onClick={() => setShowCreate(false)}>
                {d.detail.close}
              </button>
            </div>

            <h3 className="text-sm font-semibold text-ink">{d.createForm.basic}</h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="la-new-offerName">{f.offerName} *</label>
                <input id="la-new-offerName" className={inputClass} value={createForm.offerName ?? ""} onChange={setCreateField("offerName")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-network">{f.network} *</label>
                <input id="la-new-network" className={inputClass} value={createForm.network ?? ""} onChange={setCreateField("network")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-offerId">{f.offerId}</label>
                <input id="la-new-offerId" className={inputClass} value={createForm.offerId ?? ""} onChange={setCreateField("offerId")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-offerUrl">{f.offerUrl}</label>
                <input id="la-new-offerUrl" className={inputClass} value={createForm.offerUrl ?? ""} onChange={setCreateField("offerUrl")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-status">{f.status}</label>
                <select id="la-new-status" className={inputClass} value={createForm.status ?? "draft"} onChange={setCreateField("status")}>
                  {Object.entries(d.status).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-launchedAt">{f.launchedAt}</label>
                <input id="la-new-launchedAt" type="date" className={inputClass} value={createForm.launchedAt ?? ""} onChange={setCreateField("launchedAt")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-endedAt">{f.endedAt}</label>
                <input id="la-new-endedAt" type="date" className={inputClass} value={createForm.endedAt ?? ""} onChange={setCreateField("endedAt")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-notes">{f.notes}</label>
                <input id="la-new-notes" className={inputClass} value={createForm.notes ?? ""} onChange={setCreateField("notes")} />
              </div>
            </div>

            <h3 className="mt-5 text-sm font-semibold text-ink">{d.createForm.terms}</h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="la-new-decision">{f.decision}</label>
                <select id="la-new-decision" className={inputClass} value={createForm.decision ?? ""} onChange={setCreateField("decision")}>
                  <option value="">—</option>
                  {Object.entries(d.decision).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-decisionReason">{f.decisionReason}</label>
                <input id="la-new-decisionReason" className={inputClass} value={createForm.decisionReason ?? ""} onChange={setCreateField("decisionReason")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-termsBrand">{f.termsBrandBidding}</label>
                <select id="la-new-termsBrand" className={inputClass} value={createForm.termsBrandBidding ?? ""} onChange={setCreateField("termsBrandBidding")}>
                  <option value="">{d.termsValues.empty}</option>
                  {["allowed", "forbidden", "restricted", "unknown"].map((k) => (
                    <option key={k} value={k}>{(d.termsValues as Record<string, string>)[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-termsDirect">{f.termsDirectLinking}</label>
                <select id="la-new-termsDirect" className={inputClass} value={createForm.termsDirectLinking ?? ""} onChange={setCreateField("termsDirectLinking")}>
                  <option value="">{d.termsValues.empty}</option>
                  {["allowed", "forbidden", "restricted", "unknown"].map((k) => (
                    <option key={k} value={k}>{(d.termsValues as Record<string, string>)[k]}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelClass} htmlFor="la-new-termsSummary">{f.termsSummary}</label>
                <textarea id="la-new-termsSummary" rows={2} className={inputClass} value={createForm.termsSummary ?? ""} onChange={setCreateField("termsSummary")} />
              </div>
            </div>

            <h3 className="mt-5 text-sm font-semibold text-ink">{d.createForm.bids}</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
              {(
                [
                  ["payout", f.payout],
                  ["epc", f.epc],
                  ["breakevenCpc", f.breakevenCpc],
                  ["breakevenCvrPct", f.breakevenCvrPct],
                  ["recommendedBid", f.recommendedBid],
                  ["myBid", f.myBid],
                  ["officialBid", f.officialBid],
                  ["dailyBudget", f.dailyBudget],
                  ["budgetCurrency", f.budgetCurrency],
                ] as Array<[string, string]>
              ).map(([k, label]) => (
                <div key={k}>
                  <label className={labelClass} htmlFor={`la-new-${k}`}>{label}</label>
                  <input
                    id={`la-new-${k}`}
                    inputMode={k === "budgetCurrency" ? "text" : "decimal"}
                    className={inputClass}
                    value={createForm[k] ?? ""}
                    onChange={setCreateField(k)}
                  />
                </div>
              ))}
            </div>

            <h3 className="mt-5 text-sm font-semibold text-ink">{d.createForm.keywords}</h3>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="la-new-keywords">{f.keywords}</label>
                <textarea id="la-new-keywords" rows={4} className={inputClass} placeholder={d.createForm.keywordsHint} value={createForm.keywords ?? ""} onChange={setCreateField("keywords")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-headlines">{f.adCopyHeadlines}</label>
                <textarea id="la-new-headlines" rows={4} className={inputClass} placeholder={d.createForm.headlinesHint} value={createForm.adCopyHeadlines ?? ""} onChange={setCreateField("adCopyHeadlines")} />
              </div>
              <div>
                <label className={labelClass} htmlFor="la-new-descriptions">{f.adCopyDescriptions}</label>
                <textarea id="la-new-descriptions" rows={4} className={inputClass} placeholder={d.createForm.descriptionsHint} value={createForm.adCopyDescriptions ?? ""} onChange={setCreateField("adCopyDescriptions")} />
              </div>
            </div>

            <h3 className="mt-5 text-sm font-semibold text-ink">{d.createForm.performance}</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
              {(
                [
                  ["impressions", f.impressions],
                  ["clicks", f.clicks],
                  ["spend", f.spend],
                  ["conversions", f.conversions],
                  ["revenue", f.revenue],
                ] as Array<[string, string]>
              ).map(([k, label]) => (
                <div key={k}>
                  <label className={labelClass} htmlFor={`la-new-${k}`}>{label}</label>
                  <input
                    id={`la-new-${k}`}
                    inputMode="decimal"
                    className={inputClass}
                    value={createForm[k] ?? ""}
                    onChange={setCreateField(k)}
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-2">
              <button type="button" className={btnPrimary} onClick={onCreate} disabled={creating}>
                {creating ? d.createForm.creating : d.createForm.submit}
              </button>
              <button type="button" className={btnGhost} onClick={() => setShowCreate(false)}>
                {d.detail.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
