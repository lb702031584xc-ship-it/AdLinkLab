"use client";

/**
 * 「今天」——新手唯一需要的一屏。
 * 只回答三件事：测什么、停什么、缺什么；再附一条「你的假设准不准」。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getTodayAction, type TodayData } from "@/lib/api/today-actions";

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getTodayAction()
      .then((r) => {
        if (!alive) return;
        if (r.ok) setData(r.data);
        else setError(r.error);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-ink/60">加载中…</p>;
  }
  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (!data) return null;

  const { counts, toTest, recentKills, calibration } = data;
  const nothingToDo =
    toTest.length === 0 && recentKills.length === 0 && counts.unknown === 0;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl">今天</h1>
        <p className="mt-1 text-sm text-ink/60">
          池子共 {counts.total} 个 offer：可推进 {counts.go} · 待补证据{" "}
          {counts.unknown} · 判停 {counts.stop} · 未筛 {counts.notScreened}
        </p>
      </div>

      {nothingToDo && (
        <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-6 text-sm text-ink/70">
          现在没有待办。下一步：去{" "}
          <Link href="/offers" className="underline">
            选品
          </Link>{" "}
          勾几个 offer 跑一次初筛。
        </div>
      )}

      {toTest.length > 0 && (
        <section className="rounded-xl border border-ink/10 p-4">
          <h2 className="text-sm font-semibold text-emerald-700">
            待测 · {counts.go} 个
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {toTest.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{o.name}</span>
                <Link
                  href="/offers"
                  className="shrink-0 rounded-lg border border-ink/15 px-2 py-0.5 text-xs text-ink/70 hover:bg-ink/5"
                >
                  去生成关键词
                </Link>
              </li>
            ))}
          </ul>
          {counts.go > toTest.length && (
            <p className="mt-2 text-xs text-ink/50">
              还有 {counts.go - toTest.length} 个未列出
            </p>
          )}
        </section>
      )}

      {recentKills.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50/40 p-4">
          <h2 className="text-sm font-semibold text-red-700">该停 · 最近触发止损</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {recentKills.map((k, i) => (
              <li key={`${k.offerId ?? "x"}-${i}`} className="flex items-center justify-between gap-3">
                <span className="truncate">{k.name ?? k.offerId ?? "未知 offer"}</span>
                <span className="shrink-0 text-xs text-ink/60">
                  {k.actionTaken} · {k.at.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {counts.unknown > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-sm font-semibold text-amber-800">缺证据 · {counts.unknown} 个</h2>
          <p className="mt-1 text-sm text-ink/70">
            这些 offer 被判「待复核」，补齐当季依据、库存、低价流量后才能下结论。去{" "}
            <Link href="/offers" className="underline">
              选品
            </Link>{" "}
            切到宽松型补证据。
          </p>
        </section>
      )}

      <section className="rounded-xl border border-ink/10 p-4">
        <h2 className="text-sm font-semibold">你的假设准不准</h2>
        {calibration.samples === 0 ? (
          <p className="mt-1 text-sm text-ink/60">
            还没有投放数据可复盘。跑完第一个 offer 再回来看。
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              样本 {calibration.samples} 条，
              {calibration.k == null
                ? "算不出高估倍数"
                : `计划 EPC 是实测的 ${calibration.k.toFixed(2)} 倍`}
              {calibration.confidence !== "ok" && (
                <span className="ml-2 text-xs text-amber-700">（样本偏少，仅供参考）</span>
              )}
            </p>
            {calibration.notes.length > 0 && (
              <p className="mt-1 text-xs text-ink/60">{calibration.notes.join("；")}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
