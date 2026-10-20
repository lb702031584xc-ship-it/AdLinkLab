"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { en as cashbackEn, zh as cashbackZh } from "@/i18n/dict/cashback";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  createRotationGroupAction,
  deleteRotationGroupAction,
  listCashbackOffersAction,
  listRotationGroupsAction,
  rotateGroupNowAction,
  updateRotationGroupAction,
} from "@/lib/api/cashback-actions";
import type { CashbackOffer, RotationGroup } from "@/lib/api/cashback";

function useCashbackDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? cashbackZh : cashbackEn;
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

const STRATEGIES = ["round_robin", "weighted"] as const;

/** Rotation groups: configure members + weights, enable/disable, rotate now. */
export function CashbackRotationsClient() {
  const d = useCashbackDict();
  const [groups, setGroups] = useState<RotationGroup[]>([]);
  const [offers, setOffers] = useState<CashbackOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState<string>("round_robin");
  const [intervalHours, setIntervalHours] = useState<string>("1");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  async function refresh() {
    const [g, o] = await Promise.all([
      listRotationGroupsAction(),
      listCashbackOffersAction(),
    ]);
    if (g.ok) setGroups(g.data.items);
    else setError(g.error);
    if (o.ok) setOffers(o.data.items.filter((x) => x.status === "active"));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      await refresh();
      setLoading(false);
    })();
  }, []);

  function toggleOffer(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 1;
      return next;
    });
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const items = Object.entries(selected).map(([cashbackOfferId, weight]) => ({
      cashbackOfferId,
      weight,
    }));
    if (!name.trim() || items.length === 0) return;
    setCreating(true);
    try {
      const intervalMs =
        intervalHours === "0" ? 0 : Math.max(900000, parseFloat(intervalHours) * 3600000);
      const res = await createRotationGroupAction({
        name: name.trim(),
        strategy,
        rotationIntervalMs: intervalMs,
        items,
      });
      if (res.ok) {
        setNotice(d.rotations.created);
        setName("");
        setSelected({});
        await refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setCreating(false);
    }
  }

  async function onToggleActive(group: RotationGroup) {
    const res = await updateRotationGroupAction(group.id, {
      isActive: !group.isActive,
    });
    if (res.ok) await refresh();
    else setError(res.error);
  }

  async function onDelete(group: RotationGroup) {
    if (!window.confirm(d.rotations.deleteConfirm)) return;
    const res = await deleteRotationGroupAction(group.id);
    if (res.ok) {
      setNotice(d.rotations.deleted);
      await refresh();
    } else setError(res.error);
  }

  async function onRotateNow(group: RotationGroup) {
    setBusyGroup(group.id);
    setNotice(null);
    setError(null);
    const res = await rotateGroupNowAction(group.id);
    setBusyGroup(null);
    if (res.ok) {
      const r = res.data.result;
      if (r.rotated) {
        setNotice(
          d.rotations.rotateDoneCount.replace(
            "{n}",
            String(r.updatedTrackingLinkIds.length)
          )
        );
      } else {
        // 后端 skipped 带英文原因码，转成中文展示，未知码原样透出。
        const reasonMap: Record<string, string> = {
          "no active offers with tracking links": "组内没有带跟踪链接的有效 offer",
          "tracking links missing": "跟踪链接缺失",
          "group not found": "轮换组不存在",
        };
        setNotice(
          r.skipped && reasonMap[r.skipped]
            ? d.rotations.rotateSkippedReason.replace(
                "{reason}",
                reasonMap[r.skipped]
              )
            : r.skipped
              ? d.rotations.rotateSkippedReason.replace("{reason}", r.skipped)
              : d.rotations.rotateSkipped
        );
      }
      await refresh();
    } else {
      setError(res.error);
    }
  }

  const selectedIds = Object.keys(selected);

  return (
    <div className="space-y-8">
      <EntityPageHeader
        title={d.rotations.title}
        description={d.rotations.description}
      />

      {notice && (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-600/30 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Create form */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">{d.rotations.createTitle}</h2>
        <form onSubmit={onCreate} className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm text-ink/70">{d.rotations.name}</span>
              <input
                className={inputClass}
                placeholder={d.rotations.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink/70">{d.rotations.strategy}</span>
              <select
                className={inputClass}
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              >
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {d.rotations.strategies[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink/70">轮换间隔</span>
              <select
                className={inputClass}
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value)}
              >
                <option value="0">手动（不自动轮换）</option>
                <option value="0.5">每 30 分钟</option>
                <option value="1">每 1 小时</option>
                <option value="2">每 2 小时</option>
                <option value="4">每 4 小时</option>
                <option value="12">每 12 小时</option>
                <option value="24">每 24 小时</option>
              </select>
            </label>
          </div>

          <div>
            <span className="mb-1 block text-sm text-ink/70">{d.rotations.offers}</span>
            <p className="mb-2 text-xs text-ink/50">{d.rotations.selectOffersHint}</p>
            {offers.length === 0 ? (
              <p className="text-sm text-ink/50">{d.rotations.noOffers}</p>
            ) : (
              <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10">
                {offers.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={o.id in selected}
                      onChange={() => toggleOffer(o.id)}
                      className="h-4 w-4"
                    />
                    <span className="flex-1 truncate font-mono text-[13px] text-ink" title={o.originalUrl}>
                      {o.originalUrl}
                    </span>
                    {o.id in selected && (
                      <label className="flex items-center gap-1 text-sm text-ink/70">
                        {d.rotations.weight}
                        <input
                          type="number"
                          min={1}
                          className="w-16 rounded border border-ink/15 px-2 py-1 text-sm"
                          value={selected[o.id]}
                          onChange={(e) =>
                            setSelected((prev) => ({
                              ...prev,
                              [o.id]: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                        />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="submit"
            className={btnPrimary}
            disabled={creating || !name.trim() || selectedIds.length === 0}
          >
            {creating ? d.rotations.creating : d.rotations.submit}
          </button>
        </form>
      </section>

      {/* Group list */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <p className="mb-3 text-xs text-ink/50">{d.rotations.scheduleNote}</p>
        {loading ? (
          <p className="text-sm text-ink/60">{d.common.loading}</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-ink/60">{d.rotations.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-ink/60">
                  <th className="py-2 pr-4 font-medium">{d.rotations.columns.name}</th>
                  <th className="py-2 pr-4 font-medium">{d.rotations.columns.strategy}</th>
                  <th className="py-2 pr-4 font-medium">{d.rotations.columns.status}</th>
                  <th className="py-2 pr-4 font-medium">{d.rotations.columns.members}</th>
                  <th className="py-2 font-medium">{d.rotations.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b border-ink/5 align-top last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{g.name}</td>
                    <td className="py-2 pr-4 text-ink/70">
                      {d.rotations.strategies[g.strategy as keyof typeof d.rotations.strategies] ??
                        g.strategy}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          g.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-ink/10 text-ink/60"
                        }`}
                      >
                        {g.isActive ? d.offers.status.active : d.offers.status.paused}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <ul className="space-y-1">
                        {g.items.map((it) => (
                          <li key={it.id} className="truncate font-mono text-[12px] text-ink/70" title={it.cashbackOffer?.originalUrl ?? ""}>
                            {it.cashbackOffer?.cashbackNetwork ?? "?"} ×{it.weight} —{" "}
                            {(it.cashbackOffer?.originalUrl ?? "").slice(0, 48)}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={btnGhost}
                          disabled={busyGroup === g.id}
                          onClick={() => onRotateNow(g)}
                        >
                          {busyGroup === g.id ? d.rotations.rotating : d.rotations.rotateNow}
                        </button>
                        <button className={btnGhost} onClick={() => onToggleActive(g)}>
                          {g.isActive ? d.rotations.disable : d.rotations.enable}
                        </button>
                        <button className={btnGhost} onClick={() => onDelete(g)}>
                          {d.rotations.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
