"use client";

/**
 * 封号复盘库 — 手动记一条 + 恢复标记（client widget）。
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the ban-log server actions only.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createBanEventAction,
  markBanEventRecoveredAction,
  type BanEvent,
} from "@/lib/api/ban-log-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const OPERATION_TYPES = ["DIRECT_LINK", "BRAND_KEYWORD", "OTHER"];

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

export function BanLogForm() {
  const router = useRouter();
  const [network, setNetwork] = useState("");
  const [operationType, setOperationType] = useState("DIRECT_LINK");
  const [offerId, setOfferId] = useState("");
  const [lostBalanceUsd, setLostBalanceUsd] = useState("");
  const [lostPendingUsd, setLostPendingUsd] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!network.trim()) {
      setError("网络必填。");
      return;
    }
    setBusy(true);
    try {
      const res = await createBanEventAction({
        network: network.trim(),
        operationType,
        offerId: offerId.trim() || null,
        lostBalanceUsd: num(lostBalanceUsd) ?? 0,
        lostPendingUsd: num(lostPendingUsd) ?? 0,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "记录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">手动记一条复盘记录</h2>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>网络</label>
          <input className={inputClass} value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="例如 Admitad" />
        </div>
        <div>
          <label className={labelClass}>操作类型</label>
          <select className={inputClass} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
            {OPERATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Offer ID（可选）</label>
          <input className={inputClass} value={offerId} onChange={(e) => setOfferId(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>备注</label>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>损失余额（USD）</label>
          <input className={inputClass} value={lostBalanceUsd} onChange={(e) => setLostBalanceUsd(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className={labelClass}>损失待结（USD）</label>
          <input className={inputClass} value={lostPendingUsd} onChange={(e) => setLostPendingUsd(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "记录中…" : "记一条"}
        </button>
      </div>
    </form>
  );
}

export function RecoverAction({ event }: { event: BanEvent }) {
  const router = useRouter();
  const [recoveredUsd, setRecoveredUsd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (event.recovered) {
    return <span className="text-xs text-green-700">已恢复 ${event.recoveredUsd}</span>;
  }

  async function handleRecover() {
    setError(null);
    const v = num(recoveredUsd);
    if (v === undefined || v < 0) {
      setError("请填写 ≥0 的追回金额。");
      return;
    }
    setBusy(true);
    try {
      const res = await markBanEventRecoveredAction(event.id, v);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="w-24 rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
        value={recoveredUsd}
        onChange={(e) => setRecoveredUsd(e.target.value)}
        inputMode="decimal"
        placeholder="追回金额"
      />
      <button
        type="button"
        onClick={handleRecover}
        disabled={busy}
        className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        标记恢复
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
