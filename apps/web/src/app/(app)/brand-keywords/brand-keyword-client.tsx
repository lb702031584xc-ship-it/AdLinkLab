"use client";

/**
 * 品牌词分级管理 — 新建 + 行操作（client widget）。
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the brand-keyword server actions only.
 * 规则：第一次警告即自动降级（status=DOWNGRADED 且 biddingEnabled=false）；
 * 人工恢复把状态与开关一起还原为 ACTIVE / true，警告计数保留。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createBrandKeywordAction,
  reenableBrandKeywordAction,
  updateBrandKeywordAction,
  warnBrandKeywordAction,
  type BrandKeyword,
} from "@/lib/api/brand-keyword-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const WARNING_KINDS = ["ADVERTISER_REJECT", "NETWORK_WARNING", "OTHER"];

export function BrandKeywordForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [brand, setBrand] = useState("");
  const [offerId, setOfferId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!keyword.trim()) {
      setError("品牌词必填。");
      return;
    }
    setBusy(true);
    try {
      const res = await createBrandKeywordAction({
        keyword: keyword.trim(),
        brand: brand.trim() || null,
        offerId: offerId.trim() || null,
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">新建品牌词</h2>
      <p className="mt-1 text-xs text-ink/60">
        新建默认开启竞价（biddingEnabled=true）、状态 ACTIVE。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>品牌词</label>
          <input className={inputClass} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例如 roborock" />
        </div>
        <div>
          <label className={labelClass}>品牌（可选）</label>
          <input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Offer ID（可选）</label>
          <input className={inputClass} value={offerId} onChange={(e) => setOfferId(e.target.value)} />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "新建中…" : "新建"}
        </button>
      </div>
    </form>
  );
}

export function BrandKeywordRowActions({ keyword }: { keyword: BrandKeyword }) {
  const router = useRouter();
  const [kind, setKind] = useState("NETWORK_WARNING");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(true);
    try {
      const res = await action();
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? "操作失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {WARNING_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => warnBrandKeywordAction(keyword.id, kind))}
          className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          记警告（自动降级）
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => reenableBrandKeywordAction(keyword.id))}
          className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          人工恢复
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              updateBrandKeywordAction(keyword.id, {
                biddingEnabled: !keyword.biddingEnabled,
              })
            )
          }
          className="rounded-lg border border-ink/20 px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          {keyword.biddingEnabled ? "关竞价" : "开竞价"}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
