"use client";

import { useEffect, useState } from "react";
import {
  getBackupStatusAction,
  type BackupStatus,
} from "@/lib/api/admin-console-actions";
import type { AdminConsoleDict } from "@/i18n/dict/admin-console";

const cardCls = "rounded-xl border border-ink/10 bg-white p-5 shadow-sm";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * 管理控制台 · 备份 tab。
 * 只读展示最近备份状态；备份触发在宿主机，页面不提供触发按钮。
 */
export function BackupStatusTab({ d }: { d: AdminConsoleDict["backup"] }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getBackupStatusAction();
      if (cancelled) return;
      setLoading(false);
      if (!s) {
        setFailed(true);
        return;
      }
      setStatus(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={cardCls}>
      <h2 className="text-lg font-semibold text-ink">{d.title}</h2>
      <p className="mt-1 text-sm text-ink/60">{d.desc}</p>
      <p className="mt-2 rounded-lg bg-ink/5 px-3 py-2 text-xs text-ink/70">
        {d.timer}
      </p>
      <p className="mt-2 rounded-lg bg-ink/5 px-3 py-2 font-mono text-xs text-ink/70">
        {d.manual}
      </p>

      <div className="mt-4">
        {loading && <p className="text-sm text-ink/50">…</p>}
        {failed && <p className="text-sm text-red-700">{d.loadError}</p>}
        {!loading && !failed && !status?.configured && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {d.notConfigured}
          </p>
        )}
        {!loading && !failed && status?.configured && (
          <>
            <p className="text-xs text-ink/50">
              {d.dir}：{status.dir ?? "—"}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
                    <th className="py-2 pr-2">{d.colId}</th>
                    <th className="py-2 pr-2">{d.colTime}</th>
                    <th className="py-2 pr-2">{d.colSize}</th>
                    <th className="py-2 pr-2">{d.colVerified}</th>
                  </tr>
                </thead>
                <tbody>
                  {status.items.map((b) => (
                    <tr key={b.id} className="border-b border-ink/5">
                      <td className="py-2 pr-2 font-mono text-xs text-ink/80">
                        {b.id}
                      </td>
                      <td className="py-2 pr-2 text-xs text-ink/60">
                        {formatTime(b.time)}
                      </td>
                      <td className="py-2 pr-2 text-ink/80">
                        {formatBytes(b.sizeBytes)}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            b.verified
                              ? "bg-green-100 text-green-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {b.verified ? d.verifiedYes : d.verifiedNo}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {status.items.length === 0 && (
                <p className="py-6 text-center text-sm text-ink/50">{d.empty}</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
