"use client";

import { useEffect, useState } from "react";
import type { ArbCoachDict } from "@/i18n/dict/arb-coach";
import {
  judgeArbCombo,
  reasonLabelKey,
  verdictLabelKey,
  type ArbComboInput,
} from "@/lib/arb-coach-verdict";

export const LS_COMBOS = "adlinklab-arb-coach-combos";
const COMBOS_EVENT = "arb-coach-combos-changed";

export interface Combo extends ArbComboInput {
  id: string;
  name: string;
  /** 可选备注：如模板应用时写入的关键参数。 */
  note?: string;
  /** 可选：关联的 Offer ID（旧数据无此字段，兼容读取）。 */
  offerId?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function readCombos(): Combo[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(LS_COMBOS);
    const arr = raw ? (JSON.parse(raw) as Combo[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function writeCombos(combos: Combo[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(LS_COMBOS, JSON.stringify(combos));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(COMBOS_EVENT));
}

/** 模板页"应用"用：在看板追加一个组合（名称带模板前缀 + 备注关键参数）。 */
export function addComboToBoard(input: {
  name: string;
  note?: string;
  spend?: number;
  clicks?: number;
  conversions?: number;
  payout?: number;
}): Combo {
  const combo: Combo = {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    note: input.note,
    spend: input.spend ?? 0,
    clicks: input.clicks ?? 0,
    conversions: input.conversions ?? 0,
    payout: input.payout ?? 0,
  };
  writeCombos([...readCombos(), combo]);
  return combo;
}

function fmtMoney(n: number, digits = 4): string {
  return `$${n.toFixed(digits)}`;
}

function fmtPct(ratio: number): string {
  const sign = ratio > 0 ? "+" : "";
  return `${sign}${(ratio * 100).toFixed(1)}%`;
}

function verdictStyle(verdict: "kill" | "scale" | "watch"): string {
  if (verdict === "kill") return "bg-red-100 text-red-800";
  if (verdict === "scale") return "bg-green-100 text-green-800";
  return "bg-amber-100 text-amber-800";
}

const emptyDraft = { name: "", spend: "", clicks: "", conversions: "", payout: "", offerId: "" };

/**
 * 速测看板（独立可复用）：速测页 /coach/board 与总览页 Phase 4 共用同一组件、
 * 同一份 localStorage 数据（adlinklab-arb-coach-combos），跨页通过事件同步。
 */
export function ArbCoachBoard({ dict }: { dict: ArbCoachDict }) {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [ready, setReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  useEffect(() => {
    setCombos(readCombos());
    setReady(true);
    const onChange = () => setCombos(readCombos());
    window.addEventListener(COMBOS_EVENT, onChange);
    return () => window.removeEventListener(COMBOS_EVENT, onChange);
  }, []);

  function persist(next: Combo[]) {
    writeCombos(next);
    setCombos(next);
  }

  function startAdd() {
    setEditingId("new");
    setDraft({ ...emptyDraft, name: dict.board.newComboDefault });
  }

  function startEdit(c: Combo) {
    setEditingId(c.id);
    setDraft({
      name: c.name,
      spend: String(c.spend),
      clicks: String(c.clicks),
      conversions: String(c.conversions),
      payout: String(c.payout),
      offerId: c.offerId ?? "",
    });
  }

  function saveDraft() {
    const toNum = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const base = {
      name: draft.name.trim() || dict.board.newComboDefault,
      spend: toNum(draft.spend),
      clicks: toNum(draft.clicks),
      conversions: toNum(draft.conversions),
      payout: toNum(draft.payout),
      offerId: draft.offerId.trim() || undefined,
    };
    if (editingId === "new") {
      persist([
        ...combos,
        { ...base, id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      ]);
    } else if (editingId) {
      persist(combos.map((c) => (c.id === editingId ? { ...c, ...base } : c)));
    }
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function removeCombo(id: string) {
    if (window.confirm(dict.board.removeConfirm)) {
      persist(combos.filter((c) => c.id !== id));
    }
  }

  if (!ready) return null;
  const b = dict.board;

  return (
    <div>
      <p className="font-medium text-ink">{b.title}</p>
      <p className="mt-1 text-xs text-ink/60">{b.desc}</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
              <th className="py-2 pr-2">{b.name}</th>
              <th className="py-2 pr-2">{b.spend}</th>
              <th className="py-2 pr-2">{b.clicks}</th>
              <th className="py-2 pr-2">{b.conversions}</th>
              <th className="py-2 pr-2">{b.payout}</th>
              <th className="py-2 pr-2">{b.cpc}</th>
              <th className="py-2 pr-2">{b.epc}</th>
              <th className="py-2 pr-2">{b.roi}</th>
              <th className="py-2 pr-2">{b.verdict}</th>
              <th className="py-2 pr-2">{b.actions}</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => {
              const r = judgeArbCombo(c);
              const isEditing = editingId === c.id;
              return (
                <tr key={c.id} className="border-b border-ink/5">
                  <td className="py-2 pr-2 font-medium text-ink">
                    {isEditing ? (
                      <div className="space-y-1">
                        <input
                          className="w-full rounded-md border border-ink/20 px-2 py-1 text-sm"
                          value={draft.name}
                          placeholder={b.namePlaceholder}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                        <input
                          className="w-full rounded-md border border-ink/20 px-2 py-1 text-xs font-normal"
                          value={draft.offerId}
                          placeholder={b.offerId}
                          onChange={(e) => setDraft({ ...draft, offerId: e.target.value })}
                        />
                      </div>
                    ) : (
                      <>
                        {c.name}
                        {c.note && (
                          <span className="block text-xs font-normal text-ink/50">
                            {c.note}
                          </span>
                        )}
                        {c.offerId && (
                          <span className="block text-xs font-normal text-ink/50">
                            Offer: {c.offerId}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  {(["spend", "clicks", "conversions", "payout"] as const).map((f) => (
                    <td key={f} className="py-2 pr-2 text-ink/70">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="w-20 rounded-md border border-ink/20 px-2 py-1 text-sm"
                          value={draft[f]}
                          onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                        />
                      ) : f === "spend" || f === "payout" ? (
                        fmtMoney(c[f], 2)
                      ) : (
                        c[f]
                      )}
                    </td>
                  ))}
                  <td className="py-2 pr-2 text-ink/70">{fmtMoney(r.cpc)}</td>
                  <td className="py-2 pr-2 text-ink/70">{fmtMoney(r.epc)}</td>
                  <td
                    className={`py-2 pr-2 font-medium ${
                      r.roi > 0
                        ? "text-green-700"
                        : r.roi < 0
                          ? "text-red-700"
                          : "text-ink/70"
                    }`}
                  >
                    {fmtPct(r.roi)}
                  </td>
                  <td className="py-2 pr-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${verdictStyle(r.verdict)}`}
                      title={b[reasonLabelKey(r.reason)]}
                    >
                      {b[verdictLabelKey(r.verdict)]}
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveDraft}
                          className="rounded-md bg-signal px-2 py-1 text-xs font-medium text-white hover:opacity-90"
                        >
                          {b.save}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(emptyDraft);
                          }}
                          className="rounded-md border border-ink/20 px-2 py-1 text-xs text-ink/70 hover:bg-ink/5"
                        >
                          {b.cancel}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="text-xs text-signal underline hover:opacity-80"
                        >
                          {b.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCombo(c.id)}
                          className="text-xs text-red-600 underline hover:opacity-80"
                        >
                          {b.remove}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {combos.length === 0 && editingId !== "new" && (
          <p className="py-6 text-center text-sm text-ink/50">{b.empty}</p>
        )}
      </div>

      {editingId === "new" && (
        <div className="mt-3 grid gap-3 rounded-lg border border-ink/10 p-4 md:grid-cols-5">
          <div>
            <label className="text-xs text-ink/60">{b.name}</label>
            <input
              className="mt-1 w-full rounded-md border border-ink/20 px-2 py-1 text-sm"
              placeholder={b.namePlaceholder}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-ink/60">{b.offerId}</label>
            <input
              className="mt-1 w-full rounded-md border border-ink/20 px-2 py-1 text-sm"
              value={draft.offerId}
              onChange={(e) => setDraft({ ...draft, offerId: e.target.value })}
            />
          </div>
          {(
            [
              ["spend", b.spend],
              ["clicks", b.clicks],
              ["conversions", b.conversions],
              ["payout", b.payout],
            ] as const
          ).map(([f, label]) => (
            <div key={f}>
              <label className="text-xs text-ink/60">{label}</label>
              <input
                type="number"
                min="0"
                step="any"
                className="mt-1 w-full rounded-md border border-ink/20 px-2 py-1 text-sm"
                value={draft[f]}
                onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex items-end gap-2 md:col-span-5">
            <button
              type="button"
              onClick={saveDraft}
              className="rounded-md bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {b.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft);
              }}
              className="rounded-md border border-ink/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {b.cancel}
            </button>
          </div>
        </div>
      )}

      {editingId !== "new" && (
        <button
          type="button"
          onClick={startAdd}
          className="mt-3 rounded-md border border-ink/20 px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
        >
          {b.addCombo}
        </button>
      )}
    </div>
  );
}
