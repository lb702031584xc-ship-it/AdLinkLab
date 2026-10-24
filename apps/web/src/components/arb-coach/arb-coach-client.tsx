"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ArbCoachDict } from "@/i18n/dict/arb-coach";
import { ArbCoachBoard, writeCombos } from "@/components/arb-coach/arb-coach-board";

const LS_CHECKS = "adlinklab-arb-coach-checks";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function ArbCoachClient({ dict }: { dict: ArbCoachDict; lang: string }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChecks(loadJson(LS_CHECKS, {}));
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

  const total = dict.phases.reduce((n, p) => n + p.checks.length, 0);
  const done = Object.values(checks).filter(Boolean).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const toggle = (key: string) =>
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));

  const reset = () => {
    if (window.confirm(dict.resetConfirm)) {
      setChecks({});
      // 看板组件通过事件同步，会自动清空。
      writeCombos([]);
    }
  };

  if (!ready) return null;

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
                <ArbCoachBoard dict={dict} />
              </div>
            )}
          </section>
        );
      })}

      {/* 垂直打法卡：CC submit / 抽奖 / Dating / Nutra / 电商 CPS */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-lg font-bold text-ink">{dict.verticals.title}</h2>
        <p className="mt-1 text-sm text-ink/70">{dict.verticals.desc}</p>

        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-900">
            {dict.verticals.redLinesTitle}
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-800">
            {dict.verticals.redLines.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        {dict.verticals.items.map((v) => (
          <article
            key={v.id}
            className="mt-4 rounded-lg border border-ink/10 p-4"
          >
            <h3 className="text-base font-bold text-ink">
              {v.badge} {v.name}
            </h3>
            <p className="mt-2 text-sm text-ink/80">
              <span className="font-medium">{dict.verticals.howLabel}：</span>
              {v.howItWorks}
            </p>
            <p className="mt-1 text-sm text-ink/80">
              <span className="font-medium">{dict.verticals.payoutLabel}：</span>
              {v.payoutShape}
            </p>
            <p className="mt-1 text-sm text-ink/80">
              <span className="font-medium">{dict.verticals.trafficLabel}：</span>
              {v.trafficFit}
            </p>
            <h4 className="mt-3 text-sm font-semibold text-ink">
              {dict.verticals.gatesLabel}
            </h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/80">
              {v.termsGates.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <h4 className="mt-3 text-sm font-semibold text-ink">
              {dict.verticals.killLabel}
            </h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/80">
              {v.killSignals.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              <span className="font-semibold">{dict.verticals.tipLabel}</span>
              <p className="mt-1">{v.coachTip}</p>
            </div>
          </article>
        ))}
      </section>

      {pct === 100 && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-5 text-center text-sm font-medium text-green-900">
          {dict.complete}
        </div>
      )}
    </div>
  );
}
