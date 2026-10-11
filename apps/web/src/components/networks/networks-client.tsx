"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as networksZh, en as networksEn } from "@/i18n/dict/networks";
import {
  createNetworkAction,
  listNetworkOffersAction,
  listNetworkPullsAction,
  pullNetworkNowAction,
  updateNetworkAction,
  type NetworkOfferRow,
  type NetworkPullRow,
  type NetworkRow,
} from "@/lib/api/network-actions";

type Dict = typeof networksZh;

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";

function statusColor(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-100 text-emerald-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    case "RUNNING":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-ink/10 text-ink/60";
  }
}

/**
 * 网络类型中文分类标签：联盟网络 / 返利网 / 亚马逊联盟。
 * kind → [分类] 显示名
 */
const KIND_LABELS: Record<string, [string, string]> = {
  impact: ["联盟网络", "Impact"],
  awin: ["联盟网络", "Awin"],
  cj: ["联盟网络", "CJ Affiliate"],
  shareasale: ["联盟网络", "ShareASale"],
  rakuten: ["联盟网络", "Rakuten Advertising"],
  flexoffers: ["联盟网络", "FlexOffers"],
  partnerboost: ["联盟网络", "PartnerBoost"],
};

function kindLabel(kind: string): string {
  const entry = KIND_LABELS[kind.toLowerCase()];
  if (entry) return `【${entry[0]}】${entry[1]}`;
  return kind;
}

