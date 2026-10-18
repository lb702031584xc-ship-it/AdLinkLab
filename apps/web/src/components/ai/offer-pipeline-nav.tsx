"use client";

/**
 * Offer 主线管线导航：每个管线页面顶部显示"正在测试哪个 Offer"，
 * 各步骤带 ?offerId= 互跳，下一步一键走。解决"每个页面都是孤岛、重复输入"。
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { zh, en } from "@/i18n/dict/pipeline";

export type PipelineStep =
  | "analyze"
  | "blueprint"
  | "terms"
  | "compliance"
  | "keywords"
  | "lander"
  | "planner"
  | "launch";

const STEPS: Array<{ key: PipelineStep; href: (offerId: string) => string }> = [
  { key: "analyze", href: (id) => `/ai/analyze?offerId=${encodeURIComponent(id)}` },
  { key: "blueprint", href: (id) => `/ai/blueprint?offerId=${encodeURIComponent(id)}` },
  { key: "terms", href: (id) => `/ai/terms?offerId=${encodeURIComponent(id)}` },
  { key: "compliance", href: (id) => `/ai/compliance?offerId=${encodeURIComponent(id)}` },
  { key: "keywords", href: (id) => `/keywords/starter?tab=launch&offerId=${encodeURIComponent(id)}` },
  { key: "lander", href: (id) => `/landing-pages?offerId=${encodeURIComponent(id)}` },
  { key: "planner", href: (id) => `/ai/traffic-planner?offerId=${encodeURIComponent(id)}` },
  { key: "launch", href: (id) => `/ads/auto-create?offerId=${encodeURIComponent(id)}` },
];

export interface PipelineOffer {
  id: string;
  name: string;
  network?: string | null;
}

export function OfferPipelineNav({
  current,
  offerId,
  offerName,
  offerNetwork,
  offers,
  onSelectOffer,
  picker,
}: {
  current: PipelineStep;
  offerId: string | null;
  offerName?: string | null;
  offerNetwork?: string | null;
  /** 传了就渲染内置 offer 下拉（页面没有自带选择器时用） */
  offers?: PipelineOffer[];
  onSelectOffer?: (id: string) => void;
  /** 页面自带的选择器（传了就不渲染内置下拉） */
  picker?: ReactNode;
}) {
  const { lang } = useI18n();
  const d = lang === "zh" ? zh : en;

  const idx = STEPS.findIndex((s) => s.key === current);
  const next = idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : null;

  // 还没选 offer：引导去选
  if (!offerId) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-ink/20 bg-white/60 px-4 py-3">
        <span className="text-sm text-ink/70">🧪 {d.noOfferHint}</span>
        {offers && onSelectOffer ? (
          <select
            value=""
            onChange={(e) => e.target.value && onSelectOffer(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-signal"
          >
            <option value="">{d.selectOffer}</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.network ? `（${o.network}）` : ""}
              </option>
            ))}
          </select>
        ) : (
          <Link
            href="/offers"
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {d.goOffers}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-ink/10 bg-white/80 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink/60">🧪 {d.testing}：</span>
        <span className="text-sm font-semibold text-ink">
          {offerName || offerId}
          {offerNetwork ? <span className="ml-1 font-normal text-ink/50">（{offerNetwork}）</span> : null}
        </span>
        {picker ?? (offers && onSelectOffer ? (
          <select
            value={offerId}
            onChange={(e) => e.target.value && onSelectOffer(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs text-ink/70 outline-none focus:border-signal"
            title={d.selectOffer}
          >
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.network ? `（${o.network}）` : ""}
              </option>
            ))}
          </select>
        ) : null)}
        {next && (
          <Link
            href={next.href(offerId)}
            className="ml-auto rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            {d.nextStep}：{d.steps[next.key]} →
          </Link>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {STEPS.map((s, i) => {
          const active = s.key === current;
          const label = d.steps[s.key];
          return (
            <span key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink/30">→</span>}
              {active ? (
                <span className="rounded-md bg-signal/10 px-2 py-0.5 text-xs font-semibold text-signal">
                  {label}
                </span>
              ) : (
                <Link
                  href={s.href(offerId)}
                  className="rounded-md px-2 py-0.5 text-xs text-ink/60 hover:bg-ink/5 hover:text-ink"
                >
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
