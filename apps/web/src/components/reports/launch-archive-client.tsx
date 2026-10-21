"use client";

import { useCallback, useEffect, useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import { DailyAlertsCard } from "@/components/monitoring/daily-alerts-card";
import type { LaunchArchiveDict } from "@/i18n/dict/launch-archive";
import { paceChecklist, daysActiveSince } from "@/lib/pace-checklist";
import {
  listLaunchArchivesAction,
  getLaunchArchiveAction,
  getBudgetOverviewAction,
  createLaunchArchiveAction,
  updateLaunchArchiveAction,
  deleteLaunchArchiveAction,
  exportLaunchArchivesAction,
  type BudgetOverview,
  type LaunchArchive,
  type LaunchArchiveCreateInput,
  type LaunchArchivePatchInput,
} from "@/lib/api/launch-archive-actions";
import {
  LaunchPerfPanel,
  PerfVerdictBadge,
} from "@/components/reports/launch-perf-panel";

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
    // P1-4：分阶段预算（全部留空 = 不改；部分填 = 保存时报错）。
    testDailyBudget: str(a.testingPhase?.dailyBudget),
    testTotalBudget: str(a.testingPhase?.totalBudget),
    testExpectedClicks: str(a.testingPhase?.expectedClicks),
    testExpectedConversions: str(a.testingPhase?.expectedConversions),
    testDurationDays: str(a.testingPhase?.durationDays),
    scaleTriggerRoas: str(a.scalingPhase?.triggerRoas),
    scaleDailyBudget: str(a.scalingPhase?.dailyBudget),
    scaleMaxDailyBudget: str(a.scalingPhase?.maxDailyBudget),
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

  /** P1-28：预算总览 + 盈亏平衡点（与档案列表并行加载，无数据 → “—”）。 */
  const [overview, setOverview] = useState<BudgetOverview | null>(null);
  useEffect(() => {
    void getBudgetOverviewAction().then((res) => {
      if (res.ok) setOverview(res.data);
    });
  }, []);

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
    // P1-4：分阶段预算（每组全填才提交；部分填 → 报错不保存）。
    const testKeys = ["testDailyBudget", "testTotalBudget", "testExpectedClicks", "testExpectedConversions", "testDurationDays"] as const;
    const scaleKeys = ["scaleTriggerRoas", "scaleDailyBudget", "scaleMaxDailyBudget"] as const;
    const testVals = testKeys.map((k) => (editForm[k] ?? "").trim());
    const scaleVals = scaleKeys.map((k) => (editForm[k] ?? "").trim());
    const anyTest = testVals.some(Boolean);
    const anyScale = scaleVals.some(Boolean);
    if ((anyTest && testVals.some((v) => !v)) || (anyScale && scaleVals.some((v) => !v))) {
      setError(d.detail.phaseIncomplete);
      setSaving(false);
      return;
    }
    if (anyTest) {
      (patch as Record<string, unknown>).testingPhase = {
        dailyBudget: Number(testVals[0]),
        totalBudget: Number(testVals[1]),
        expectedClicks: Number(testVals[2]),
        expectedConversions: Number(testVals[3]),
        durationDays: Number(testVals[4]),
      };
    }
    if (anyScale) {
      (patch as Record<string, unknown>).scalingPhase = {
        triggerRoas: Number(scaleVals[0]),
        dailyBudget: Number(scaleVals[1]),
        maxDailyBudget: Number(scaleVals[2]),
      };
    }
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

      {/* P2-9：每日预警（分级 P0/P1/P2；仅展示，不自动执行）。 */}
      <DailyAlertsCard
        title={d.dailyAlertsTitle}
        emptyText={d.dailyAlertsEmpty}
      />

      {/* P1-28：预算总览 + 盈亏平衡点（无数据 → “—”，绝不编造）。 */}
      {overview ? (
        <section className="rounded-xl border border-ink/10 bg-white p-5">
          <h2 className="text-base font-semibold text-ink">{d.budgetOverview.title}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {(
              [
                ["totalBudget", overview.totals.totalBudget],
                ["totalSpend", overview.totals.totalSpend],
                ["utilization", overview.totals.utilization],
                ["remaining", overview.totals.remaining],
                ["dailyAvg", overview.totals.dailyAvg],
                ["projected30d", overview.totals.projected30d],
                ["remainingDays", overview.totals.remainingDays],
                ["activeCampaigns", overview.totals.activeCampaignCount],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
                <p className="text-xs text-ink/60">
                  {(d.budgetOverview as Record<string, string>)[k] ?? k}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {v === null || v === undefined
                    ? d.budgetOverview.noData
                    : k === "utilization"
                      ? `${(Number(v) * 100).toFixed(1)}%`
                      : k === "remainingDays"
                        ? `${Number(v).toFixed(1)}`
                        : k === "activeCampaigns"
                          ? String(v)
                          : `$${Number(v).toFixed(2)}`}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">{d.budgetOverview.breakevenTitle}</h3>
              <ul className="mt-2 space-y-1 text-sm text-ink/80">
                <li>
                  {d.budgetOverview.requiredConversions}：
                  {overview.breakeven.requiredConversions === null
                    ? d.budgetOverview.noData
                    : Math.ceil(overview.breakeven.requiredConversions).toLocaleString()}
                </li>
                <li>
                  {d.budgetOverview.avgBreakevenCpa}：
                  {overview.breakeven.avgBreakevenCpa === null
                    ? d.budgetOverview.noData
                    : `$${overview.breakeven.avgBreakevenCpa.toFixed(2)}`}
                </li>
                <li>
                  {d.budgetOverview.totalRoas}：
                  {overview.breakeven.totalRoas === null
                    ? d.budgetOverview.noData
                    : `${(overview.breakeven.totalRoas * 100).toFixed(1)}%`}
                </li>
                <li>
                  {d.budgetOverview.totalCommission}：${overview.breakeven.totalCommission.toFixed(2)}
                </li>
                <li>
                  {d.budgetOverview.conversionEfficiency}：
                  {overview.breakeven.conversionEfficiency === null
                    ? d.budgetOverview.noData
                    : `${(overview.breakeven.conversionEfficiency * 100).toFixed(2)}%`}
                </li>
                <li>
                  {d.budgetOverview.commissionRate}：
                  {overview.breakeven.commissionRate === null
                    ? d.budgetOverview.noData
                    : `${(overview.breakeven.commissionRate * 100).toFixed(1)}%`}
                </li>
                <li>
                  {d.budgetOverview.commissionPerConversion}：
                  {overview.breakeven.commissionPerConversion === null
                    ? d.budgetOverview.noData
                    : `$${overview.breakeven.commissionPerConversion.toFixed(2)}`}
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">{d.budgetOverview.perOffer}</h3>
              {overview.perOffer.length === 0 ? (
                <p className="mt-2 text-sm text-ink/60">{d.budgetOverview.noData}</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-ink/80">
                  {overview.perOffer.slice(0, 10).map((o) => (
                    <li key={o.offerName}>
                      {o.offerName}：预算 ${o.budget.toFixed(2)} · 已花 ${o.spent.toFixed(2)} ·
                      转化 {o.conversions} · 佣金 ${o.commission.toFixed(2)} ·
                      ROAS {o.roas === null ? d.budgetOverview.noData : `${(o.roas * 100).toFixed(1)}%`}
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="mt-4 text-sm font-semibold text-ink">{d.budgetOverview.top10}</h3>
              {overview.top10.length === 0 ? (
                <p className="mt-2 text-sm text-ink/60">{d.budgetOverview.noData}</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-ink/80">
                  {overview.top10.map((c) => (
                    <li key={c.id}>
                      {c.offerName}：日预算{" "}
                      {c.dailyBudget === null ? d.budgetOverview.noData : `$${c.dailyBudget.toFixed(2)}`} ·
                      已花 {c.spend === null ? d.budgetOverview.noData : `$${c.spend.toFixed(2)}`} ·
                      转化 {c.conversions ?? d.budgetOverview.noData}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
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
                  <th className={thClass}>{d.columns.ctr}</th>
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
                    {/* P1-29：样本不足显示“样本不足”，不显示 CTR。 */}
                    <td className={tdClass} title={it.ctrNote ?? ""}>
                      {it.actualCtr != null ? fmtPct(it.actualCtr) : "样本不足"}
                    </td>
                    <td className={`${tdClass} max-w-[240px] truncate`} title={it.diagnosis ?? ""}>
                      {it.diagnosis ?? "—"}
                      {it.perfVerdict && (
                        <span className="ml-2">
                          <PerfVerdictBadge verdict={it.perfVerdict} p={d.perf} />
                        </span>
                      )}
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
                {/* P1-4：分阶段预算编辑（测试期 5 项 + 扩量期 3 项）。 */}
                <div>
                  <label className={labelClass} htmlFor="la-edit-testDaily">{f.testDailyBudget}</label>
                  <input id="la-edit-testDaily" inputMode="decimal" className={inputClass} value={editForm.testDailyBudget ?? ""} onChange={setEditField("testDailyBudget")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-testTotal">{f.testTotalBudget}</label>
                  <input id="la-edit-testTotal" inputMode="decimal" className={inputClass} value={editForm.testTotalBudget ?? ""} onChange={setEditField("testTotalBudget")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-testClicks">{f.testExpectedClicks}</label>
                  <input id="la-edit-testClicks" inputMode="decimal" className={inputClass} value={editForm.testExpectedClicks ?? ""} onChange={setEditField("testExpectedClicks")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-testConv">{f.testExpectedConversions}</label>
                  <input id="la-edit-testConv" inputMode="decimal" className={inputClass} value={editForm.testExpectedConversions ?? ""} onChange={setEditField("testExpectedConversions")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-testDays">{f.testDurationDays}</label>
                  <input id="la-edit-testDays" inputMode="numeric" className={inputClass} value={editForm.testDurationDays ?? ""} onChange={setEditField("testDurationDays")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-scaleRoas">{f.scaleTriggerRoas}</label>
                  <input id="la-edit-scaleRoas" inputMode="decimal" className={inputClass} value={editForm.scaleTriggerRoas ?? ""} onChange={setEditField("scaleTriggerRoas")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-scaleDaily">{f.scaleDailyBudget}</label>
                  <input id="la-edit-scaleDaily" inputMode="decimal" className={inputClass} value={editForm.scaleDailyBudget ?? ""} onChange={setEditField("scaleDailyBudget")} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="la-edit-scaleMax">{f.scaleMaxDailyBudget}</label>
                  <input id="la-edit-scaleMax" inputMode="decimal" className={inputClass} value={editForm.scaleMaxDailyBudget ?? ""} onChange={setEditField("scaleMaxDailyBudget")} />
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
              <div><dt className="text-ink/50">{f.actualCtr}</dt><dd>{selected.actualCtr != null ? fmtPct(selected.actualCtr) : "样本不足"}</dd></div>
              <div><dt className="text-ink/50">{f.profit}</dt><dd>{fmtNum(selected.profit)}</dd></div>
            </dl>
            {selected.ctrNote ? (
              <p className="mt-2 text-sm text-ink/60">{selected.ctrNote}</p>
            ) : null}

            {/* P1-4：分阶段预算（只读展示；扩量口径为上新系列、预算不变）。 */}
            <h3 className="mt-6 text-sm font-semibold text-ink">{d.detail.stagedBudget}</h3>
            {editing ? null : selected.testingPhase || selected.scalingPhase ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                {selected.testingPhase ? (
                  <>
                    <div><dt className="text-ink/50">{f.testDailyBudget}</dt><dd>{fmtNum(selected.testingPhase.dailyBudget)}</dd></div>
                    <div><dt className="text-ink/50">{f.testTotalBudget}</dt><dd>{fmtNum(selected.testingPhase.totalBudget)}</dd></div>
                    <div><dt className="text-ink/50">{f.testExpectedClicks}</dt><dd>{fmtNum(selected.testingPhase.expectedClicks)}</dd></div>
                    <div><dt className="text-ink/50">{f.testExpectedConversions}</dt><dd>{fmtNum(selected.testingPhase.expectedConversions)}</dd></div>
                    <div><dt className="text-ink/50">{f.testDurationDays}</dt><dd>{selected.testingPhase.durationDays}</dd></div>
                  </>
                ) : null}
                {selected.scalingPhase ? (
                  <>
                    <div><dt className="text-ink/50">{f.scaleTriggerRoas}</dt><dd>{fmtNum(selected.scalingPhase.triggerRoas)}</dd></div>
                    <div><dt className="text-ink/50">{f.scaleDailyBudget}</dt><dd>{fmtNum(selected.scalingPhase.dailyBudget)}</dd></div>
                    <div><dt className="text-ink/50">{f.scaleMaxDailyBudget}</dt><dd>{fmtNum(selected.scalingPhase.maxDailyBudget)}</dd></div>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-ink/60">—</p>
            )}
            <p className="mt-2 text-sm text-ink/60">{d.detail.scaleNote}</p>

            {/* P1-5：测试节奏清单（与 P2-9 同一份 pace-checklist 规则；展示建议，不自动执行）。 */}
            <h3 className="mt-6 text-sm font-semibold text-ink">{d.detail.paceTitle}</h3>
            {(() => {
              const suggestions = paceChecklist({
                impressions: selected.impressions,
                clicks: selected.clicks,
                conversions: selected.conversions,
                spend: selected.spend,
                revenue: selected.revenue,
                payout: selected.payout,
                daysActive: daysActiveSince(selected.launchedAt ?? selected.createdAt),
              });
              if (suggestions.length === 0) {
                return <p className="mt-2 text-sm text-ink/60">{d.detail.paceEmpty}</p>;
              }
              return (
                <ul className="mt-2 space-y-2 text-sm">
                  {suggestions.map((s, i) => (
                    <li key={i} className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
                      <p>
                        <span className={s.level === "action" ? "font-semibold text-red-700" : s.level === "warn" ? "font-semibold text-amber-700" : "font-semibold"}>
                          {s.level === "action" ? "建议动作" : s.level === "warn" ? "需要关注" : "观察提示"}
                          ：
                        </span>
                        {s.text}
                      </p>
                      <p className="mt-1 text-xs text-ink/50">{s.source}</p>
                    </li>
                  ))}
                </ul>
              );
            })()}
            {/* P2-6：诊断码（统一阈值，仅真实数据触发）+ P1-5 节奏清单。 */}
            {selected.diagnosisCodes && selected.diagnosisCodes.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-ink">{d.detail.diagnosisCodes}</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.diagnosisCodes.map((code) => (
                    <span
                      key={code}
                      className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                      title={
                        (d.detail.diagnosisCodeLabels as Record<string, string>)[code] ?? code
                      }
                    >
                      {(d.detail.diagnosisCodeLabels as Record<string, string>)[code] ?? code}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-sm"><span className="text-ink/50">{f.diagnosis}: </span>{selected.diagnosis ?? "—"}</p>

            {/* 投流回填 + 止损/低价判断 + 自动止损脚本（人工回填驱动） */}
            <LaunchPerfPanel
              archive={selected}
              d={d}
              onChanged={() => {
                void load(applied, offerIdFilter, page);
                void openDetail(selected);
              }}
            />

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
