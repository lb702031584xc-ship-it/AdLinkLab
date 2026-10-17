"use client";

/**
 * P1-7 / P1-8：Google 账号行内操作 — 子账号展开 / 记录封停 / 申诉记录。
 * 申诉只记录平台侧结果，不自动申诉；封停账号不进发布流程（服务端拦截）。
 */
import { useState } from "react";
import {
  listAppealsAction,
  listSubAccountsAction,
  recordAppealAction,
  recordSuspensionAction,
} from "@/lib/api/entity-actions";
import type { GoogleAccount, GoogleAccountAppeal } from "@/lib/api/entities";

export function GoogleAccountRowActions({
  account,
  labels,
}: {
  account: GoogleAccount;
  labels: {
    subAccounts: string;
    personalOnlyNote: string;
    subAccountsEmpty: string;
    recordSuspension: string;
    suspensionReasonPlaceholder: string;
    appeals: string;
    appealRecord: string;
    appealNotePlaceholder: string;
    suspensionReason: string;
    levels: Record<string, string>;
    statuses: Record<string, string>;
  };
}) {
  const [showSubs, setShowSubs] = useState(false);
  const [subs, setSubs] = useState<GoogleAccount[] | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [showAppeals, setShowAppeals] = useState(false);
  const [appeals, setAppeals] = useState<GoogleAccountAppeal[] | null>(null);
  const [appealsError, setAppealsError] = useState<string | null>(null);
  const [suspensionReason, setSuspensionReason] = useState("");
  const [appealLevel, setAppealLevel] = useState("MCC");
  const [appealStatus, setAppealStatus] = useState("submitted");
  const [appealNote, setAppealNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isMcc = (account.accountType ?? "MCC") === "MCC";

  async function loadSubs() {
    if (showSubs) {
      setShowSubs(false);
      return;
    }
    setShowSubs(true);
    if (subs) return;
    const res = await listSubAccountsAction(account.id);
    if (res.ok) setSubs(res.data.items);
    else setSubsError(res.error);
  }

  async function loadAppeals() {
    if (showAppeals) {
      setShowAppeals(false);
      return;
    }
    setShowAppeals(true);
    if (appeals) return;
    const res = await listAppealsAction(account.id);
    if (res.ok) setAppeals(res.data.items);
    else setAppealsError(res.error);
  }

  async function submitSuspension() {
    if (!suspensionReason.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await recordSuspensionAction(account.id, suspensionReason.trim());
    setBusy(false);
    if (res.ok) {
      setMsg("✓");
      setSuspensionReason("");
    } else setMsg(res.error);
  }

  async function submitAppeal() {
    setBusy(true);
    setMsg(null);
    const res = await recordAppealAction(account.id, {
      level: appealLevel,
      status: appealStatus,
      note: appealNote.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setMsg("✓");
      setAppealNote("");
      const reloaded = await listAppealsAction(account.id);
      if (reloaded.ok) setAppeals(reloaded.data.items);
    } else setMsg(res.error);
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {isMcc ? (
          <button
            type="button"
            className="rounded border border-ink/15 bg-white px-2 py-1 text-xs text-ink hover:bg-ink/5"
            onClick={() => void loadSubs()}
          >
            {labels.subAccounts}
          </button>
        ) : (
          <span className="text-xs text-ink/50">{labels.personalOnlyNote}</span>
        )}
        <button
          type="button"
          className="rounded border border-ink/15 bg-white px-2 py-1 text-xs text-ink hover:bg-ink/5"
          onClick={() => void loadAppeals()}
        >
          {labels.appeals}
        </button>
      </div>
      {showSubs && (
        <div className="rounded border border-ink/10 bg-white p-2 text-xs text-ink/70">
          {subsError ? (
            <p className="text-red-700">{subsError}</p>
          ) : subs === null ? (
            <p>…</p>
          ) : subs.length === 0 ? (
            <p>{labels.subAccountsEmpty}</p>
          ) : (
            <ul className="space-y-0.5">
              {subs.map((s) => (
                <li key={s.id} className="font-mono">
                  {s.customerId} · {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {showAppeals && (
        <div className="space-y-2 rounded border border-ink/10 bg-white p-2 text-xs">
          {appealsError ? (
            <p className="text-red-700">{appealsError}</p>
          ) : appeals === null ? (
            <p>…</p>
          ) : appeals.length === 0 ? (
            <p className="text-ink/60">—</p>
          ) : (
            <ul className="space-y-1">
              {appeals.map((a) => (
                <li key={a.id} className="text-ink/70">
                  {labels.levels[a.level] ?? a.level} · {labels.statuses[a.status] ?? a.status}
                  {a.note ? ` · ${a.note}` : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1">
            <input
              className="w-48 rounded border border-ink/15 px-2 py-1 text-xs"
              value={suspensionReason}
              onChange={(e) => setSuspensionReason(e.target.value)}
              placeholder={labels.suspensionReasonPlaceholder}
            />
            <button
              type="button"
              disabled={busy || !suspensionReason.trim()}
              className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-700 disabled:opacity-50"
              onClick={() => void submitSuspension()}
            >
              {labels.recordSuspension}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            <select
              className="rounded border border-ink/15 bg-white px-2 py-1 text-xs"
              value={appealLevel}
              onChange={(e) => setAppealLevel(e.target.value)}
            >
              {Object.entries(labels.levels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-ink/15 bg-white px-2 py-1 text-xs"
              value={appealStatus}
              onChange={(e) => setAppealStatus(e.target.value)}
            >
              {Object.entries(labels.statuses).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              className="w-48 rounded border border-ink/15 px-2 py-1 text-xs"
              value={appealNote}
              onChange={(e) => setAppealNote(e.target.value)}
              placeholder={labels.appealNotePlaceholder}
            />
            <button
              type="button"
              disabled={busy}
              className="rounded border border-ink/15 bg-white px-2 py-1 text-xs disabled:opacity-50"
              onClick={() => void submitAppeal()}
            >
              {labels.appealRecord}
            </button>
          </div>
          {msg && <p className="text-ink/70">{msg}</p>}
        </div>
      )}
    </div>
  );
}
