"use client";

/**
 * 商品库挑选 —— 新手流程第 2 步。
 *
 * 从商品库里按「佣金够不够、覆盖不覆盖类目 CPC、同品牌留最优」挑出
 * 可以建成 Offer 的名单。挑不出来的原因会写清楚，不是只给空列表。
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
  const [minPayout, setMinPayout] = useState("12");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CatalogPickPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await catalogPickAction({
        minPayoutUsd: Number(minPayout) || undefined,
        category: category.trim() || undefined,
      });
      if (r.ok) setData(r.data);
      else setError(r.error);
    } finally {
      setBusy(false);
    }
  };

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
          从商品库里筛出「佣金付得起点击」的候选。挑不出来不是工具坏了，
          是在告诉你这批货不赚钱。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink/10 p-4">
        <label className="flex flex-col gap-1 text-sm text-ink/60">
          佣金门槛（美元）
          <input
            value={minPayout}
            onChange={(e) => setMinPayout(e.target.value)}
            inputMode="decimal"
            className="w-28 rounded-lg border border-ink/10 bg-white px-2 py-1 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink/60">
          类目（可空，用于取 CPC 基线）
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="chamber vacuum sealer"
            className="w-64 rounded-lg border border-ink/10 bg-white px-2 py-1 text-ink"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "筛选中…" : "开始挑选"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <section className="rounded-xl border border-ink/10 p-4">
            <h2 className="text-sm font-semibold">CPC 基线</h2>
            <p className="mt-1 text-sm text-ink/80">
              ${data.baseline.cpcUsd.toFixed(2)} / 点击
              <span className="ml-2 text-xs text-ink/50">
                （{SOURCE_LABEL[data.baseline.source] ?? data.baseline.source}，
                样本 {data.baseline.samples} 条，置信度 {data.baseline.confidence}）
              </span>
            </p>
            <p className="mt-1 text-xs text-ink/55">{data.baseline.note}</p>
          </section>

          <section className="rounded-xl border border-ink/10 p-4">
            <h2 className="text-sm font-semibold">
              可建 Offer：{data.result.counts.picked} 个
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
                    <th className="text-left font-normal">品牌</th>
                    <th className="text-right font-normal">单笔佣金</th>
                    <th className="text-right font-normal">保本 CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {data.result.picked.map((p) => (
                    <tr key={p.productId} className="border-t border-ink/5">
                      <td className="py-1 text-ink/85">{p.name}</td>
                      <td className="text-ink/60">{p.brand ?? "—"}</td>
                      <td className="text-right">${p.payoutUsd.toFixed(2)}</td>
                      <td className="text-right">${p.breakevenCpcUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {data.result.dropped.length > 0 && (
            <section className="rounded-xl border border-ink/10 p-4">
              <h2 className="text-sm font-semibold">
                淘汰 {data.result.counts.dropped} 个
              </h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/70">
                {Object.entries(droppedByCode)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, n]) => (
                    <li key={code}>
                      · {CODE_LABEL[code] ?? code}：{n} 个
                    </li>
                  ))}
              </ul>
              {data.result.summary.topDropCode && (
                <p className="mt-2 text-xs text-ink/55">
                  主因：{CODE_LABEL[data.result.summary.topDropCode] ?? data.result.summary.topDropCode}
                  （{data.result.summary.topDropCount} 个）
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
