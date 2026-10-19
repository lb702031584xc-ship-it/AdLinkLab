"use client";

import { useState } from "react";
import Link from "next/link";
import type { ArbCoachDict, ArbCoachTemplate } from "@/i18n/dict/arb-coach";
import { addComboToBoard } from "@/components/arb-coach/arb-coach-board";

/**
 * 组合模板库：3 个档位的完整开测模板（课程原打法参数）。
 * "应用此模板" → 在速测看板新建组合（名称带模板前缀 + 备注关键参数）+ toast 跳转。
 */
export function ArbCoachTemplates({ dict }: { dict: ArbCoachDict }) {
  const [openId, setOpenId] = useState<string | null>("beginner");
  const [toast, setToast] = useState(false);
  const t = dict.templates;

  function applyTemplate(tpl: ArbCoachTemplate) {
    addComboToBoard({
      name: `[${tpl.badge}] ${dict.board.newComboDefault}`,
      note: tpl.note,
    });
    setToast(true);
    window.setTimeout(() => setToast(false), 6000);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t.pageTitle}</h1>
        <p className="mt-2 text-sm text-ink/60">{t.pageDesc}</p>
      </div>

      {t.items.map((tpl) => {
        const open = openId === tpl.id;
        return (
          <section
            key={tpl.id}
            className="rounded-xl border border-ink/10 bg-white p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="inline-block rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-semibold text-ink">
                  {tpl.badge}
                </span>
                <h2 className="mt-2 text-lg font-bold text-ink">{tpl.title}</h2>
                <p className="mt-1 text-sm text-ink/60">
                  <span className="font-medium text-ink/80">{t.budget}：</span>
                  {tpl.budget}
                </p>
              </div>
              <button
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                {t.apply}
              </button>
            </div>
            <p className="mt-2 text-sm text-ink/70">{tpl.desc}</p>

            <button
              type="button"
              onClick={() => setOpenId(open ? null : tpl.id)}
              className="mt-3 text-sm font-medium text-signal underline hover:opacity-80"
            >
              {open ? "▲" : "▼"} {t.paramsTitle}
            </button>
            {open && (
              <div className="mt-3 space-y-3">
                {tpl.stages.map((s) => (
                  <div
                    key={s.title}
                    className="rounded-lg bg-ink/[0.03] p-3"
                  >
                    <p className="text-sm font-semibold text-ink">{s.title}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/75">
                      {s.params.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">
            <span>✅ {t.appliedToast}</span>
            <Link
              href="/coach/board"
              className="font-semibold text-amber-300 underline hover:text-amber-200"
            >
              {t.applied}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
