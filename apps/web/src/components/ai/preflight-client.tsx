"use client";

/** P1-14：Preflight 页面 — 双类型（MCC / 个人）上线前检查。 */
import { useEffect, useState } from "react";
import { runPreflightAction } from "@/lib/api/ads-auto-actions";
import { listGoogleAccountsAction } from "@/lib/api/entity-actions";
import type { PreflightResult } from "@/lib/api/ads-auto";
import type { AdsAutoDict } from "@/i18n/dict/ads-auto";
import type { GoogleAccount } from "@/lib/api/entities";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";

function statusDot(status: string): string {
  if (status === "ok") return "bg-emerald-100 text-emerald-800";
  if (status === "warn") return "bg-amber-100 text-amber-800";
  if (status === "error") return "bg-red-100 text-red-800";
  return "bg-ink/5 text-ink/60";
}

export function PreflightClient({
  dict,
  initialAccountId,
}: {
  dict: AdsAutoDict;
  initialAccountId?: string;
}) {
  const d = dict.preflight;
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [landingUrl, setLandingUrl] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listGoogleAccountsAction().then((res) => {
      if (res.ok) {
        setAccounts(res.data.items);
        if (!initialAccountId && res.data.items.length > 0) {
          setAccountId(res.data.items[0].id);
        }
      }
    });
  }, [initialAccountId]);

  async function run() {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const budget = parseFloat(dailyBudget);
    const res = await runPreflightAction({
      accountId,
      landingUrl: landingUrl.trim() || undefined,
      dailyBudget: Number.isFinite(budget) && budget > 0 ? budget : undefined,
    });
    setBusy(false);
    if (res.ok) setResult(res.data);
    else setError(res.error);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/70">{d.description}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink/80">{d.account}</span>
          <select
            className={inputClass}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {(a.accountType ?? "MCC") === "MCC" ? "MCC" : "个人"} · {a.customerId}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink/80">{d.landingUrl}</span>
          <input
            className={inputClass}
            value={landingUrl}
            onChange={(e) => setLandingUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink/80">{d.dailyBudget}</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={dailyBudget}
            onChange={(e) => setDailyBudget(e.target.value)}
            placeholder="10"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !accountId}
        onClick={() => void run()}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50"
      >
        {busy ? d.running : d.run}
      </button>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {result && (
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-sm font-semibold text-ink">
            {result.verdict === "ready"
              ? d.verdictReady
              : result.verdict === "degraded"
                ? d.verdictDegraded
                : d.verdictBlocked}
          </p>
          <ul className="mt-3 space-y-2">
            {result.checks.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusDot(c.status)}`}>
                  {c.status}
                </span>
                <span className="font-medium text-ink">
                  {(d.checkLabels as Record<string, string>)[c.key] ?? c.key}
                </span>
                <span className="text-ink/70">{c.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
