"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { en as rcEn, zh as rcZh } from "@/i18n/dict/cashback-rate-compare";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  compareRateGroupNowAction,
  createRateCompareGroupAction,
  getRateGroupSnapshotsAction,
  listRateCompareGroupsAction,
  type CompareGroup,
  type GroupCheckResult,
  type RateSnapshot,
} from "@/lib/api/cashback-rate-compare-actions";

function useRateCompareDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? rcZh : rcEn;
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";
const badgePrimary =
  "ml-2 inline-block rounded-full bg-signal/15 px-2 py-0.5 text-xs font-medium text-signal";
const badgeBest =
  "ml-2 inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700";

interface PortalDraft {
  name: string;
  url: string;
}

/** Feature 5 — 返利比价：分组列表 + 新建 + 点进分组看横向对比表 + 立即比价。 */
export function RateCompareClient() {
  const d = useRateCompareDict();
  const [groups, setGroups] = useState<CompareGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listRateCompareGroupsAction();
    if (res.ok) {
      setGroups(res.data.items);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.rateCompare.title}
        description={d.rateCompare.description}
        actions={
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setShowForm((v) => !v)}
          >
            {d.rateCompare.newGroup}
          </button>
        }
      />
      {showForm && (
        <CreateGroupForm
          d={d}
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-ink/60">{d.rateCompare.loading}</p>
      ) : selectedId ? (
        <GroupDetail
          d={d}
          group={groups.find((g) => g.id === selectedId) ?? null}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <GroupList d={d} groups={groups} onSelect={setSelectedId} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group list
// ---------------------------------------------------------------------------

function GroupList({
  d,
  groups,
  onSelect,
}: {
  d: typeof rcZh;
  groups: CompareGroup[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white">
      <div className="border-b border-ink/10 px-5 py-3 text-sm font-medium">
        {d.rateCompare.groupsTitle} · {d.rateCompare.groupCount(groups.length)}
      </div>
      {groups.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink/50">
          {d.rateCompare.noGroups}
        </p>
      ) : (
        <ul className="divide-y divide-ink/10">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-ink/[0.03]"
                onClick={() => onSelect(g.id)}
              >
                <span>
                  <span className="text-sm font-medium text-ink">{g.name}</span>
                  <span className="ml-3 font-mono text-xs text-ink/50">
                    {g.merchantDomain}
                  </span>
                </span>
                <span className="text-xs text-ink/50">
                  {d.rateCompare.portalsCount(g.portals.length)} ·{" "}
                  {g.portals[0]?.name ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function CreateGroupForm({
  d,
  onCreated,
}: {
  d: typeof rcZh;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [merchantDomain, setMerchantDomain] = useState("");
  const [portals, setPortals] = useState<PortalDraft[]>([
    { name: "Rakuten", url: "" },
    { name: "55haitao", url: "" },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPortal = (i: number, patch: Partial<PortalDraft>) =>
    setPortals((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async () => {
    setCreating(true);
    setError(null);
    const res = await createRateCompareGroupAction({
      name: name.trim(),
      merchantDomain: merchantDomain.trim(),
      portals: portals.map((p) => ({ name: p.name.trim(), url: p.url.trim() })),
    });
    setCreating(false);
    if (res.ok) {
      onCreated();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="rounded-xl border border-ink/10 bg-white px-5 py-4">
      <h3 className="mb-3 text-sm font-medium">{d.rateCompare.newGroup}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-ink/60">{d.rateCompare.name}</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={d.rateCompare.namePlaceholder}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink/60">
            {d.rateCompare.merchantDomain}
          </span>
          <input
            className={inputClass}
            value={merchantDomain}
            onChange={(e) => setMerchantDomain(e.target.value)}
            placeholder={d.rateCompare.merchantDomainPlaceholder}
          />
        </label>
      </div>
      <p className="mt-4 mb-2 text-sm text-ink/60">{d.rateCompare.portals}</p>
      <div className="space-y-2">
        {portals.map((p, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={`${inputClass} w-40`}
              value={p.name}
              onChange={(e) => setPortal(i, { name: e.target.value })}
              placeholder={d.rateCompare.portalName}
            />
            <input
              className={inputClass}
              value={p.url}
              onChange={(e) => setPortal(i, { url: e.target.value })}
              placeholder={d.rateCompare.portalUrl}
            />
            {i === 0 && (
              <span className={badgePrimary}>{d.rateCompare.primaryBadge}</span>
            )}
            {portals.length > 1 && (
              <button
                type="button"
                className={btnGhost}
                onClick={() =>
                  setPortals((prev) => prev.filter((_, j) => j !== i))
                }
              >
                {d.rateCompare.remove}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className={btnGhost}
          onClick={() => setPortals((prev) => [...prev, { name: "", url: "" }])}
        >
          {d.rateCompare.addPortal}
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={creating}
          onClick={() => void submit()}
        >
          {creating ? d.rateCompare.creating : d.rateCompare.create}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group detail: comparison table + history + compare-now
// ---------------------------------------------------------------------------

function GroupDetail({
  d,
  group,
  onBack,
}: {
  d: typeof rcZh;
  group: CompareGroup | null;
  onBack: () => void;
}) {
  const [latest, setLatest] = useState<RateSnapshot[]>([]);
  const [snapshots, setSnapshots] = useState<RateSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<GroupCheckResult | null>(null);

  const load = useCallback(async () => {
    if (!group) return;
    setLoading(true);
    setError(null);
    const res = await getRateGroupSnapshotsAction(group.id);
    setLoading(false);
    if (res.ok) {
      setLatest(res.data.latest);
      setSnapshots(res.data.snapshots);
    } else {
      setError(res.error);
    }
  }, [group]);

  useEffect(() => {
    void load();
  }, [load]);

  const compareNow = async () => {
    if (!group) return;
    setComparing(true);
    setError(null);
    const res = await compareRateGroupNowAction(group.id);
    setComparing(false);
    if (res.ok) {
      setLastCheck(res.data.result);
      await load();
    } else {
      setError(res.error);
    }
  };

  if (!group) return null;

  const bestPortal = latest.reduce<RateSnapshot | null>(
    (acc, s) =>
      s.rateValue != null && (acc == null || (acc.rateValue ?? -1) < s.rateValue)
        ? s
        : acc,
    null
  );
  const primaryName = group.portals[0]?.name;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <button type="button" className={btnGhost} onClick={onBack}>
          {d.rateCompare.back}
        </button>
        <div>
          <h3 className="text-base font-medium text-ink">{group.name}</h3>
          <p className="font-mono text-xs text-ink/50">{group.merchantDomain}</p>
        </div>
        <div className="ml-auto">
          <button
            type="button"
            className={btnPrimary}
            disabled={comparing}
            onClick={() => void compareNow()}
          >
            {comparing ? d.rateCompare.comparing : d.rateCompare.compareNow}
          </button>
        </div>
      </div>
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-ink/60">{d.rateCompare.loading}</p>
      ) : (
        <>
          <div className="rounded-xl border border-ink/10 bg-white">
            <div className="border-b border-ink/10 px-5 py-3 text-sm font-medium">
              {d.rateCompare.latestTitle}
            </div>
            {latest.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink/50">
                {d.rateCompare.noSnapshots}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-ink/60">
                    <th className="px-5 py-2 font-normal">
                      {d.rateCompare.columns.portal}
                    </th>
                    <th className="px-5 py-2 font-normal">
                      {d.rateCompare.columns.rate}
                    </th>
                    <th className="px-5 py-2 font-normal">
                      {d.rateCompare.columns.checkedAt}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((s) => (
                    <tr key={s.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-5 py-2.5 font-medium text-ink">
                        {s.portal}
                        {s.portal === primaryName && (
                          <span className={badgePrimary}>
                            {d.rateCompare.primaryBadge}
                          </span>
                        )}
                        {bestPortal && s.portal === bestPortal.portal && (
                          <span className={badgeBest}>
                            {d.rateCompare.bestBadge}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-[13px]">
                        {s.rate ?? (
                          <span className="text-ink/40">
                            {d.rateCompare.noRate}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-ink/50">
                        {new Date(s.checkedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-5 py-3 text-xs text-ink/45">
              {d.rateCompare.alertHint}
            </p>
          </div>
          {snapshots.length > 0 && (
            <div className="rounded-xl border border-ink/10 bg-white">
              <div className="border-b border-ink/10 px-5 py-3 text-sm font-medium">
                {d.rateCompare.historyTitle}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-ink/60">
                    <th className="px-5 py-2 font-normal">
                      {d.rateCompare.columns.portal}
                    </th>
                    <th className="px-5 py-2 font-normal">
                      {d.rateCompare.columns.rate}
                    </th>
                    <th className="px-5 py-2 font-normal">
                      {d.rateCompare.columns.checkedAt}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.slice(0, 30).map((s) => (
                    <tr key={s.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-5 py-2 text-ink">{s.portal}</td>
                      <td className="px-5 py-2 font-mono text-[13px]">
                        {s.rate ?? (
                          <span className="text-ink/40">
                            {d.rateCompare.noRate}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2 text-xs text-ink/50">
                        {new Date(s.checkedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lastCheck && (
            <p className="text-xs text-ink/45">
              {d.rateCompare.compareDone}：
              {d.rateCompare.compareSummary(
                lastCheck.results.length,
                lastCheck.results.filter((r) => r.ok).length,
                lastCheck.bestPortal,
                lastCheck.bestRate
              )}{" "}
              · {new Date(lastCheck.checkedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
