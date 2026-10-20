"use client";

import { useEffect, useState } from "react";
import { getDailyAlertsAction } from "@/lib/api/daily-alerts-actions";
import {
  classifyDailyAlerts,
  DAILY_ALERT_GROUP_LABELS,
  DAILY_ALERT_KIND_ICONS,
  DAILY_ALERT_LEVEL_LABELS,
  type DailyAlertGroup,
  type DailyAlertLevel,
  type DailyAlertsInput,
} from "@/lib/daily-alerts";

/**
 * P2-9：每日预警卡片（/monitoring 与 /reports/launch 共用）。
 * 分级 P0 立即处理 / P1 需要关注 / P2 信息提醒；分组 立即止损 / 投放受限 / 数据与归因。
 * 只做展示，绝不自动执行。无数据时显示“待生成”，绝不编造。
 */
export function DailyAlertsCard({
  title,
  emptyText,
  detailLinkHref,
}: {
  title: string;
  emptyText: string;
  detailLinkHref?: string;
}) {
  const [data, setData] = useState<DailyAlertsInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getDailyAlertsAction().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setData(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink/60">加载中…</p>
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-red-700">{error ?? emptyText}</p>
      </section>
    );
  }
  if (!data.hasData) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink/60">{emptyText}</p>
      </section>
    );
  }
  const classified = classifyDailyAlerts(data);
  const groups: DailyAlertGroup[] = [
    "立即止损",
    "投放受限",
    "数据与归因",
    "佣金与上下线",
  ];
  const levels: DailyAlertLevel[] = ["P0", "P1", "P2"];
  const levelClass: Record<DailyAlertLevel, string> = {
    P0: "bg-red-100 text-red-800",
    P1: "bg-amber-100 text-amber-800",
    P2: "bg-ink/10 text-ink/70",
  };
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {detailLinkHref && (
          <a href={detailLinkHref} className="text-xs text-ink/60 underline">
            查看档案
          </a>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {levels.map((lv) => (
          <span
            key={lv}
            className={`rounded-full px-2.5 py-0.5 font-medium ${levelClass[lv]}`}
          >
            {DAILY_ALERT_LEVEL_LABELS[lv]}：{classified.counts[lv].unresolved}/
            {classified.counts[lv].total}（未处理/近 90 天）
          </span>
        ))}
      </div>
      {classified.items.length === 0 ? (
        <p className="mt-2 text-sm text-ink/60">{emptyText}</p>
      ) : (
        groups.map((g) => {
          const items = classified.items.filter((it) => it.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} className="mt-4">
              <h4 className="text-sm font-medium text-ink">
                {DAILY_ALERT_GROUP_LABELS[g]}（{items.length}）
              </h4>
              <ul className="mt-1 space-y-1 text-sm">
                {items.map((it, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${levelClass[it.level]}`}
                    >
                      {it.level}
                    </span>
                    <span className="text-ink/80">
                      {it.kind
                        ? `${DAILY_ALERT_KIND_ICONS[it.kind]} `
                        : ""}
                      {it.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <p className="mt-3 text-xs text-ink/50">
        仅展示建议，不自动执行；分级与 P1-5 测试节奏清单同源（pace-checklist.ts）。
      </p>
    </section>
  );
}
