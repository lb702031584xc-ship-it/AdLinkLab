"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import { EntityPageHeader } from "@/components/entities/ui";
import { DailyAlertsCard } from "@/components/monitoring/daily-alerts-card";
import {
  ackMonitoringAlertAction,
  createDefaultMonitoringRulesAction,
  createMonitoringRuleAction,
  deleteMonitoringRuleAction,
  listMonitoringAlertsAction,
  listMonitoringErrorsAction,
  listMonitoringRulesAction,
  runMonitoringCheckAction,
  updateMonitoringRuleAction,
} from "@/lib/api/p1-actions";
import type {
  MonitoringAlert,
  MonitoringError,
  MonitoringRule,
} from "@/lib/api/p1";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as budgetZh, en as budgetEn } from "@/i18n/dict/budget";
import { listLaunchArchivesAction, type LaunchArchive } from "@/lib/api/launch-archive-actions";
import { paceChecklist, daysActiveSince } from "@/lib/pace-checklist";

function severityBadge(s: MonitoringAlert["severity"]): string {
  if (s === "high") return "bg-red-100 text-red-800";
  if (s === "medium") return "bg-amber-100 text-amber-800";
  return "bg-ink/10 text-ink/60";
}

function statusBadge(s: MonitoringAlert["status"]): string {
  if (s === "open") return "bg-red-100 text-red-800";
  if (s === "acknowledged") return "bg-amber-100 text-amber-800";
  return "bg-green-100 text-green-800";
}

const METRICS = [
  "cvr_drop",
  "refund_spike",
  "geo_anomaly",
  "duplicate_clicks",
  "click_burst",
  "ctr_anomaly",
  "device_anomaly",
] as const;

/** §16 metric labels from the standalone budget dict (not in ai.ts yet). */
function newMetricLabel(m: string, lang: "zh" | "en"): string | undefined {
  const dict = lang === "en" ? budgetEn : budgetZh;
  return (dict.metrics as Record<string, string>)[m];
}

