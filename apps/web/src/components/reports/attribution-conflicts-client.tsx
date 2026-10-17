"use client";

import { useEffect, useState } from "react";
import {
  getAttributionSettingsAction,
  updateAttributionSettingsAction,
  listAttributionConflictsAction,
  resolveAttributionConflictAction,
  getAttributionReportAction,
  type AttributionConflict,
  type AttributionReport,
  type AttributionSettings,
} from "@/lib/api/attribution-actions";

/**
 * P1-11：归因冲突页（/reports/attribution-conflicts）。
 * 设置 + 冲突列表/手动解决 + 可归因/不可归因拆分。
 * 解决冲突必须人工选择归属 Offer，绝不静默取第一个匹配。
 */
export interface AttributionConflictsDict {
  title: string;
  settingsTitle: string;
  windowDays: string;
  dedupeMinutes: string;
  dupCounts: string;
  save: string;
  saving: string;
  saved: string;
  conflictsTitle: string;
  empty: string;
  order: string;
  candidates: string;
  reason: string;
  status: string;
  resolve: string;
  resolving: string;
  resolved: string;
  resolveConfirm: string;
  reportTitle: string;
  attributable: string;
  unattributable: string;
  unattributableNote: string;
  byOffer: string;
  orders: string;
  value: string;
}

export function AttributionConflictsClient({ dict: d }: { dict: AttributionConflictsDict }) {
  const [settings, setSettings] = useState<AttributionSettings | null>(null);
  const [conflicts, setConflicts] = useState<AttributionConflict[]>([]);
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, c, r] = await Promise.all([
        getAttributionSettingsAction(),
        listAttributionConflictsAction(),
        getAttributionReportAction(),
      ]);
      if (s.ok) setSettings(s.data);
      if (c.ok) setConflicts(c.data.items);
      if (r.ok) setReport(r.data);
      setLoading(false);
    })();
  }, []);

  async function onSaveSettings() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    const res = await updateAttributionSettingsAction({
      attributionWindowDays: settings.attributionWindowDays,
      gclidDedupeMinutes: settings.gclidDedupeMinutes,
      duplicateClicksCountAsConversion: settings.duplicateClicksCountAsConversion,
    });
    setSaving(false);
    if (res.ok) {
      setSettings(res.data);
      setMsg(d.saved);
    } else {
      setMsg(res.error);
    }
  }

  async function onResolve(c: AttributionConflict, offerId: string) {
    if (!window.confirm(d.resolveConfirm)) return;
    setResolvingId(c.id);
    setMsg(null);
    const res = await resolveAttributionConflictAction(c.id, offerId);
    setResolvingId(null);
    if (res.ok) {
      setMsg(d.resolved);
      const list = await listAttributionConflictsAction();
      if (list.ok) setConflicts(list.data.items);
    } else {
      setMsg(res.error);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-ink/50">…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">{d.title}</h1>
      {msg ? <p className="text-sm text-ink/70">{msg}</p> : null}

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-base font-semibold text-ink">{d.settingsTitle}</h2>
        {settings ? (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              {d.windowDays}
              <input
                type="number"
                min={1}
                max={365}
                value={settings.attributionWindowDays}
                onChange={(e) =>
                  setSettings({ ...settings, attributionWindowDays: Number(e.target.value) })
                }
                className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1.5"
              />
            </label>
            <label className="flex items-center gap-2">
              {d.dedupeMinutes}
              <input
                type="number"
                min={1}
                max={1440}
                value={settings.gclidDedupeMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, gclidDedupeMinutes: Number(e.target.value) })
                }
                className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1.5"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.duplicateClicksCountAsConversion}
                onChange={(e) =>
                  setSettings({ ...settings, duplicateClicksCountAsConversion: e.target.checked })
                }
              />
              {d.dupCounts}
            </label>
            <button
              type="button"
              onClick={onSaveSettings}
              disabled={saving}
              className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
            >
              {saving ? d.saving : d.save}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-base font-semibold text-ink">{d.reportTitle}</h2>
        {report ? (
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-lg bg-ink/[0.03] p-3">
              <p className="text-ink/55">{d.attributable}</p>
              <p className="mt-1">
                {d.orders} {report.attributable.orders} · {d.value} {report.attributable.value.toFixed(2)}
              </p>
              <p className="mt-2 text-xs text-ink/60">{d.byOffer}：</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {report.attributable.byOffer.map((b) => (
                  <li key={b.offerId} className="font-mono">
                    {b.offerId === "unknown" ? "unknown" : b.offerId.slice(0, 8)}…：{b.orders} 单 / {b.value.toFixed(2)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-ink/[0.03] p-3">
              <p className="text-ink/55">{d.unattributable}</p>
              <p className="mt-1">
                {d.orders} {report.unattributable.orders} · {d.value} {report.unattributable.value.toFixed(2)}
              </p>
              <p className="mt-2 text-xs text-ink/60">{report.unattributable.note || d.unattributableNote}</p>
            </div>
            <div className="rounded-lg bg-ink/[0.03] p-3">
              <p className="text-ink/55">Total</p>
              <p className="mt-1">
                {d.orders} {report.total.orders} · {d.value} {report.total.value.toFixed(2)}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-base font-semibold text-ink">{d.conflictsTitle}</h2>
        {conflicts.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">{d.empty}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {conflicts.map((c) => {
              const candidates = Array.isArray(c.conflictOfferIds)
                ? (c.conflictOfferIds as string[])
                : [];
              return (
                <li key={c.id} className="rounded-lg border border-ink/10 p-3 text-sm">
                  <p>
                    {d.order}：<span className="font-mono">{c.orderId.slice(0, 8)}…</span> · {d.status}：{c.status}
                    {c.reason ? ` · ${c.reason}` : ""}
                  </p>
                  <p className="mt-1 text-ink/60">
                    {d.candidates}：{candidates.map((o) => o.slice(0, 8)).join("、")}
                  </p>
                  {c.status === "open" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {candidates.map((o) => (
                        <button
                          key={o}
                          type="button"
                          disabled={resolvingId === c.id}
                          onClick={() => onResolve(c, o)}
                          className="rounded-lg border border-signal/40 bg-signal/10 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/20 disabled:opacity-50"
                        >
                          {resolvingId === c.id ? d.resolving : `${d.resolve} → ${o.slice(0, 8)}…`}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-ink/60">
                      {d.resolved} → {c.resolvedOfferId?.slice(0, 8)}…
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
