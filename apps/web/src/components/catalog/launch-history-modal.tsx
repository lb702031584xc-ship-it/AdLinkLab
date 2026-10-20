"use client";

import { useEffect, useState } from "react";
import {
  getProductLaunchHistoryAction,
  type ProductLaunchHistory,
} from "@/lib/api/catalog-actions";

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtMoney2(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

/**
 * 商品历史投放记录弹窗：该商品建过的 Offer + 每次投放档案
 * （展示/点击/花费/转化/收入；全部真实数据，无记录时显示空状态不编数）。
 */
export function LaunchHistoryModal({
  productId,
  productName,
  lang,
  onClose,
}: {
  productId: string;
  productName: string;
  lang: "zh" | "en";
  onClose: () => void;
}) {
  const [data, setData] = useState<ProductLaunchHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProductLaunchHistoryAction(productId).then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const en = lang === "en";
  const t = {
    title: en ? "Launch history" : "历史投放记录",
    loading: en ? "Loading…" : "加载中…",
    empty: en ? "No launch records for this product yet." : "该商品还没有投放记录。",
    offer: en ? "Offer" : "投放 Offer",
    archives: en ? "Launch records" : "投放记录",
    th: {
      offer: en ? "Offer" : "Offer",
      date: en ? "Launched" : "投放日期",
      decision: en ? "Decision" : "结论",
      imp: en ? "Impr." : "展示",
      click: en ? "Clicks" : "点击",
      spend: en ? "Spend" : "花费",
      conv: en ? "Conv." : "转化",
      rev: en ? "Revenue" : "收入",
    },
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">{t.title}</h2>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink/55">{productName}</p>
          </div>
          <button
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !data ? (
          <p className="py-8 text-center text-sm text-ink/50">{t.loading}</p>
        ) : data.offers.length === 0 && data.archives.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/50">{t.empty}</p>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-medium text-ink">
              {t.offer}（{data.offers.length}）
            </h3>
            <ul className="mb-5 space-y-1.5">
              {data.offers.map((o) => (
                <li key={o.offerId} className="flex items-center justify-between gap-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{o.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink/50">
                    {fmtDate(o.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
            <h3 className="mb-2 text-sm font-medium text-ink">
              {t.archives}（{data.archives.length}）
            </h3>
            {data.archives.length === 0 ? (
              <p className="text-sm text-ink/50">{t.empty}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="border-b border-ink/10 text-left text-ink/50">
                      <th className="py-2 pr-3">{t.th.offer}</th>
                      <th className="py-2 pr-3">{t.th.date}</th>
                      <th className="py-2 pr-3">{t.th.decision}</th>
                      <th className="py-2 pr-3 text-right">{t.th.imp}</th>
                      <th className="py-2 pr-3 text-right">{t.th.click}</th>
                      <th className="py-2 pr-3 text-right">{t.th.spend}</th>
                      <th className="py-2 pr-3 text-right">{t.th.conv}</th>
                      <th className="py-2 text-right">{t.th.rev}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.archives.map((a) => (
                      <tr key={a.id} className="border-t border-ink/5">
                        <td className="max-w-[200px] truncate py-2 pr-3 text-ink">{a.offerName}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-ink/70">
                          {fmtDate(a.launchedAt)}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-ink/70">
                          {a.decision ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink/70">
                          {fmt(a.impressions)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink/70">
                          {fmt(a.clicks)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink/70">
                          {fmtMoney2(a.spend)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink/70">
                          {fmt(a.conversions)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-ink/70">
                          {fmtMoney2(a.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
