"use client";

/**
 * #18 广告客户验证（BV）准备清单：纯静态 checklist，勾选状态只存 localStorage，不调后端。
 * 每年 5 月（getMonth() === 4）顶部显示 BV 集中检测期横幅。
 */
import { useEffect, useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import type { BvChecklistDict } from "@/i18n/dict/bv-checklist";

const LS_KEY = "adlinklab-bv-checklist";

function readChecked(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function BvChecklistClient({ dict }: { dict: BvChecklistDict }) {
  const d = dict;
  const [checked, setChecked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [isMay, setIsMay] = useState(false);

  useEffect(() => {
    setChecked(readChecked());
    // 5 月 = getMonth() 4（0 起）。BV 集中检测期横幅只在这个月显示。
    setIsMay(new Date().getMonth() === 4);
    setReady(true);
  }, []);

  function persist(next: string[]) {
    setChecked(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function toggle(id: string, on: boolean) {
    persist(on ? [...checked, id] : checked.filter((x) => x !== id));
  }

  function reset() {
    if (window.confirm(d.resetConfirm)) persist([]);
  }

  const done = d.items.filter((it) => checked.includes(it.id)).length;

  return (
    <div className="mx-auto max-w-4xl">
      <EntityPageHeader title={d.title} description={d.description} />

      {ready && isMay && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {d.mayBanner}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink">
            {d.progress
              .replace("{done}", String(done))
              .replace("{total}", String(d.items.length))}
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/5"
          >
            {d.reset}
          </button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-signal transition-all"
            style={{
              width: d.items.length
                ? `${Math.round((done / d.items.length) * 100)}%`
                : "0%",
            }}
          />
        </div>

        <ul className="mt-4 space-y-3">
          {d.items.map((it) => {
            const on = checked.includes(it.id);
            return (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-lg border border-ink/10 px-3 py-2.5"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => toggle(it.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-label={it.label}
                />
                <div>
                  <p
                    className={`text-sm font-medium ${on ? "text-ink/50 line-through" : "text-ink"}`}
                  >
                    {it.label}
                  </p>
                  <p className="mt-0.5 text-xs text-ink/55">{it.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>

        {ready && done === d.items.length && d.items.length > 0 && (
          <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {d.complete}
          </p>
        )}
      </div>
    </div>
  );
}
