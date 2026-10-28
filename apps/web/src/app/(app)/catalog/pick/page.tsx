"use client";

/**
 * 商品库挑选 —— 零输入：点一下，直接看「能做 / 不能做」。
 *
 * 设计原则（2026-10-28 精简）：
 *   新手不该填任何数字。佣金门槛、价格、评论、佣金率这些要么系统已知，
 *   要么和「能不能赚钱」无关。系统只回答一个问题：
 *     单笔佣金算出的保本 CPC，够不够付这个类目的点击成本？
 *
 * 列只保留 5 个：商品 / 国家 / 单笔佣金 / 保本 CPC / 结论。
 */
import { useState } from "react";
import {
  catalogPickAction,
  type CatalogPickPayload,
} from "@/lib/api/catalog-pick-actions";

const CODE_LABEL: Record<string, string> = {
  PAYOUT_UNKNOWN: "佣金未知",
  BELOW_MIN_PAYOUT: "佣金太低",
  CANNOT_COVER_CPC: "覆盖不了 CPC",
  OUT_OF_STOCK: "缺货",
  BRAND_DEDUP: "同品牌重复",
  OVER_LIMIT: "超出上限",
};

const SOURCE_LABEL: Record<string, string> = {
  exact: "该类目实测",
  broad: "大类推算",
  global: "全站推算",
  assumed: "假定值",
};

export default function CatalogPickPage() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CatalogPickPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await catalogPickAction({});
      if (r.ok) setData(r.data);
      else setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  const cpc = data?.baseline.cpcUsd ?? 0;
  const droppedByCode = data
    ? data.result.dropped.reduce<Record<string, number>>((acc, d) => {
        acc[d.code] = (acc[d.code] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl">商品库挑选</h1>
        <p className="mt-1 text-sm text-ink/60">
          点一下就行。系统用「单笔佣金 → 保本 CPC」和这个类目的点击成本比，
          直接告诉你哪些能做。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "计算中…" : "开始挑选"}
        </button>
        {data && (
          <span className="text-xs text-ink/55">
            类目 CPC ${cpc.toFixed(2)}/点击（
            {SOURCE_LABEL[data.baseline.source] ?? data.baseline.source}，样本{" "}
            {data.baseline.samples} 条）
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <section className="rounded-xl border border-ink/10 p-4">
            <h2 className="text-sm font-semibold">
              能做 {data.result.counts.picked} 个
              <span className="ml-2 text-xs font-normal text-ink/50">
                （商品库共 {data.result.counts.total} 个）
              </span>
            </h2>

            {data.result.picked.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                {data.result.notes.join("；")}
              </p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-ink/50">
                  <tr>
                    <th className="text-left font-normal">商品</th>
                    <th className="text-left font-normal">国家</th>
                    <th className="text-right font-normal">单笔佣金</th>
                    <th className="text-right font-normal">保本 CPC</th>
                    <th className="text-right font-normal">结论</th>
                  </tr>
                </thead>
                <tbody>
                  {data.result.picked.map((p) => {
                    const margin =
                      cpc > 0 ? (p.breakevenCpcUsd / cpc - 1) * 100 : null;
                    return (
                      <tr key={p.productId} className="border-t border-ink/5">
                        <td className="py-1 text-ink/85">{p.name}</td>
                        <td className="text-ink/60">{p.countryCode ?? "—"}</td>
                        <td className="text-right">${p.payoutUsd.toFixed(2)}</td>
                        <td className="text-right">
                          ${p.breakevenCpcUsd.toFixed(2)}
                        </td>
                        <td className="text-right">
                          <span className="text-emerald-700">能做</span>
                          {margin !== null && (
                            <span className="ml-1 text-xs text-ink/50">
                              余量 {margin > 0 ? "+" : ""}
                              {margin.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {data.result.dropped.length > 0 && (
            <section className="rounded-xl border border-ink/10 p-4">
              <h2 className="text-sm font-semibold">
                不能做 {data.result.counts.dropped} 个
              </h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/70">
                {Object.entries(droppedByCode)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, num]) => (
                    <li key={code}>
                      · {CODE_LABEL[code] ?? code}：{num} 个
                    </li>
                  ))}
              </ul>
              {data.result.summary.topDropCode && (
                <p className="mt-2 text-xs text-ink/55">
                  主因：
                  {CODE_LABEL[data.result.summary.topDropCode] ??
                    data.result.summary.topDropCode}
                  （{data.result.summary.topDropCount} 个）
                </p>
              )}
            </section>
          )}

          <p className="text-xs text-ink/50">{data.baseline.note}</p>
        </>
      )}
    </div>
  );
}
