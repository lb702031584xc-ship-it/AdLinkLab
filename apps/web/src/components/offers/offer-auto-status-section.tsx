"use client";

import { useEffect, useState } from "react";
import {
  getOfferPreferencesAction,
  updateOfferPreferencesAction,
  checkOfferAutoStatusAction,
} from "@/lib/api/offer-preference-actions";

/**
 * P1-6：Offer 自动状态联动设置（Offer 详情页区块）。
 * 默认关闭 = 只给建议；显式开启后，零表现才自动暂停（ROAS 下滑永不自动暂停）。
 * 开启即视为“已明确确认自动暂停”，保存时需二次确认。
 */
export interface OfferAutoStatusDict {
  title: string;
  desc: string;
  enable: string;
  enableConfirm: string;
  zeroPerfDays: string;
  roscDeclineDays: string;
  save: string;
  saving: string;
  check: string;
  checking: string;
  saved: string;
  checkResult: string;
}

export function OfferAutoStatusSection({
  offerId,
  dict,
}: {
  offerId: string;
  dict: OfferAutoStatusDict;
}) {
  const [prefs, setPrefs] = useState({ autoStatusEnabled: false, zeroPerfDays: 5, roscDeclineDays: 7 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await getOfferPreferencesAction(offerId);
      if (res.ok) {
        setPrefs({
          autoStatusEnabled: res.data.autoStatusEnabled,
          zeroPerfDays: res.data.zeroPerfDays,
          roscDeclineDays: res.data.roscDeclineDays,
        });
      }
      setLoading(false);
    })();
  }, [offerId]);

  async function onSave() {
    if (prefs.autoStatusEnabled && !window.confirm(dict.enableConfirm)) return;
    setSaving(true);
    setMsg(null);
    const res = await updateOfferPreferencesAction(offerId, prefs);
    setSaving(false);
    setMsg(res.ok ? dict.saved : res.error);
  }

  async function onCheck() {
    setChecking(true);
    setMsg(null);
    const res = await checkOfferAutoStatusAction(offerId);
    setChecking(false);
    setMsg(
      res.ok
        ? `${dict.checkResult}：${res.data.suggestion} — ${res.data.reason}${res.data.willAutoPause ? "（将自动暂停）" : ""}`
        : res.error
    );
  }

  if (loading) return <p className="text-sm text-ink/50">…</p>;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink/70">{dict.desc}</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={prefs.autoStatusEnabled}
          onChange={(e) => setPrefs((p) => ({ ...p, autoStatusEnabled: e.target.checked }))}
        />
        {dict.enable}
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          {dict.zeroPerfDays}
          <input
            type="number"
            min={1}
            max={30}
            value={prefs.zeroPerfDays}
            onChange={(e) => setPrefs((p) => ({ ...p, zeroPerfDays: Number(e.target.value) }))}
            className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1.5"
          />
        </label>
        <label className="flex items-center gap-2">
          {dict.roscDeclineDays}
          <input
            type="number"
            min={1}
            max={30}
            value={prefs.roscDeclineDays}
            onChange={(e) => setPrefs((p) => ({ ...p, roscDeclineDays: Number(e.target.value) }))}
            className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1.5"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
        >
          {saving ? dict.saving : dict.save}
        </button>
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {checking ? dict.checking : dict.check}
        </button>
      </div>
      {msg ? <p className="text-ink/70">{msg}</p> : null}
    </div>
  );
}
