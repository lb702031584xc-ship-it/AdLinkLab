"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AffiliateSopDict } from "@/i18n/dict/affiliate-sop";

const LS_KEY = "adlinklab-affiliate-sop-checks";

function loadChecks(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** 联盟新手 7 天 SOP：每天目标 + checklist + 盈利建议 + 工具链接，进度存 localStorage */
export function AffiliateSopClient({
  dict,
}: {
  dict: AffiliateSopDict;
  lang: string;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChecks(loadChecks());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(checks));
      } catch {
        /* ignore */
      }
    }
  }, [checks, ready]);

  const total = dict.days.reduce((n, d) => n + d.checks.length, 0);
  const done = Object.values(checks).filter(Boolean).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const toggle = (key: string) =>
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));

  const reset = () => {
    if (window.confirm(dict.resetConfirm)) setChecks({});
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

      {dict.days.map((day) => {
        const dayDone = day.checks.filter(
          (_, i) => checks[`d${day.day}-c${i}`]
        ).length;
        const dayComplete = dayDone === day.checks.length;
        return (
          <section
            key={day.day}
            className={`rounded-xl border bg-white p-5 ${
              dayComplete ? "border-green-300" : "border-ink/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">
                {dict.dayLabel(day.day)}：{day.title}
              </h2>
              {dayComplete && <span className="text-xl">✅</span>}
            </div>
            <p className="mt-1 text-sm text-ink/70">
              <span className="font-medium">{dict.goalLabel}：</span>
              {day.goal}
            </p>

            <h3 className="mt-4 text-sm font-semibold text-ink">
              {dict.checklistLabel} ({dayDone}/{day.checks.length})
            </h3>
            <ul className="mt-2 space-y-2">
              {day.checks.map((c, i) => {
                const key = `d${day.day}-c${i}`;
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

            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <span className="font-semibold">{dict.profitTipLabel}</span>
              <p className="mt-1">{day.profitTip}</p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-xs text-ink/50">{dict.toolsLabel}：</span>
              {day.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink hover:bg-ink/10"
                >
                  {l.label} →
                </Link>
              ))}
            </div>
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
