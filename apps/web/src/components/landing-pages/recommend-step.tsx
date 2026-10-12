"use client";

import { useState } from "react";
import {
  type LanderPipelineDict,
  type LanderPipelineVertical,
} from "@/i18n/dict/lander-pipeline";

const VERTICALS: LanderPipelineVertical[] = [
  "saas",
  "ecommerce",
  "finance",
  "health",
  "education",
  "gaming",
];

/**
 * Step ② — vertical-based structure recommendations.
 * Pure presentational: picks a vertical → shows recommended template
 * categories, why it works, and a high-converting structure checklist.
 */
export function RecommendStep({ dict }: { dict: LanderPipelineDict }) {
  const [vertical, setVertical] = useState<LanderPipelineVertical>("saas");
  const info = dict.recommend.verticals[vertical];

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink/65">{dict.recommend.intro}</p>

      <div>
        <p className="mb-2 text-sm font-medium text-ink/80">
          {dict.recommend.pickVertical}
        </p>
        <div className="flex flex-wrap gap-2">
          {VERTICALS.map((v) => {
            const active = v === vertical;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setVertical(v)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-signal bg-signal text-white"
                    : "border-ink/15 bg-white/70 text-ink/75 hover:bg-white"
                }`}
              >
                {dict.recommend.verticals[v].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">{info.label}</h3>
          <span className="text-xs text-ink/50">{info.blurb}</span>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink/80">
            {dict.recommend.recommendedCategories}
          </p>
          <p className="mt-1 inline-block rounded-lg bg-signal/10 px-3 py-1.5 text-sm font-semibold text-signal">
            {info.categories}
          </p>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink/80">
            {dict.recommend.whyItWorks}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink/70">{info.why}</p>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink/80">
            {dict.recommend.structureTitle}
          </p>
          <ul className="mt-2 space-y-1.5">
            {info.structure.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-ink/75"
              >
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal/10 text-xs font-semibold text-signal">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <a
        href="/landing-pages/templates"
        className="inline-block rounded-lg border border-ink/15 bg-white/70 px-4 py-2 text-sm font-medium text-ink hover:bg-white"
      >
        {dict.recommend.openTemplateLibrary}
      </a>
    </div>
  );
}
