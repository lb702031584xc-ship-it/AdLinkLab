"use client";

import { useMemo, useState } from "react";
import type { DailyAlertsPageDict } from "@/i18n/dict/daily-alerts-page";
import {
  classifyDailyAlerts,
  DAILY_ALERT_GROUP_LABELS,
  DAILY_ALERT_KIND_ICONS,
  DAILY_ALERT_LEVEL_LABELS,
  type DailyAlertGroup,
  type DailyAlertLevel,
  type DailyAlertsInput,
} from "@/lib/daily-alerts";

const LEVEL_STYLE: Record<DailyAlertLevel, string> = {
  P0: "bg-red-500/10 text-red-700 border-red-500/30",
  P1: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  P2: "bg-ink/5 text-ink/60 border-ink/15",
};

const LEVEL_CARD: Record<DailyAlertLevel, string> = {
  P0: "text-red-600",
  P1: "text-amber-600",
  P2: "text-ink/70",
};

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

function StatCard({
  label,
  big,
  sub,
  accent,
}: {
  label: string;
  big: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
      <p className="text-xs text-ink/50">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? "text-ink"}`}>
        {big}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] tabular-nums text-ink/45">{sub}</p> : null}
    </div>
  );
}

export function DailyAlertsPageClient({
  t,
  input,
}: {
  t: DailyAlertsPageDict;
  input: DailyAlertsInput;
}) {
  const today = isoDate(input.generatedAt);
  const dates = useMemo(() => {
    const set = new Set<string>([today]);
    for (const a of input.alerts) set.add(isoDate(a.createdAt));
    return [...set].sort().reverse();
  }, [input, today]);
  const [date, setDate] = useState(today);

  const isToday = date === today;
  const current = useMemo(() => {
    if (isToday) return classifyDailyAlerts(input);
    return classifyDailyAlerts({
      ...input,
      archives: [],
      // 佣金/上下线是当前快照比对，只在「今天」视图展示，历史日期不重复计。
      offers: [],
      alerts: input.alerts.filter((a) => isoDate(a.createdAt) === date),
    });
  }, [input, date, isToday]);

  const history = useMemo(() => classifyDailyAlerts(input), [input]);

  const unresolvedTotal =
    current.counts.P0.unresolved + current.counts.P1.unresolved + current.counts.P2.unresolved;
  const totalAll =
    current.counts.P0.total + current.counts.P1.total + current.counts.P2.total;
  const histTotal =
    history.counts.P0.total + history.counts.P1.total + history.counts.P2.total;

  const lastEvent =
    input.alerts.length > 0
      ? input.alerts.reduce((max, a) => (a.createdAt > max ? a.createdAt : max), input.alerts[0].createdAt)
      : null;

  const groups: DailyAlertGroup[] = [
    "立即止损",
    "投放受限",
    "数据与归因",
    "佣金与上下线",
  ];

  return (
    <div className="space-y-5">
      {/* 报告头 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-white px-5 py-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm text-ink/70">
          {t.page.reportDate}
          <select
            className="rounded-lg border border-ink/15 bg-paper px-3 py-1.5 text-sm text-ink"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
                {d === today ? ` (${t.page.today})` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-ink/45">
          {t.page.baseline}：{new Date(input.generatedAt).toLocaleString()}
        </span>
        <span className="text-xs text-ink/45">
          {t.page.lastEvent}：{lastEvent ? new Date(lastEvent).toLocaleString() : "—"}
        </span>
      </div>

      {!input.hasData ? (
        <div className="rounded-xl border border-ink/10 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-ink/60">{t.page.noData}</p>
        </div>
      ) : (
        <>
          {unresolvedTotal === 0 ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] px-5 py-4">
              <p className="text-sm font-medium text-emerald-700">✅ {t.page.noRiskTitle}</p>
            </div>
          ) : null}

          {/* 当前活跃风险 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">{t.current.title}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label={t.current.overview}
                big={String(unresolvedTotal)}
                sub={t.current.unresolvedOf
                  .replace("{u}", String(unresolvedTotal))
                  .replace("{t}", String(totalAll))}
              />
              {(["P0", "P1", "P2"] as DailyAlertLevel[]).map((lv) => (
                <StatCard
                  key={lv}
                  label={DAILY_ALERT_LEVEL_LABELS[lv]}
                  big={String(current.counts[lv].unresolved)}
                  sub={t.current.unresolvedOf
                    .replace("{u}", String(current.counts[lv].unresolved))
                    .replace("{t}", String(current.counts[lv].total))}
                  accent={LEVEL_CARD[lv]}
                />
              ))}
            </div>
          </section>

          {/* 近 90 日历史 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">{t.history.title}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label={t.history.total} big={String(histTotal)} />
              <StatCard label={t.history.p0} big={String(history.counts.P0.total)} accent={LEVEL_CARD.P0} />
              <StatCard label={t.history.p1} big={String(history.counts.P1.total)} accent={LEVEL_CARD.P1} />
              <StatCard label={t.history.p2} big={String(history.counts.P2.total)} />
            </div>
          </section>

          {/* 风险事件分组 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">{t.events.title}</h2>
            <div className="space-y-4">
              {groups.map((g) => {
                const items = current.items.filter((i) => i.group === g);
                return (
                  <div key={g} className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">
                        {DAILY_ALERT_GROUP_LABELS[g]}
                      </h3>
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] tabular-nums text-ink/60">
                        {t.events.activeItems.replace("{n}", String(items.length))}
                      </span>
                    </div>
                    {items.length === 0 ? (
                      <p className="mt-3 text-xs text-ink/45">{t.events.empty}</p>
                    ) : (
                      <ul className="mt-3 space-y-2.5">
                        {items.map((item, idx) => (
                          <li
                            key={idx}
                            className="flex flex-wrap items-start gap-2.5 rounded-lg bg-ink/[0.02] px-3.5 py-2.5"
                          >
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${LEVEL_STYLE[item.level]}`}
                            >
                              {item.level}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-ink">
                                {item.kind
                                  ? `${DAILY_ALERT_KIND_ICONS[item.kind]} `
                                  : ""}
                                {item.title}
                              </p>
                              <p className="mt-0.5 text-[11px] text-ink/45">
                                {t.events.source}：{item.source}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
