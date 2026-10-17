"use client";

/** P1-16：批量审计 + 回滚页 — 列表 + 人工确认回滚。 */
import { useEffect, useState } from "react";
import {
  listBulkOperationsAction,
  rollbackBulkOperationAction,
} from "@/lib/api/ads-auto-actions";
import type { BulkOperationLog } from "@/lib/api/ads-auto";
import type { AdsAutoDict } from "@/i18n/dict/ads-auto";

export function AdsOperationsClient({ dict }: { dict: AdsAutoDict }) {
  const d = dict.operations;
  const [items, setItems] = useState<BulkOperationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listBulkOperationsAction(1, 20);
    setLoading(false);
    if (res.ok) setItems(res.data.items);
    else setError(res.error);
  };

  useEffect(() => {
    void load();
  }, []);

  async function rollback(log: BulkOperationLog) {
    if (!window.confirm(d.rollbackConfirm)) return;
    setBusyId(log.id);
    setResultMsg(null);
    const res = await rollbackBulkOperationAction(log.id);
    setBusyId(null);
    if (res.ok) {
      setResultMsg(
        res.data.applied
          ? d.rollbackApplied
          : `${d.rollbackRequested}\n${res.data.manualSteps.join("\n")}`
      );
      await load();
    } else {
      setResultMsg(`${d.rollbackFailed}：${res.error}`);
    }
  }

  if (loading) return <p className="py-10 text-center text-sm text-ink/60">…</p>;
  if (error) return <p className="text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/70">{d.description}</p>
      {resultMsg && (
        <p className="whitespace-pre-line rounded-lg border border-ink/10 bg-ink/[0.03] px-4 py-2 text-sm text-ink/80">
          {resultMsg}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-ink/60">{d.empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((log) => {
            const after = (log.after ?? {}) as Record<string, unknown>;
            const campaignName =
              typeof after.campaignName === "string" ? after.campaignName : null;
            const planId = typeof after.planId === "string" ? after.planId : null;
            return (
              <li
                key={log.id}
                className="rounded-xl border border-ink/10 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink">
                    {log.action}
                  </span>
                  <span className="text-ink/70">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                  {campaignName && <span className="font-medium text-ink">{campaignName}</span>}
                  {planId && (
                    <span className="font-mono text-xs text-ink/50">
                      plan: {planId.slice(0, 8)}
                    </span>
                  )}
                </div>
                {(log.action === "BULK_CREATE_BEFORE" || log.action === "BULK_CREATE_AFTER") && (
                  <button
                    type="button"
                    disabled={busyId === log.id}
                    onClick={() => void rollback(log)}
                    className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busyId === log.id ? "…" : d.rollback}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