export function MonitoringClient() {
  const t = useDict();
  const d = t.ai.monitoring;
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "en";
  }
  const [rules, setRules] = useState<MonitoringRule[]>([]);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  // P0-8 — 近 24h 服务端错误（error_reports 去重后列表）。
  const [errors, setErrors] = useState<MonitoringError[]>([]);
  /** P1-5：投放档案（用于测试节奏清单；展示建议，不自动执行）。 */
  const [archives, setArchives] = useState<LaunchArchive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // rule form state
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fName, setFName] = useState("");
  const [fMetric, setFMetric] = useState<string>(METRICS[0]);
  const [fThreshold, setFThreshold] = useState("30");
  const [fWindow, setFWindow] = useState("24");
  const [fBaseline, setFBaseline] = useState("168");
  const [fMinClicks, setFMinClicks] = useState("100");
  const [fAutoPause, setFAutoPause] = useState(false);
  /** P1-22：Webhook 通知（默认关）。 */
  const [fWebhook, setFWebhook] = useState(false);
  const [fWebhookUrl, setFWebhookUrl] = useState("");

  // inline threshold edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editThreshold, setEditThreshold] = useState("");
  const [editAutoPause, setEditAutoPause] = useState(false);
  // P1-22：编辑时也能改 Webhook（之前仅创建时可配）。
  const [editWebhook, setEditWebhook] = useState(false);
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [r, a, e, la] = await Promise.all([
          listMonitoringRulesAction(),
          listMonitoringAlertsAction(),
          listMonitoringErrorsAction(),
          listLaunchArchivesAction({}),
        ]);
        if (r.ok) setRules(r.data);
        else setError(r.error);
        if (a.ok) setAlerts(a.data);
        else if (!r.ok) setError(a.error);
        if (e.ok) setErrors(e.data);
        else if (!r.ok && !a.ok) setError(e.error);
        if (la.ok) setArchives(la.data.items);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onEnableDefaults() {
    setEnabling(true);
    setError(null);
    try {
      const res = await createDefaultMonitoringRulesAction();
      if (res.ok) setRules(res.data);
      else setError(res.error);
    } finally {
      setEnabling(false);
    }
  }

  async function onRunNow() {
    setRunning(true);
    setRunMsg(null);
    setError(null);
    try {
      const res = await runMonitoringCheckAction();
      if (res.ok) {
        setRunMsg(d.runResult(res.data.checked, res.data.alertsCreated));
        const a = await listMonitoringAlertsAction();
        if (a.ok) setAlerts(a.data);
      } else setError(res.error);
    } finally {
      setRunning(false);
    }
  }

  async function onToggle(rule: MonitoringRule) {
    const res = await updateMonitoringRuleAction(rule.id, {
      enabled: !rule.enabled,
    });
    if (res.ok)
      setRules((rs) => rs.map((r) => (r.id === rule.id ? res.data : r)));
    else setError(res.error);
  }

  async function onDelete(id: string) {
    if (!window.confirm(d.deleteConfirm)) return;
    const res = await deleteMonitoringRuleAction(id);
    if (res.ok) setRules((rs) => rs.filter((r) => r.id !== id));
    else setError(res.error);
  }

  function startEdit(rule: MonitoringRule) {
    setEditingId(rule.id);
    setEditThreshold(String(rule.thresholdPct));
    setEditAutoPause(rule.autoPause);
    setEditWebhook((rule.channels ?? ["in_app"]).includes("webhook"));
    setEditWebhookUrl(rule.webhookUrl ?? "");
  }

  async function saveEdit(id: string) {
    const th = parseFloat(editThreshold);
    if (!Number.isFinite(th) || th <= 0) return;
    setSaving(true);
    try {
      const res = await updateMonitoringRuleAction(id, {
        thresholdPct: th,
        autoPause: editAutoPause,
        channels: editWebhook ? ["in_app", "webhook"] : ["in_app"],
        webhookUrl:
          editWebhook && editWebhookUrl.trim() ? editWebhookUrl.trim() : null,
      });
      if (res.ok) {
        setRules((rs) => rs.map((r) => (r.id === id ? res.data : r)));
        setEditingId(null);
      } else setError(res.error);
    } finally {
      setSaving(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const thresholdPct = parseFloat(fThreshold);
    if (!fName.trim() || !Number.isFinite(thresholdPct) || thresholdPct <= 0)
      return;
    setCreating(true);
    setError(null);
    try {
      const res = await createMonitoringRuleAction({
        name: fName.trim(),
        metric: fMetric,
        thresholdPct,
        windowHours: parseInt(fWindow, 10) || undefined,
        baselineHours: parseInt(fBaseline, 10) || undefined,
        minClicks: parseInt(fMinClicks, 10) || undefined,
        autoPause: fAutoPause,
        // P1-22：勾选 Webhook 时把渠道设为 in_app + webhook。
        channels: fWebhook ? ["in_app", "webhook"] : ["in_app"],
        webhookUrl: fWebhook && fWebhookUrl.trim() ? fWebhookUrl.trim() : undefined,
      });
      if (res.ok) {
        setRules((rs) => [...rs, res.data]);
        setShowForm(false);
        setFName("");
      } else setError(res.error);
    } finally {
      setCreating(false);
    }
  }

  async function onAck(id: string) {
    const res = await ackMonitoringAlertAction(id);
    if (res.ok)
      setAlerts((as) =>
        as.map((a) => (a.id === id ? { ...a, status: "acknowledged" } : a))
      );
    else setError(res.error);
  }

  function metricLabel(m: string): string {
    return (
      newMetricLabel(m, lang) ?? (d.metrics as Record<string, string>)[m] ?? m
    );
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {/* P2-9：每日预警（分级 P0/P1/P2；仅展示，不自动执行）。 */}
      <div className="mt-6">
        <DailyAlertsCard
          title={d.dailyAlertsTitle}
          emptyText={d.dailyAlertsEmpty}
          detailLinkHref="/daily-alerts"
        />
      </div>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {/* rules */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{d.rulesTitle}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEnableDefaults}
            disabled={enabling}
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
          >
            {enabling ? d.enabling : d.enableDefaults}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {d.newRule}
          </button>
          <button
            type="button"
            onClick={onRunNow}
            disabled={running}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {running ? d.running : d.runNow}
          </button>
        </div>
      </div>

      {runMsg ? (
        <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {runMsg}
        </p>
      ) : null}

      {showForm ? (
        <form
          onSubmit={onCreate}
          className="mt-4 grid gap-4 rounded-xl border border-ink/10 bg-white/70 p-6 md:grid-cols-2"
        >
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="rule-name">
              {d.ruleName}
            </label>
            <input
              id="rule-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder={d.ruleNamePlaceholder}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-metric">
              {d.metricLabel}
            </label>
            <select
              id="rule-metric"
              value={fMetric}
              onChange={(e) => setFMetric(e.target.value)}
              className={inputClass}
            >
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {metricLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-threshold">
              {d.thresholdLabel}
            </label>
            <input
              id="rule-threshold"
              inputMode="decimal"
              value={fThreshold}
              onChange={(e) => setFThreshold(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-window">
              {d.windowLabel}
            </label>
            <input
              id="rule-window"
              inputMode="numeric"
              value={fWindow}
              onChange={(e) => setFWindow(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-baseline">
              {d.baselineLabel}
            </label>
            <input
              id="rule-baseline"
              inputMode="numeric"
              value={fBaseline}
              onChange={(e) => setFBaseline(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="rule-minclicks">
              {d.minClicksLabel}
            </label>
            <input
              id="rule-minclicks"
              inputMode="numeric"
              value={fMinClicks}
              onChange={(e) => setFMinClicks(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="rule-autopause"
              type="checkbox"
              checked={fAutoPause}
              onChange={(e) => setFAutoPause(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="rule-autopause" className="text-sm text-ink/80">
              {d.autoPauseLabel}
            </label>
          </div>
          {/* P1-22：Webhook 通知（邮件延后）。 */}
          <div className="flex items-center gap-2">
            <input
              id="rule-webhook"
              type="checkbox"
              checked={fWebhook}
              onChange={(e) => setFWebhook(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="rule-webhook" className="text-sm text-ink/80">
              {d.webhookLabel}
            </label>
          </div>
          {fWebhook ? (
            <div>
              <label className={labelClass} htmlFor="rule-webhook-url">
                {d.webhookUrlLabel}
              </label>
              <input
                id="rule-webhook-url"
                value={fWebhookUrl}
                onChange={(e) => setFWebhookUrl(e.target.value)}
                placeholder={d.webhookUrlPlaceholder}
                className={inputClass}
              />
            </div>
          ) : null}
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            >
              {creating ? d.creating : d.create}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">{d.columns.name}</th>
              <th className="px-3 py-2">{d.columns.metric}</th>
              <th className="px-3 py-2">{d.columns.threshold}</th>
              <th className="px-3 py-2">{d.columns.window}</th>
              <th className="px-3 py-2">{d.columns.minClicks}</th>
              <th className="px-3 py-2">{d.columns.autoPause}</th>
              <th className="px-3 py-2">{d.columns.notify}</th>
              <th className="px-3 py-2">{d.columns.enabled}</th>
              <th className="px-3 py-2">{d.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-ink/10">
                <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                <td className="px-3 py-2 text-ink/70">{metricLabel(r.metric)}</td>
                <td className="px-3 py-2">
                  {editingId === r.id ? (
                    <input
                      value={editThreshold}
                      onChange={(e) => setEditThreshold(e.target.value)}
                      inputMode="decimal"
                      className="w-20 rounded border border-ink/15 px-2 py-1 text-sm"
                    />
                  ) : (
                    d.thresholdPct(r.thresholdPct)
                  )}
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {d.windowHours(r.windowHours)}
                </td>
                <td className="px-3 py-2 text-ink/70">{r.minClicks}</td>
                <td className="px-3 py-2">
                  {editingId === r.id ? (
                    <input
                      type="checkbox"
                      checked={editAutoPause}
                      onChange={(e) => setEditAutoPause(e.target.checked)}
                      className="h-4 w-4"
                    />
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.autoPause
                          ? "bg-amber-100 text-amber-800"
                          : "bg-ink/10 text-ink/60"
                      }`}
                    >
                      {r.autoPause ? d.on : d.off}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {editingId === r.id ? (
                    <span className="flex flex-col gap-1">
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={editWebhook}
                          onChange={(e) => setEditWebhook(e.target.checked)}
                          className="h-4 w-4"
                        />
                        {d.webhookLabel}
                      </label>
                      {editWebhook ? (
                        <input
                          value={editWebhookUrl}
                          onChange={(e) => setEditWebhookUrl(e.target.value)}
                          placeholder={d.webhookUrlPlaceholder}
                          className="w-44 rounded border border-ink/15 px-2 py-1 text-xs"
                        />
                      ) : null}
                    </span>
                  ) : (r.channels ?? ["in_app"]).includes("webhook") ? (
                    `${d.notifyInApp} + ${d.notifyWebhook}`
                  ) : (
                    d.notifyInApp
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onToggle(r)}
                    aria-label={d.columns.enabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      r.enabled ? "bg-green-500" : "bg-ink/20"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        r.enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {editingId === r.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveEdit(r.id)}
                          disabled={saving}
                          className="text-xs font-medium text-green-700 hover:underline disabled:opacity-50"
                        >
                          {d.save}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs font-medium text-ink/60 hover:underline"
                        >
                          {d.cancel}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        className="text-xs font-medium text-ink/70 hover:underline"
                      >
                        {d.edit}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(r.id)}
                      className="text-xs font-medium text-red-700 hover:underline"
                    >
                      {d.delete}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rules.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={8}>
                  {d.noRules}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* P1-5：测试节奏清单（与 /reports/launch 同一份 pace-checklist 规则；展示建议，不自动执行）。 */}
      <h2 className="mt-8 text-base font-semibold text-ink">{d.paceTitle}</h2>
      <div className="mt-4 space-y-2">
        {archives
          .map((a) => ({
            archive: a,
            suggestions: paceChecklist({
              impressions: a.impressions,
              clicks: a.clicks,
              conversions: a.conversions,
              spend: a.spend,
              revenue: a.revenue,
              daysActive: daysActiveSince(a.launchedAt ?? a.createdAt),
            }),
          }))
          .filter((x) => x.suggestions.length > 0)
          .map(({ archive, suggestions }) => (
            <div key={archive.id} className="rounded-xl border border-ink/10 bg-white/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{archive.offerName}</span>
                <a href={`/reports/launch?offerId=${encodeURIComponent(archive.offerId ?? "")}`} className="text-xs text-signal hover:underline">
                  {d.paceViewArchive}
                </a>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-ink/80">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    {s.text} <span className="text-xs text-ink/50">（{s.source}）</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {!loading &&
        archives.every(
          (a) =>
            paceChecklist({
              impressions: a.impressions,
              clicks: a.clicks,
              conversions: a.conversions,
              spend: a.spend,
              revenue: a.revenue,
              daysActive: daysActiveSince(a.launchedAt ?? a.createdAt),
            }).length === 0
        ) ? (
          <p className="py-4 text-sm text-ink/50">{d.paceEmpty}</p>
        ) : null}
      </div>

      {/* alerts */}
      <h2 className="mt-8 text-base font-semibold text-ink">{d.alertsTitle}</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">{d.alertColumns.time}</th>
              <th className="px-3 py-2">{d.alertColumns.metric}</th>
              <th className="px-3 py-2">{d.alertColumns.severity}</th>
              <th className="px-3 py-2">{d.alertColumns.message}</th>
              <th className="px-3 py-2">{d.alertColumns.link}</th>
              <th className="px-3 py-2">{d.alertColumns.status}</th>
              <th className="px-3 py-2">{d.alertColumns.action}</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-t border-ink/10">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink/60">
                  {formatDateTime(a.createdAt)}
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {metricLabel(a.metric)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(a.severity)}`}
                  >
                    {d.severity[a.severity]}
                  </span>
                </td>
                <td className="max-w-md px-3 py-2 text-sm text-ink/80">
                  {a.message}
                </td>
                <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-ink/60">
                  {a.trackingLinkId ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(a.status)}`}
                  >
                    {d.status[a.status] ?? a.status}
                  </span>
                  {a.data !== null &&
                  typeof a.data === "object" &&
                  (a.data as Record<string, unknown>).autoPaused === true ? (
                    <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {d.autoPaused}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {a.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => onAck(a.id)}
                      className="text-xs font-medium text-ink/70 hover:underline"
                    >
                      {d.ack}
                    </button>
                  ) : (
                    <span className="text-xs text-ink/40">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && alerts.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={7}>
                  {d.noAlerts}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* P0-8 — 近 24h 服务端错误（5xx 去重后） */}
      <h2 className="mt-8 text-base font-semibold text-ink">
        {d.errorsTitle}
      </h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">{d.errorColumns.time}</th>
              <th className="px-3 py-2">{d.errorColumns.level}</th>
              <th className="px-3 py-2">{d.errorColumns.status}</th>
              <th className="px-3 py-2">{d.errorColumns.message}</th>
              <th className="px-3 py-2">{d.errorColumns.path}</th>
              <th className="px-3 py-2">{d.errorColumns.count}</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e) => (
              <tr key={e.id} className="border-t border-ink/10">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink/60">
                  {formatDateTime(e.lastSeenAt)}
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    {e.level}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink/70">{e.statusCode ?? "—"}</td>
                <td className="max-w-md px-3 py-2 text-sm text-ink/80">
                  {e.message}
                </td>
                <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-ink/60">
                  {e.method ? `${e.method} ` : ""}
                  {e.path ?? "—"}
                </td>
                <td className="px-3 py-2 text-ink/70">{e.count}</td>
              </tr>
            ))}
            {!loading && errors.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={6}>
                  {d.noErrors}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
