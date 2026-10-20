"use client";

import { useEffect, useState } from "react";
import { listLaunchArchivesAction } from "@/lib/api/launch-archive-actions";
import { DailyAlertsCard } from "@/components/monitoring/daily-alerts-card";
import { useDict } from "@/i18n/use-dict";

/**
 * 首页经营看板：聚合 LaunchArchive（投放归档）给出经营四数——
 * 在测 Offer 数（status=running，按 offerId/offerName 去重）、累计花费、
 * 累计佣金收入、净额（收入 − 花费）。全部来自真实归档数据；
 * 无归档显示空状态，加载/失败各有状态，绝不编造数字。
 * 下方复用每日预警卡（分级口径与监控页一致）。
 */

interface OverviewStats {
  runningOffers: number;
  totalSpend: number;
  totalRevenue: number;
  net: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; stats: OverviewStats };

const fmtMoney = (v: number): string =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BusinessOverview() {
  const t = useDict();
  const d = t.dashboard.businessOverview;
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void listLaunchArchivesAction({ page: 1, pageSize: 500 }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setState({ kind: "error", message: res.error });
        return;
      }
      const items = res.data.items;
      if (items.length === 0) {
        setState({ kind: "empty" });
        return;
      }
      const runningKeys = new Set<string>();
      for (const a of items) {
        if (a.status === "running") runningKeys.add(a.offerId ?? a.offerName);
      }
      const totalSpend = items.reduce((sum, a) => sum + (a.spend ?? 0), 0);
      const totalRevenue = items.reduce((sum, a) => sum + (a.revenue ?? 0), 0);
      setState({
        kind: "ready",
        stats: {
          runningOffers: runningKeys.size,
          totalSpend,
          totalRevenue,
          net: totalRevenue - totalSpend,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <section className="rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">{d.title}</h2>
        {state.kind === "loading" ? (
          <p className="mt-3 text-sm text-ink/60">{d.loading}</p>
        ) : state.kind === "error" ? (
          <p className="mt-3 text-sm text-red-700">{state.message}</p>
        ) : state.kind === "empty" ? (
          <div className="mt-3">
            <p className="text-sm text-ink/60">{d.emptyText}</p>
            <a
              href="/reports/launch"
              className="mt-3 inline-block rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {d.goLaunch}
            </a>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: d.runningOffers, value: String(state.stats.runningOffers), cls: "text-ink" },
              { label: d.totalSpend, value: fmtMoney(state.stats.totalSpend), cls: "text-ink" },
              { label: d.totalRevenue, value: fmtMoney(state.stats.totalRevenue), cls: "text-ink" },
              {
                label: d.net,
                value: fmtMoney(state.stats.net),
                cls: state.stats.net < 0 ? "text-red-700" : state.stats.net > 0 ? "text-emerald-700" : "text-ink",
              },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-ink/10 bg-white/80 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{card.label}</p>
                <p className={`mt-2 font-display text-3xl font-semibold ${card.cls}`}>{card.value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <DailyAlertsCard title={d.alertsTitle} emptyText={d.alertsEmpty} detailLinkHref="/daily-alerts" />
      </div>
    </div>
  );
}
