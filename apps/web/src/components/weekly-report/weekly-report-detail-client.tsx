"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as weeklyReportZh, en as weeklyReportEn } from "@/i18n/dict/weekly-report";
import type {
  WeeklyReportRow,
  WeeklyReportTopOffer,
} from "@/lib/api/weekly-report-actions";

/** 进入洞察统计的最小点击数：过滤掉样本太小的偶然值。 */
const MIN_INSIGHT_CLICKS = 10;

type DetailDict = typeof weeklyReportZh.detail;

function InsightEmpty({ d, message }: { d: DetailDict; message?: string }) {
  return (
    <div className="mt-2 text-sm text-ink/45">
      <span className="font-medium">{d.insightEmpty}</span>
      <span>：{message ?? d.insightEmptyHint}</span>
    </div>
  );
}

function InsightCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-ink/5 p-3">
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="text-xs text-ink/55">{hint}</div>
      {children}
    </div>
  );
}

/**
 * 选品启示：只用周报里已有的 Offer 维度监控/转化数据（topOffers）
 * 现场计算，不编造；任一洞察数据不足就显示空状态。
 */
function SelectionInsights({
  topOffers,
  d,
}: {
  topOffers: WeeklyReportTopOffer[];
  d: DetailDict;
}) {
  const epcOf = (o: WeeklyReportTopOffer) =>
    o.clicks > 0 ? o.revenue / o.clicks : 0;
  const eligible = topOffers.filter((o) => o.clicks >= MIN_INSIGHT_CLICKS);

  const epcKing =
    [...eligible].sort((a, b) => epcOf(b) - epcOf(a))[0] ?? null;

  const bySource = new Map<string, { clicks: number; revenue: number }>();
  for (const o of eligible) {
    const key = o.network ?? "—";
    const cur = bySource.get(key) ?? { clicks: 0, revenue: 0 };
    cur.clicks += o.clicks;
    cur.revenue += o.revenue;
    bySource.set(key, cur);
  }
  const bestSource =
    [...bySource.entries()]
      .map(([name, s]) => ({
        name,
        avgEpc: s.clicks > 0 ? s.revenue / s.clicks : 0,
      }))
      .sort((a, b) => b.avgEpc - a.avgEpc)[0] ?? null;

  const fastest =
    topOffers
      .filter((o) => o.prevRevenue > 0)
      .map((o) => ({
        offer: o,
        growth: (o.revenue - o.prevRevenue) / o.prevRevenue,
      }))
      .filter((g) => g.growth > 0)
      .sort((a, b) => b.growth - a.growth)[0] ?? null;

  return (
    <div className="rounded-xl border border-ink/10 bg-white">
      <div className="border-b border-ink/10 px-4 py-3">
        <div className="font-medium text-ink">{d.insightsTitle}</div>
        <p className="mt-0.5 text-xs text-ink/55">{d.insightsDescription}</p>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <InsightCard title={d.insightEpcKing} hint={d.insightEpcKingHint}>
          {epcKing ? (
            <div className="mt-2">
              <div className="font-semibold text-ink">{epcKing.offerName}</div>
              <div className="text-sm text-ink/70">
                EPC ${epcOf(epcKing).toFixed(2)}
                {epcKing.network ? ` · ${epcKing.network}` : ""}
              </div>
            </div>
          ) : (
            <InsightEmpty d={d} />
          )}
        </InsightCard>
        <InsightCard title={d.insightBestSource} hint={d.insightBestSourceHint}>
          {bestSource ? (
            <div className="mt-2">
              <div className="font-semibold text-ink">{bestSource.name}</div>
              <div className="text-sm text-ink/70">
                EPC ${bestSource.avgEpc.toFixed(2)}
              </div>
            </div>
          ) : (
            <InsightEmpty d={d} />
          )}
        </InsightCard>
        <InsightCard title={d.insightFastestGrowth} hint={d.insightFastestGrowthHint}>
          {fastest ? (
            <div className="mt-2">
              <div className="font-semibold text-ink">
                {fastest.offer.offerName}
              </div>
              <div className="text-sm text-ink/70">
                +{(fastest.growth * 100).toFixed(0)}%
                {fastest.offer.network ? ` · ${fastest.offer.network}` : ""}
              </div>
            </div>
          ) : (
            <InsightEmpty d={d} />
          )}
        </InsightCard>
        <InsightCard title={d.insightKeywords} hint="">
          <InsightEmpty d={d} message={d.insightKeywordsEmpty} />
        </InsightCard>
      </div>
      <p className="px-4 pb-3 text-xs text-ink/45">{d.insightBasis}</p>
    </div>
  );
}

/** Automation round 2 — weekly report detail: metric cards + top offers + AI narrative. */
export function WeeklyReportDetailClient({
  report,
}: {
  report: WeeklyReportRow;
}) {
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d = lang === "en" ? weeklyReportEn : weeklyReportZh;
  const data = report.data;

  const cards: Array<{ label: string; value: string }> = [
    { label: d.detail.clicks, value: String(data.clicks) },
    { label: d.detail.conversions, value: String(data.conversions) },
    { label: d.detail.revenue, value: data.revenue.toFixed(2) },
    {
      label: d.detail.spend,
      value: data.spend == null ? d.detail.spendMissing : data.spend.toFixed(2),
    },
    { label: d.detail.alerts, value: String(data.alerts) },
    { label: d.detail.deadLinks, value: String(data.deadLinks) },
    { label: d.detail.newNegatives, value: String(data.newNegatives) },
    { label: d.detail.newTasks, value: String(data.newTasks) },
  ];

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.detail.title}
        description={`${formatDateTime(report.weekStart)} ~ ${formatDateTime(report.weekEnd)}`}
        actions={
          <Link
            href="/reports/weekly"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink/5"
          >
            {d.detail.back}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-ink/10 bg-white px-4 py-3"
          >
            <div className="text-xs text-ink/60">{c.label}</div>
            <div className="mt-1 text-xl font-semibold text-ink">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-ink/10 bg-white">
        <div className="border-b border-ink/10 px-4 py-3 font-medium text-ink">
          {d.detail.topOffers}
        </div>
        {data.topOffers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-ink/60">—</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">Offer</th>
                  <th className="px-3 py-2">{d.detail.offerClicks}</th>
                  <th className="px-3 py-2">{d.detail.offerConversions}</th>
                  <th className="px-3 py-2">{d.detail.offerRevenue}</th>
                  <th className="px-3 py-2">{d.detail.prevRevenue}</th>
                </tr>
              </thead>
              <tbody>
                {data.topOffers.map((o) => (
                  <tr
                    key={o.offerId ?? o.offerName}
                    className="border-t border-ink/10"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{o.offerName}</div>
                      {o.network && (
                        <div className="text-xs text-ink/50">{o.network}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink/70">{o.clicks}</td>
                    <td className="px-3 py-2 text-ink/70">{o.conversions}</td>
                    <td className="px-3 py-2 text-ink/70">
                      {o.revenue.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-ink/70">
                      {o.prevRevenue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-ink/10 bg-white">
        <div className="border-b border-ink/10 px-4 py-3 font-medium text-ink">
          {d.detail.aiSummaryTitle}
        </div>
        <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-ink/90">
          {report.aiSummary}
        </div>
      </div>

      <SelectionInsights topOffers={data.topOffers} d={d.detail} />
    </div>
  );
}
