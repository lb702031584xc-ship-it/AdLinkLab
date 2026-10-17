"use client";

/** P1-21：DLQ 列表 + 重试/丢弃（/jobs 页的死信页签）。 */
import { useEffect, useState } from "react";
import {
  discardDeadLetterAction,
  listDeadLetterAction,
  retryDeadLetterAction,
  type DeadLetterJob,
} from "@/lib/api/dead-letter-actions";

export function DeadLetterClient() {
  const [items, setItems] = useState<DeadLetterJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listDeadLetterAction();
    setLoading(false);
    if (res.ok) setItems(res.data.items);
    else setError(res.error);
  };

  useEffect(() => {
    void load();
  }, []);

  async function act(id: string, kind: "retry" | "discard") {
    setBusyId(id);
    setMsg(null);
    const res =
      kind === "retry" ? await retryDeadLetterAction(id) : await discardDeadLetterAction(id);
    setBusyId(null);
    if (res.ok) {
      setMsg(kind === "retry" ? "已标记为待重试（下一次定时调度执行）。" : "已丢弃。");
      await load();
    } else {
      setMsg(res.error);
    }
  }

  if (loading) return <p className="py-10 text-center text-sm text-ink/60">…</p>;
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (items.length === 0) {
    return <p className="py-6 text-sm text-ink/60">暂无死信任务。</p>;
  }
  return (
    <div className="space-y-3">
      {msg && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-4 py-2 text-sm text-ink/80">
          {msg}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((j) => (
          <li key={j.id} className="rounded-xl border border-ink/10 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {j.status}
              </span>
              <span className="font-mono font-medium text-ink">{j.jobName}</span>
              <span className="text-ink/50">
                {new Date(j.createdAt).toLocaleString()} · 重试 {j.retryCount} 次
              </span>
            </div>
            {j.error && <p className="mt-1 text-sm text-red-700">{j.error}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busyId === j.id || j.status === "discarded"}
                onClick={() => void act(j.id, "retry")}
                className="rounded-lg border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink disabled:opacity-50"
              >
                重试
              </button>
              <button
                type="button"
                disabled={busyId === j.id || j.status === "discarded"}
                onClick={() => void act(j.id, "discard")}
                className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 disabled:opacity-50"
              >
                丢弃
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
