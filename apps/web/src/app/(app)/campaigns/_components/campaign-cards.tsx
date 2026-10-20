"use client";

import { StatusBadge } from "@/components/entities/ui";
import type { CampaignCardsDict } from "@/i18n/dict/campaign-cards";
import type { Campaign } from "@/lib/api/entities";
import type { CampaignStat } from "@/lib/api/campaigns-actions";
import {
  CampaignToggleButton,
  type CampaignToggleStrings,
} from "./campaign-toggle-button";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-ink/[0.03] px-3 py-2">
      <p className="text-[11px] text-ink/50">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function CampaignCards({
  campaigns,
  stats,
  t,
  toggleStrings,
}: {
  campaigns: Campaign[];
  stats: Record<string, CampaignStat>;
  t: CampaignCardsDict;
  toggleStrings: Record<string, CampaignToggleStrings>;
}) {
  const totals = campaigns.reduce(
    (acc, c) => {
      const s = stats[c.id];
      if (s) {
        acc.clicks += s.clicks;
        acc.conversions += s.conversions;
        acc.value += s.conversionValue;
      }
      if (c.status === "ACTIVE") acc.active += 1;
      if (c.status === "PAUSED") acc.paused += 1;
      return acc;
    },
    { active: 0, paused: 0, clicks: 0, conversions: 0, value: 0 }
  );

  return (
    <div>
      {/* 总览统计 */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <p className="text-xs text-ink/50">{t.overview.total}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {campaigns.length}
          </p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <p className="text-xs text-ink/50">{t.overview.active}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">
            {totals.active}
          </p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <p className="text-xs text-ink/50">{t.overview.paused}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">
            {totals.paused}
          </p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <p className="text-xs text-ink/50">{t.overview.clicks}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {totals.clicks.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <p className="text-xs text-ink/50">{t.overview.conversions}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {totals.conversions.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <p className="text-xs text-ink/50">{t.overview.value}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {totals.value.toFixed(2)}
          </p>
        </div>
      </div>

      {/* 卡片网格 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((c) => {
          const s = stats[c.id];
          return (
            <article
              key={c.id}
              className="flex flex-col rounded-xl border border-ink/10 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="line-clamp-2 text-[15px] font-semibold text-ink">
                  {c.name}
                </h3>
                <StatusBadge value={c.status} />
              </div>
              <p className="mt-1.5 font-mono text-xs text-ink/50">
                {c.googleCampaignId}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/55">
                <span>
                  {t.card.biddingStrategy}：{c.biddingStrategy ?? "—"}
                </span>
                <span>
                  {t.card.updatedAt}：
                  {c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "—"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Metric label={t.card.adGroups} value={s?.adGroups ?? "—"} />
                <Metric label={t.card.trackingLinks} value={s?.trackingLinks ?? "—"} />
                <Metric label={t.card.clicks} value={(s?.clicks ?? 0).toLocaleString()} />
                <Metric
                  label={t.card.conversions}
                  value={(s?.conversions ?? 0).toLocaleString()}
                />
              </div>
              {s && s.conversionValue > 0 ? (
                <p className="mt-2 text-xs text-ink/55">
                  {t.card.conversionValue}：
                  <span className="font-semibold tabular-nums text-ink">
                    {s.conversionValue.toFixed(2)}
                  </span>
                </p>
              ) : null}

              <div className="mt-4 flex items-center justify-between border-t border-ink/8 pt-3">
                <div className="flex gap-3 text-xs">
                  <a href="/ad-groups" className="text-signal hover:underline">
                    {t.card.viewAdGroups}
                  </a>
                  <a href="/monitoring" className="text-signal hover:underline">
                    {t.card.viewMonitoring}
                  </a>
                </div>
                <CampaignToggleButton
                  campaignId={c.id}
                  googleAccountId={c.googleAccountId}
                  currentStatus={c.status}
                  t={toggleStrings[c.id]}
                />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
