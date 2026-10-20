"use client";

/**
 * Offer 列表"申请状态"单元格：徽标 + 行内改状态（select）。
 * 申请状态会随时间变（未申请 → 已申请 → 已批准/被拒），所以必须能在列表直接改，
 * 不逼用户删了重建。改成"已申请"且尚无申请日期时，自动记今天为申请日期。
 * 状态为"被拒"（或已有备注）时可就地填/改备注（被拒原因）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOfferAction } from "@/lib/api/entity-actions";

const STATUSES = ["not_applied", "applied", "approved", "rejected"] as const;

function badgeClass(status: string): string {
  switch (status) {
    case "applied":
      return "bg-amber-100 text-amber-800 ring-amber-200";
    case "approved":
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
    case "rejected":
      return "bg-rose-100 text-rose-800 ring-rose-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

export function OfferApplicationCell({
  offerId,
  status,
  appliedAt,
  note,
  labels,
  notePlaceholder,
}: {
  offerId: string;
  status?: string | null;
  appliedAt?: string | null;
  note?: string | null;
  labels: Record<string, string>;
  notePlaceholder: string;
}) {
  const router = useRouter();
  const initial =
    status && (STATUSES as readonly string[]).includes(status) ? status : "not_applied";
  const [cur, setCur] = useState<string>(initial);
  const [noteText, setNoteText] = useState<string>(note ?? "");
  const [saving, setSaving] = useState(false);

  async function changeStatus(next: string) {
    if (next === cur || saving) return;
    const prev = cur;
    setCur(next);
    setSaving(true);
    const patch: { applicationStatus: string; appliedAt?: string } = {
      applicationStatus: next,
    };
    if (next === "applied" && !appliedAt) {
      patch.appliedAt = new Date().toISOString();
    }
    const res = await updateOfferAction(offerId, patch);
    setSaving(false);
    if (!res.ok) {
      setCur(prev);
      return;
    }
    router.refresh();
  }

  async function saveNote() {
    const trimmed = noteText.trim();
    if (trimmed === (note ?? "") || saving) return;
    setSaving(true);
    const res = await updateOfferAction(offerId, {
      applicationNote: trimmed || null,
    });
    setSaving(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex w-36 flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${badgeClass(cur)}`}
      >
        {labels[cur] ?? cur}
      </span>
      <select
        aria-label={labels[cur] ?? cur}
        className="w-full rounded border border-ink/15 bg-transparent px-1 py-0.5 text-xs text-ink/70"
        value={cur}
        disabled={saving}
        onChange={(e) => void changeStatus(e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {labels[s] ?? s}
          </option>
        ))}
      </select>
      {(cur === "rejected" || noteText) && (
        <input
          className="w-full rounded border border-ink/15 bg-transparent px-1 py-0.5 text-xs text-ink/70"
          value={noteText}
          placeholder={notePlaceholder}
          maxLength={500}
          disabled={saving}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => void saveNote()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </div>
  );
}
