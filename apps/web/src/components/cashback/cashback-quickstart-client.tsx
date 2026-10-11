"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CashbackQuickstartDict } from "@/i18n/dict/cashback-quickstart";

const LS_CHECKS = "adlinklab-cashback-quickstart-checks";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function StepCard({
  step,
  d,
  open,
  onToggle,
  checks,
  onCheck,
}: {
  step: CashbackQuickstartDict["steps"][number];
  d: CashbackQuickstartDict;
  open: boolean;
  onToggle: () => void;
  checks: Record<string, boolean>;
  onCheck: (key: string, v: boolean) => void;
}) {
  const done = step.checklist.filter((_, i) => checks[`${step.id}:${i}`]).length;
  const total = step.checklist.length;
  const complete = done === total;
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">
          {step.dayLabel}
        </span>
        <span className="flex-1">
          <span className="block text-base font-semibold text-ink">{step.title}</span>
          <span className="text-xs text-ink/60">
            {done}/{total} · {complete ? d.stepDone : d.stepTodo}
          </span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {complete ? d.stepDone : d.stepTodo}
        </span>
        <span className="text-sm text-ink/50">{open ? d.collapse : d.expand} ▾</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {step.intro.map((p, i) => (
            <p key={i} className="text-sm leading-6 text-ink/80">
              {p}
            </p>
          ))}
          <ul className="space-y-2">
            {step.checklist.map((item, i) => {
              const key = `${step.id}:${i}`;
              return (
                <li key={i}>
                  <div className="flex items-start gap-2.5 rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink/85 transition hover:bg-ink/[0.03]">
                    <label className="mt-0.5 flex cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!checks[key]}
                        onChange={(e) => onCheck(key, e.target.checked)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    <span className={checks[key] ? "text-ink/50 line-through" : ""}>{item}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {step.tools.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {step.tools.map((t) =>
                t.external ? (
                  <a
                    key={t.href}
                    href={t.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
                  >
                    {t.label} ↗
                  </a>
                ) : (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    {t.label}
                  </Link>
                )
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function CashbackQuickstartClient({
  dict: d,
  lang: _lang,
}: {
  dict: CashbackQuickstartDict;
  lang: "zh" | "en";
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ money: true });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChecks(loadJson(LS_CHECKS, {}));
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(LS_CHECKS, JSON.stringify(checks));
  }, [checks, ready]);

  const onCheck = (key: string, v: boolean) => setChecks((prev) => ({ ...prev, [key]: v }));
  const toggleStep = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  const total = useMemo(
    () => d.steps.reduce((n, s) => n + s.checklist.length, 0),
    [d]
  );
  const done = useMemo(
    () =>
      d.steps.reduce(
        (n, s) => n + s.checklist.filter((_, i) => checks[`${s.id}:${i}`]).length,
        0
      ),
    [d, checks]
  );
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{d.title}</h1>
        <p className="mt-1 text-sm leading-6 text-ink/65">{d.description}</p>
      </div>

      <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
        <p className="text-sm font-semibold text-amber-900">💰 {d.profitTitle}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-900/90">
          {d.profitTips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">{d.progressLabel}</span>
          <span className="text-ink/60">
            {d.progressText.replace("{done}", String(done)).replace("{total}", String(total))} ·{" "}
            {pct}%
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </section>

      {d.steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          d={d}
          open={!!open[step.id]}
          onToggle={() => toggleStep(step.id)}
          checks={checks}
          onCheck={onCheck}
        />
      ))}
    </div>
  );
}
