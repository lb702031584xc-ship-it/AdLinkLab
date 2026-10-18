"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminGrantsClient } from "./admin-grants-client";
import { SessionAccountsTab } from "./session-accounts-tab";
import { BackupStatusTab } from "./backup-status-tab";
import type { SessionCredentialsModeDict } from "@/components/catalog/session-credentials-modal";
import type { AdminConsoleDict } from "@/i18n/dict/admin-console";

type TabId = "accounts" | "grants" | "backup" | "others";

const TABS: TabId[] = ["accounts", "grants", "backup", "others"];

const cardCls = "rounded-xl border border-ink/10 bg-white p-5 shadow-sm";

/**
 * 管理控制台（仅管理员）：登录账号 / 权限审批 / 备份 / 其他管理。
 */
export function AdminConsoleClient({
  d,
  mode,
  initialTab,
}: {
  d: AdminConsoleDict;
  mode: SessionCredentialsModeDict;
  initialTab: TabId;
}) {
  const [tab, setTab] = useState<TabId>(
    TABS.includes(initialTab) ? initialTab : "accounts"
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{d.title}</h1>
        <p className="mt-2 text-sm text-ink/60">{d.desc}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t
                ? "bg-signal text-white"
                : "bg-ink/5 text-ink/70 hover:bg-ink/10"
            }`}
          >
            {d.tabs[t]}
          </button>
        ))}
      </div>

      {tab === "accounts" && <SessionAccountsTab d={d.accounts} mode={mode} />}

      {tab === "grants" && (
        <section className={cardCls}>
          <AdminGrantsClient />
        </section>
      )}

      {tab === "backup" && <BackupStatusTab d={d.backup} />}

      {tab === "others" && (
        <section className={cardCls}>
          <h2 className="text-lg font-semibold text-ink">{d.others.title}</h2>
          <p className="mt-1 text-sm text-ink/60">{d.others.desc}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {d.others.cards.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-lg border border-ink/10 p-4 transition hover:border-signal hover:bg-ink/[0.02]"
              >
                <p className="font-medium text-ink">
                  {c.title} <span className="text-signal">→</span>
                </p>
                <p className="mt-1 text-sm text-ink/60">{c.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
