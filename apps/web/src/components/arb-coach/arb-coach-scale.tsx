"use client";

import { useEffect, useState } from "react";
import type { ArbCoachDict } from "@/i18n/dict/arb-coach";

const LS_SCALE = "adlinklab-arb-coach-scale-log";

interface ScaleEntry {
  id: string;
  date: string;
  combo: string;
  action: string;
  params: string;
  note: string;
}

function loadEntries(): ScaleEntry[] {
  try {
    const raw = localStorage.getItem(LS_SCALE);
    const arr = raw ? (JSON.parse(raw) as ScaleEntry[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyDraft = { date: today(), combo: "", action: "", params: "", note: "" };

/**
 * 放量记录：每次放量动作记一笔（localStorage），附放量铁律。
 */
export function ArbCoachScale({ dict }: { dict: ArbCoachDict }) {
  const [entries, setEntries] = useState<ScaleEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const s = dict.scale;

  useEffect(() => {
    setEntries(loadEntries());
    setDraft((d) => ({ ...d, action: s.actionOptions[0] ?? "" }));
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS_SCALE, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }, [entries, ready]);

  function startAdd() {
    setEditingId("new");
    setDraft({ ...emptyDraft, date: today(), action: s.actionOptions[0] ?? "" });
  }

  function startEdit(e: ScaleEntry) {
    setEditingId(e.id);
    setDraft({ date: e.date, combo: e.combo, action: e.action, params: e.params, note: e.note });
  }

  function saveDraft() {
    const base = {
      date: draft.date || today(),
      combo: draft.combo.trim(),
      action: draft.action,
      params: draft.params.trim(),
      note: draft.note.trim(),
    };
    if (editingId === "new") {
      setEntries((prev) => [
        ...prev,
        { ...base, id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      ]);
    } else if (editingId) {
      setEntries((prev) => prev.map((e) => (e.id === editingId ? { ...e, ...base } : e)));
    }
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function removeEntry(id: string) {
    if (window.confirm(s.removeConfirm)) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
    }
  }

  if (!ready) return null;

  const inputCls = "w-full rounded-md border border-ink/20 px-2 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{s.pageTitle}</h1>
        <p className="mt-2 text-sm text-ink/60">{s.pageDesc}</p>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">{s.rulesTitle}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
          {s.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
                <th className="py-2 pr-2">{s.date}</th>
                <th className="py-2 pr-2">{s.combo}</th>
                <th className="py-2 pr-2">{s.action}</th>
                <th className="py-2 pr-2">{s.params}</th>
                <th className="py-2 pr-2">{s.note}</th>
                <th className="py-2 pr-2"> </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-ink/5">
                  <td className="py-2 pr-2 text-ink/70">{e.date}</td>
                  <td className="py-2 pr-2 font-medium text-ink">{e.combo || "—"}</td>
                  <td className="py-2 pr-2">
                    <span className="inline-block rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink">
                      {e.action}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-ink/70">{e.params || "—"}</td>
                  <td className="py-2 pr-2 text-ink/70">{e.note || "—"}</td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(e)}
                        className="text-xs text-signal underline hover:opacity-80"
                      >
                        {s.edit}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(e.id)}
                        className="text-xs text-red-600 underline hover:opacity-80"
                      >
                        {s.remove}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && (
            <p className="py-6 text-center text-sm text-ink/50">{s.empty}</p>
          )}
        </div>

        {editingId && (
          <div className="mt-4 grid gap-3 rounded-lg border border-ink/10 p-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-ink/60">{s.date}</label>
              <input
                type="date"
                className={`${inputCls} mt-1`}
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-ink/60">{s.combo}</label>
              <input
                className={`${inputCls} mt-1`}
                value={draft.combo}
                onChange={(e) => setDraft({ ...draft, combo: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-ink/60">{s.action}</label>
              <select
                className={`${inputCls} mt-1`}
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              >
                {s.actionOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink/60">{s.params}</label>
              <input
                className={`${inputCls} mt-1`}
                placeholder={s.paramsPlaceholder}
                value={draft.params}
                onChange={(e) => setDraft({ ...draft, params: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-ink/60">{s.note}</label>
              <input
                className={`${inputCls} mt-1`}
                placeholder={s.notePlaceholder}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <button
                type="button"
                onClick={saveDraft}
                className="rounded-md bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                {s.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft);
                }}
                className="rounded-md border border-ink/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                {s.cancel}
              </button>
            </div>
          </div>
        )}

        {!editingId && (
          <button
            type="button"
            onClick={startAdd}
            className="mt-4 rounded-md border border-ink/20 px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {s.add}
          </button>
        )}
      </div>
    </div>
  );
}
