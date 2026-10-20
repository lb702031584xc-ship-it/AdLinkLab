"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  landerPipelineDict,
  type LanderPipelineLang,
} from "@/i18n/dict/lander-pipeline";
import { zh as experimentZh, en as experimentEn } from "@/i18n/dict/experiment";
import { LanderClient } from "@/components/ai/lander-client";
import { RewriteClient } from "@/components/ai/rewrite-client";
import { ExperimentsClient } from "@/components/experiments/experiments-client";
import { OfferPipelineNav } from "@/components/ai/offer-pipeline-nav";
import { RecommendStep } from "./recommend-step";

export type PipelineStep =
  | "scrape"
  | "recommend"
  | "generate"
  | "abtest"
  | "pages";

const FLOW_STEPS: PipelineStep[] = ["scrape", "recommend", "generate", "abtest"];

const DONE_KEY = "adlinklab-lp-pipeline-done";

function loadDone(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function stepHref(step: PipelineStep, offerId?: string | null): string {
  const base = `/landing-pages?step=${step}`;
  return offerId ? `${base}&offerId=${encodeURIComponent(offerId)}` : base;
}

/**
 * Landing-page 4-step pipeline shell (Batch 5).
 *
 * ①抓取 → ②推荐 → ③AI制作 → ④A/B测试 (+ 我的落地页 tab).
 * Each step embeds the existing workbench component (imported, not copied):
 * scrape → LanderClient, recommend → RecommendStep (new), generate →
 * RewriteClient, abtest → ExperimentsClient. Completion is tracked per step
 * in localStorage; steps are deep-linkable via ?step= so users can walk in
 * order or jump to any single step.
 */
export function LanderPipelineClient({
  lang,
  step,
  offerId,
  pagesContent,
}: {
  lang: LanderPipelineLang;
  step: PipelineStep;
  offerId?: string | null;
  pagesContent: ReactNode;
}) {
  const t = landerPipelineDict[lang];
  const expDict = lang === "en" ? experimentEn : experimentZh;
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDone(loadDone());
  }, []);

  function toggleDone(s: PipelineStep) {
    setDone((prev) => {
      const next = { ...prev, [s]: !prev[s] };
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory state */
      }
      return next;
    });
  }

  const stepIndex = FLOW_STEPS.indexOf(step);
  const prevStep: PipelineStep | null =
    stepIndex > 0 ? FLOW_STEPS[stepIndex - 1] : null;
  const nextStep: PipelineStep | null =
    stepIndex >= 0 && stepIndex < FLOW_STEPS.length - 1
      ? FLOW_STEPS[stepIndex + 1]
      : null;
  const isDone = !!done[step];

  return (
    <div>
      <OfferPipelineNav current="lander" offerId={offerId ?? null} />
      {/* Step bar */}
      <nav
        aria-label="pipeline steps"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        {FLOW_STEPS.map((s, i) => {
          const active = s === step;
          const sDone = !!done[s];
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 ? (
                <span aria-hidden className="text-ink/25">
                  →
                </span>
              ) : null}
              <Link
                href={stepHref(s, offerId)}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-signal bg-signal text-white"
                    : "border-ink/15 bg-white/70 text-ink/75 hover:bg-white"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    active
                      ? "bg-white/25 text-white"
                      : sDone
                        ? "bg-green-500 text-white"
                        : "bg-ink/10 text-ink/60"
                  }`}
                >
                  {sDone && !active ? "✓" : i + 1}
                </span>
                {t.steps[s]}
              </Link>
            </div>
          );
        })}
        <span aria-hidden className="mx-1 text-ink/20">
          |
        </span>
        <Link
          href={stepHref("pages", offerId)}
          aria-current={step === "pages" ? "step" : undefined}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
            step === "pages"
              ? "border-signal bg-signal text-white"
              : "border-ink/15 bg-white/70 text-ink/75 hover:bg-white"
          }`}
        >
          {t.steps.pages}
        </Link>
      </nav>

      {/* Step description */}
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink/65">
        {t.stepDesc[step]}
      </p>

      {/* Step content */}
      <div className="mt-4">
        {step === "scrape" ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-ink/10 bg-white p-4 text-sm leading-relaxed text-ink/70">
              {t.scrape.intro}
            </p>
            <LanderClient />
            <a
              href="/landing-pages/analyze"
              className="inline-block text-sm font-medium text-signal hover:underline"
            >
              {t.nav.openStandalone}
            </a>
          </div>
        ) : null}

        {step === "recommend" ? <RecommendStep dict={t} /> : null}

        {step === "generate" ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-ink/10 bg-white p-4 text-sm leading-relaxed text-ink/70">
              {t.generate.intro}
            </p>
            <RewriteClient lang={lang} />
            <a
              href="/landing-pages/rewrite"
              className="inline-block text-sm font-medium text-signal hover:underline"
            >
              {t.nav.openStandalone}
            </a>
          </div>
        ) : null}

        {step === "abtest" ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-ink/10 bg-white p-4 text-sm leading-relaxed text-ink/70">
              {t.abtest.intro}
            </p>
            <ExperimentsClient dict={expDict} />
            <a
              href="/experiments"
              className="inline-block text-sm font-medium text-signal hover:underline"
            >
              {t.abtest.openExperiments}
            </a>
            {/* 下一步：落地页定稿 → 自动化广告 */}
            <div className="rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
              <p className="text-sm font-semibold text-ink">🚀 {t.abtest.nextStepTitle}</p>
              <p className="mt-1 text-xs text-ink/55">{t.abtest.nextStepHint}</p>
              <a
                href="/ads/auto-create"
                className="mt-2 inline-block rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                📢 {t.abtest.nextStepAds}
              </a>
            </div>
          </div>
        ) : null}

        {step === "pages" ? pagesContent : null}
      </div>

      {/* Step footer: completion + sequential nav (flow steps only) */}
      {stepIndex >= 0 ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white p-4">
          <button
            type="button"
            onClick={() => toggleDone(step)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
              isDone
                ? "border-green-500 bg-green-50 text-green-700"
                : "border-ink/15 bg-white/70 text-ink/75 hover:bg-white"
            }`}
          >
            {isDone ? t.nav.markedDone : t.nav.markDone}
          </button>
          <div className="flex gap-2">
            {prevStep ? (
              <Link
                href={stepHref(prevStep, offerId)}
                className="rounded-lg border border-ink/15 bg-white/70 px-4 py-2 text-sm font-medium text-ink/75 hover:bg-white"
              >
                {t.nav.prev}
              </Link>
            ) : null}
            {nextStep ? (
              <Link
                href={stepHref(nextStep, offerId)}
                className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                {t.nav.next}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
