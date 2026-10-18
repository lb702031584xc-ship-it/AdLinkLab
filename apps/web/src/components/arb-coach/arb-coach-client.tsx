"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ArbCoachDict } from "@/i18n/dict/arb-coach";
import {
  judgeArbCombo,
  reasonLabelKey,
  verdictLabelKey,
  type ArbComboInput,
} from "@/lib/arb-coach-verdict";

const LS_CHECKS = "adlinklab-arb-coach-checks";
const LS_COMBOS = "adlinklab-arb-coach-combos";

interface Combo extends ArbComboInput {
  id: string;
  name: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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

const emptyDraft = { name: "", spend: "", clicks: "", conversions: "", payout: "" };

export function ArbCoachClient({ dict }: { dict: ArbCoachDict; lang: string }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [combos, setCombos] = useState<Combo[]>([]);
  const [ready, setReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  useEffect(() => {
    setChecks(loadJson(LS_CHECKS, {}));
    setCombos(loadJson<Combo[]>(LS_COMBOS, []));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS_CHECKS, JSON.stringify(checks));
    } catch {
      /* ignore */
    }
  }, [checks, ready]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS_COMBOS, JSON.stringify(combos));
    } catch {
      /* ignore */
    }
  }, [combos, ready]);

  const total = dict.phases.reduce((n, p) => n + p.checks.length, 0);
  const done = Object.values(checks).filter(Boolean).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const toggle = (key: string) =>
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));

  const reset = () => {
    if (window.confirm(dict.resetConfirm)) {
      setChecks({});
      setCombos([]);
    }
  };

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
    };
    if (editingId === "new") {
      setCombos((prev) => [
        ...prev,
        { ...base, id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      ]);
    } else if (editingId) {
      setCombos((prev) => prev.map((c) => (c.id === editingId ? { ...c, ...base } : c)));
    }
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function removeCombo(id: string) {
    if (window.confirm(dict.board.removeConfirm)) {
      setCombos((prev) => prev.filter((c) => c.id !== id));
    }
  }

  if (!ready) return null;
  const b = dict.board;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{dict.pageTitle}</h1>
        <p className="mt-2 text-sm text-ink/60">{dict.pageDesc}</p>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">
            {dict.progress}: {done}/{total} ({pct}%)
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-sm text-ink/50 underline hover:text-ink"
          >
            {dict.reset}
          </button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-signal transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {dict.phases.map((phase, pi) => {
        const dayDone = phase.checks.filter(
          (_, i) => checks[`${phase.id}-c${i}`]
        ).length;
        const phaseComplete =
          phase.checks.length > 0 && dayDone === phase.checks.length;
        return (
          <section
            key={phase.id}
            className={`rounded-xl border bg-white p-5 ${
              phaseComplete ? "border-green-300" : "border-ink/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">
                {dict.phaseLabel.replace("{n}", String(pi + 1))}：{phase.title}
              </h2>
              {phaseComplete && <span className="text-xl">✅</span>}
            </div>
            <p className="mt-1 text-sm text-ink/70">
              <span className="font-medium">{dict.goalLabel}：</span>
              {phase.goal}
            </p>

            {phase.id === "offer" && (
              <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3">
                <p className="text-sm font-semibold text-sky-900">
                  {dict.arbitrageNoteTitle}
                </p>
                <p className="mt-1 text-sm text-sky-800">{dict.arbitrageNoteBody}</p>
              </div>
            )}

            <h3 className="mt-4 text-sm font-semibold text-ink">
              {dict.checklistLabel} ({dayDone}/{phase.checks.length})
            </h3>
            <ul className="mt-2 space-y-2">
              {phase.checks.map((c, i) => {
                const key = `${phase.id}-c${i}`;
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-ink/80">
                      <input
                        type="checkbox"
                        checked={!!checks[key]}
                        onChange={() => toggle(key)}
                        className="mt-1 h-4 w-4 accent-signal"
                      />
                      <span
                        className={checks[key] ? "text-ink/40 line-through" : ""}
                      >
                        {c}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              <span className="font-semibold">{dict.coachTipLabel}</span>
              <p className="mt-1">{phase.coachTip}</p>
            </div>

            {phase.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-xs text-ink/50">{dict.toolsLabel}：</span>
                {phase.links.map((l) =>
                  l.external ? (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink hover:bg-ink/10"
                    >
                      {l.label} ↗
                    </a>
                  ) : (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink hover:bg-ink/10"
                    >
                      {l.label} →
                    </Link>
                  )
                )}
              </div>
            )}

            {phase.id === "dashboard" && (
              <div className="mt-5 border-t border-ink/10 pt-4">
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
                                <input
                                  className="w-full rounded-md border border-ink/20 px-2 py-1 text-sm"
                                  value={draft.name}
                                  placeholder={b.namePlaceholder}
                                  onChange={(e) =>
                                    setDraft({ ...draft, name: e.target.value })
                                  }
                                />
                              ) : (
                                c.name
                              )}
                            </td>
                            {(["spend", "clicks", "conversions", "payout"] as const).map(
                              (f) => (
                                <td key={f} className="py-2 pr-2 text-ink/70">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      className="w-20 rounded-md border border-ink/20 px-2 py-1 text-sm"
                                      value={draft[f]}
                                      onChange={(e) =>
                                        setDraft({ ...draft, [f]: e.target.value })
                                      }
                                    />
                                  ) : (
                                    f === "spend" || f === "payout"
                                      ? fmtMoney(c[f], 2)
                                      : c[f]
                                  )}
                                </td>
                              )
                            )}
                            <td className="py-2 pr-2 text-ink/70">{fmtMoney(r.cpc)}</td>
                            <td className="py-2 pr-2 text-ink/70">{fmtMoney(r.epc)}</td>
                            <td
                              className={`py-2 pr-2 font-medium ${
                                r.roi > 0 ? "text-green-700" : r.roi < 0 ? "text-red-700" : "text-ink/70"
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
            )}
          </section>
        );
      })}

      {pct === 100 && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-5 text-center text-sm font-medium text-green-900">
          {dict.complete}
        </div>
      )}
    </div>
  );
}
