"use client";

import { useEffect, useState } from "react";
import {
  listCatalogNetworksAction,
  type CatalogNetwork,
} from "@/lib/api/catalog-actions";
import {
  SessionCredentialsModal,
  type SessionCredentialsModeDict,
} from "@/components/catalog/session-credentials-modal";
import type { AdminConsoleDict } from "@/i18n/dict/admin-console";

const cardCls = "rounded-xl border border-ink/10 bg-white p-5 shadow-sm";
const btnGhost =
  "rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";

/**
 * 管理控制台 · 登录账号 tab。
 * 联盟网络登录态账号统一管理（从 /catalog 搬过来，复用同一弹窗组件与同一后端接口）。
 * 安全口径：密码只写不读，GET 永不回显。
 */
export function SessionAccountsTab({
  d,
  mode,
}: {
  d: AdminConsoleDict["accounts"];
  mode: SessionCredentialsModeDict;
}) {
  const [networks, setNetworks] = useState<CatalogNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<{
    networkId: string;
    networkName: string;
    initialUsername: string;
    initialValidDays: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listCatalogNetworksAction();
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error || d.loadError);
        return;
      }
      setNetworks(res.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [d.loadError]);

  function onSaved(
    networkId: string,
    patch: {
      sessionUsername: string | null;
      sessionPasswordSet: boolean;
      sessionValidDays: number;
      lastLoginAt: string;
      sessionExpiresAt: string;
    }
  ) {
    setNetworks((ns) =>
      ns.map((n) =>
        n.id === networkId
          ? {
              ...n,
              sessionUsername: patch.sessionUsername,
              sessionPasswordSet:
                patch.sessionPasswordSet || n.sessionPasswordSet === true,
              sessionValidDays: patch.sessionValidDays,
              lastLoginAt: patch.lastLoginAt,
              sessionExpiresAt: patch.sessionExpiresAt,
            }
          : n
      )
    );
  }

  return (
    <section className={cardCls}>
      <h2 className="text-lg font-semibold text-ink">{d.title}</h2>
      <p className="mt-1 text-sm text-ink/60">{d.desc}</p>
      {msg && <p className="mt-2 text-sm text-ink/80">{msg}</p>}

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-ink/50">…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!loading && !error && networks.length === 0 && (
          <p className="text-sm text-ink/50">{d.empty}</p>
        )}
        {networks.map((n) => (
          <div
            key={n.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 p-4"
          >
            <div className="min-w-0">
              <p className="font-medium text-ink">{n.name}</p>
              <p className="mt-1 text-xs text-ink/60">
                {d.networkKind}：{n.kind} · {d.username}：
                {n.sessionUsername?.trim() || d.notSet} · {d.password}：
                {n.sessionPasswordSet ? d.passwordSet : d.notSet} ·{" "}
                {d.validDays}：{n.sessionValidDays ?? 30}
                {n.sessionExpiresAt && (
                  <>
                    {" "}· {d.expiresAt}：
                    {new Date(n.sessionExpiresAt).toLocaleString()}
                  </>
                )}
              </p>
            </div>
            <button
              className={btnGhost}
              style={{ whiteSpace: "nowrap" }}
              onClick={() =>
                setModal({
                  networkId: n.id,
                  networkName: n.name,
                  initialUsername: n.sessionUsername ?? "",
                  initialValidDays: n.sessionValidDays ?? 30,
                })
              }
            >
              {d.set}
            </button>
          </div>
        ))}
      </div>

      {modal && (
        <SessionCredentialsModal
          d={mode}
          networkId={modal.networkId}
          networkName={modal.networkName}
          initialUsername={modal.initialUsername}
          initialValidDays={modal.initialValidDays}
          onClose={() => setModal(null)}
          onSaved={(patch) => onSaved(modal.networkId, patch)}
          showMsg={setMsg}
        />
      )}
    </section>
  );
}