export function NetworksClient({
  initial,
  supportedKinds,
}: {
  initial: NetworkRow[];
  supportedKinds: string[];
}) {
  const router = useRouter();
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d: Dict = lang === "en" ? networksEn : networksZh;

  const [networks, setNetworks] = useState(initial);
  useEffect(() => setNetworks(initial), [initial]);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NetworkRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [pullingId, setPullingId] = useState<string | null>(null);

  // dialog form
  const [fName, setFName] = useState("");
  const [fKind, setFKind] = useState(supportedKinds[0] ?? "impact");
  const [fBaseUrl, setFBaseUrl] = useState("");
  const [fApiKey, setFApiKey] = useState("");
  const [fClearCreds, setFClearCreds] = useState(false);

  // expandable detail
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<"offers" | "pulls">("offers");
  const [offers, setOffers] = useState<NetworkOfferRow[]>([]);
  const [pulls, setPulls] = useState<NetworkPullRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  function openCreate() {
    setEditing(null);
    setFName("");
    setFKind(supportedKinds[0] ?? "impact");
    setFBaseUrl("");
    setFApiKey("");
    setFClearCreds(false);
    setDialogOpen(true);
  }

  function openEdit(n: NetworkRow) {
    setEditing(n);
    setFName(n.name);
    setFKind(n.kind);
    setFBaseUrl(n.apiBaseUrl ?? "");
    setFApiKey("");
    setFClearCreds(false);
    setDialogOpen(true);
  }

  async function onSave() {
    setSaving(true);
    setMsg(null);
    try {
      const baseUrl = fBaseUrl.trim() ? fBaseUrl.trim() : undefined;
      const trimmedKey = fApiKey.trim();
      const res = editing
        ? await updateNetworkAction(editing.id, {
            name: fName.trim(),
            kind: fKind,
            // undefined = keep current; null = clear.
            ...(fBaseUrl.trim() === (editing.apiBaseUrl ?? "")
              ? {}
              : { apiBaseUrl: baseUrl ?? null }),
            ...(fClearCreds
              ? { apiKey: null as string | null }
              : trimmedKey
                ? { apiKey: trimmedKey }
                : {}),
          })
        : await createNetworkAction({
            name: fName.trim(),
            kind: fKind,
            ...(baseUrl ? { apiBaseUrl: baseUrl } : {}),
            ...(trimmedKey ? { apiKey: trimmedKey } : {}),
          });
      if (res.ok) {
        setDialogOpen(false);
        setMsg(editing ? d.toast.updated : d.toast.created);
        router.refresh();
      } else {
        setMsg(`${d.toast.failedPrefix}${res.error}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onPull(n: NetworkRow) {
    setPullingId(n.id);
    setMsg(null);
    try {
      const res = await pullNetworkNowAction(n.id);
      if (res.ok) {
        const s = res.data;
        if (s.status === "SUCCESS") {
          setMsg(d.toast.pulled(s));
        } else {
          setMsg(`${d.toast.failedPrefix}${s.error ?? ""}`);
        }
        router.refresh();
        if (expanded === n.id) await loadDetail(n.id, tab);
      } else {
        setMsg(`${d.toast.failedPrefix}${res.error}`);
      }
    } finally {
      setPullingId(null);
    }
  }

  async function loadDetail(id: string, t: "offers" | "pulls") {
    setDetailLoading(true);
    try {
      if (t === "offers") {
        const res = await listNetworkOffersAction(id, 1);
        if (res.ok) setOffers(res.data.offers);
      } else {
        const res = await listNetworkPullsAction(id, 1);
        if (res.ok) setPulls(res.data.pulls);
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function toggleExpand(n: NetworkRow) {
    if (expanded === n.id) {
      setExpanded(null);
      return;
    }
    setExpanded(n.id);
    setTab("offers");
    await loadDetail(n.id, "offers");
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.page.title}
        description={d.page.description}
        actions={
          <button type="button" onClick={openCreate} className={btnPrimary}>
            {d.page.newNetwork}
          </button>
        }
      />

      {msg && (
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink">
          {msg}
        </div>
      )}

      {networks.length === 0 && (
        <p className="rounded-lg border border-dashed border-ink/20 px-4 py-8 text-center text-sm text-ink/60">
          {d.page.noCredentialsHint}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {networks.map((n) => (
          <div
            key={n.id}
            className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">{n.name}</h2>
                <p className="mt-1 text-xs text-ink/60">
                  {d.card.kind}: {kindLabel(n.kind)}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(n.pullStatus)}`}
              >
                {d.status[n.pullStatus as keyof typeof d.status] ?? n.pullStatus}
              </span>
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink/60">{d.card.credentials}</dt>
                <dd
                  className={
                    n.apiConfigured
                      ? "font-medium text-emerald-700"
                      : "font-medium text-amber-700"
                  }
                >
                  {n.apiConfigured ? d.card.configured : d.card.notConfigured}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/60">{d.card.lastPull}</dt>
                <dd className="text-ink">
                  {n.lastPullAt ? formatDateTime(n.lastPullAt) : d.card.never}
                </dd>
              </div>
            </dl>

            {n.pullError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {n.pullError}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={pullingId === n.id || !n.apiConfigured}
                onClick={() => onPull(n)}
                title={!n.apiConfigured ? d.page.noCredentialsHint : undefined}
              >
                {pullingId === n.id ? d.card.pulling : d.card.pullNow}
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={() => toggleExpand(n)}
              >
                {expanded === n.id ? d.card.viewPulls : d.card.viewOffers}
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={() => openEdit(n)}
              >
                {d.card.edit}
              </button>
            </div>

            {expanded === n.id && (
              <div className="mt-4 border-t border-ink/10 pt-4">
                <div className="mb-3 flex gap-2">
                  {(["offers", "pulls"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTab(t);
                        loadDetail(n.id, t);
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        tab === t
                          ? "bg-ink text-white"
                          : "bg-ink/5 text-ink/70 hover:bg-ink/10"
                      }`}
                    >
                      {t === "offers" ? d.offers.title : d.pulls.title}
                    </button>
                  ))}
                </div>
                {detailLoading ? (
                  <p className="text-sm text-ink/60">…</p>
                ) : tab === "offers" ? (
                  offers.length === 0 ? (
                    <p className="text-sm text-ink/60">{d.offers.empty}</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-ink/60">
                          <th className="py-1 pr-2">{d.offers.externalId}</th>
                          <th className="py-1 pr-2">{d.offers.name}</th>
                          <th className="py-1 pr-2">{d.offers.payout}</th>
                          <th className="py-1">{d.offers.lastSeenAt}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offers.slice(0, 10).map((o) => (
                          <tr key={o.id} className="border-t border-ink/5">
                            <td className="py-1.5 pr-2 font-mono text-xs">
                              {o.externalId}
                            </td>
                            <td className="py-1.5 pr-2">{o.name}</td>
                            <td className="py-1.5 pr-2">
                              {o.payout == null
                                ? "—"
                                : `${o.payout} ${o.currency ?? ""}`}
                            </td>
                            <td className="py-1.5 text-xs text-ink/60">
                              {formatDateTime(o.lastSeenAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : pulls.length === 0 ? (
                  <p className="text-sm text-ink/60">{d.pulls.empty}</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-ink/60">
                        <th className="py-1 pr-2">{d.pulls.pulledAt}</th>
                        <th className="py-1 pr-2">{d.pulls.offerCount}</th>
                        <th className="py-1 pr-2">{d.pulls.newCount}</th>
                        <th className="py-1 pr-2">{d.pulls.updatedCount}</th>
                        <th className="py-1">{d.pulls.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pulls.map((p) => (
                        <tr key={p.id} className="border-t border-ink/5">
                          <td className="py-1.5 pr-2 text-xs">
                            {formatDateTime(p.pulledAt)}
                          </td>
                          <td className="py-1.5 pr-2">{p.offerCount}</td>
                          <td className="py-1.5 pr-2">{p.newCount}</td>
                          <td className="py-1.5 pr-2">{p.updatedCount}</td>
                          <td className="py-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs ${statusColor(p.status)}`}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-ink">
              {editing ? d.page.editNetwork : d.page.newNetwork}
            </h2>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm text-ink/70">
                  {d.dialog.name}
                </span>
                <input
                  className={inputCls}
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder={d.dialog.namePlaceholder}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-ink/70">
                  {d.dialog.kind}
                </span>
                <select
                  className={inputCls}
                  value={fKind}
                  onChange={(e) => setFKind(e.target.value)}
                >
                  {supportedKinds.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-ink/70">
                  {d.dialog.apiBaseUrl}
                </span>
                <input
                  className={inputCls}
                  value={fBaseUrl}
                  onChange={(e) => setFBaseUrl(e.target.value)}
                  placeholder={d.dialog.apiBaseUrlPlaceholder}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-ink/70">
                  {d.dialog.apiKey}
                </span>
                <input
                  type="password"
                  className={inputCls}
                  value={fApiKey}
                  onChange={(e) => setFApiKey(e.target.value)}
                  placeholder={d.dialog.apiKeyPlaceholder}
                  autoComplete="new-password"
                />
                <span className="mt-1 block text-xs text-ink/50">
                  {d.dialog.apiKeyHint}
                </span>
              </label>
              {editing?.apiConfigured && (
                <label className="flex items-center gap-2 text-sm text-ink/80">
                  <input
                    type="checkbox"
                    checked={fClearCreds}
                    onChange={(e) => setFClearCreds(e.target.checked)}
                  />
                  {d.dialog.clearCredentials}
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className={btnGhost}
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                {d.dialog.cancel}
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={onSave}
                disabled={saving || !fName.trim()}
              >
                {saving ? d.dialog.saving : d.dialog.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
