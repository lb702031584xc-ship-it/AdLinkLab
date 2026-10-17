"use client";

/**
 * 测试止损配置区（第七批）：Offer 详情页下方。
 * 花费上限 / X 花费零转化 → 触发后自动暂停并站内通知（复用既有 kill-switch 引擎）。
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  getKillSwitchAction,
  getTestSpendAction,
  saveKillSwitchAction,
  type TestSpendData,
} from "@/lib/api/kill-switch-actions";

export function TestStopLossSection({ offerId }: { offerId: string }) {
  const { t } = useI18n();
  const d = t.entities.offers.testStopLoss;
  const [enabled, setEnabled] = useState(false);
  const [cap, setCap] = useState("");
  const [zeroConv, setZeroConv] = useState("");
  const [pauseGoogleAdsToo, setPauseGoogleAdsToo] = useState(false);
  const [snap, setSnap] = useState<TestSpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [cfg, spend] = await Promise.all([
        getKillSwitchAction(offerId),
        getTestSpendAction(offerId),
      ]);
      if (cancelled) return;
      if (cfg.ok) {
        setEnabled(cfg.data.enabled);
        setCap(cfg.data.testSpendCap != null ? String(cfg.data.testSpendCap) : "");
        setZeroConv(
          cfg.data.testZeroConvSpend != null ? String(cfg.data.testZeroConvSpend) : ""
        );
        setPauseGoogleAdsToo(cfg.data.pauseGoogleAdsToo ?? false);
      } else {
        setErr(cfg.error);
      }
      if (spend.ok) setSnap(spend.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  async function onSave() {
    // P0-10: opting into Google Ads pausing needs a second confirmation —
    // firing the kill-switch will pause real Google Ads campaigns.
    if (pauseGoogleAdsToo && !window.confirm(d.pauseGoogleAdsConfirm)) {
      return;
    }
    setSaving(true);
    setMsg(null);
    const capNum = cap.trim() === "" ? null : Number(cap);
    const zeroNum = zeroConv.trim() === "" ? null : Number(zeroConv);
    if (
      (capNum !== null && !(capNum > 0)) ||
      (zeroNum !== null && !(zeroNum > 0))
    ) {
      setSaving(false);
      setMsg(d.saveFailed + d.spendCap);
      return;
    }
    const res = await saveKillSwitchAction(offerId, {
      enabled,
      testSpendCap: capNum,
      testZeroConvSpend: zeroNum,
      pauseGoogleAdsToo,
    });
    setSaving(false);
    if (!res.ok) {
      setMsg(d.saveFailed + res.error);
      return;
    }
    const spend = await getTestSpendAction(offerId);
    if (spend.ok) setSnap(spend.data);
    setMsg(d.saved);
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-ink/10 bg-white p-5 text-sm text-ink/60">
        {d.saving}
      </div>
    );
  }

  const spendVal = snap?.spend;
  const capNum = cap.trim() === "" ? null : Number(cap);
  const progress =
    spendVal != null && capNum != null && capNum > 0
      ? Math.min(100, (spendVal / capNum) * 100)
      : null;

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-5">
      <h3 className="text-base font-semibold text-ink">{d.sectionTitle}</h3>
      <p className="mt-1 text-sm text-ink/60">{d.sectionDesc}</p>
      {err && <p className="mt-2 text-sm text-red-600">{d.loadError}: {err}</p>}

      <div className="mt-4 space-y-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          {d.enabled}
        </label>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={pauseGoogleAdsToo}
            onChange={(e) => setPauseGoogleAdsToo(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            {d.pauseGoogleAdsToo}
            <span className="mt-0.5 block text-xs text-ink/50">
              {d.pauseGoogleAdsHint}
            </span>
          </span>
        </label>

        <div>
          <label className="block text-sm font-medium text-ink">{d.spendCap}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            placeholder="30"
            className="mt-1 w-48 rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink/50">{d.spendCapHint}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">{d.zeroConvSpend}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={zeroConv}
            onChange={(e) => setZeroConv(e.target.value)}
            placeholder="30"
            className="mt-1 w-48 rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink/50">{d.zeroConvHint}</p>
        </div>

        <div>
          <div className="text-sm text-ink/70">
            {d.spent}:{" "}
            <span className="font-semibold">
              {spendVal != null ? `$${spendVal.toFixed(2)}` : d.noSpendData}
            </span>
            {snap?.conversions != null && (
              <span className="ml-3">
                {d.conversions}: <span className="font-semibold">{snap.conversions}</span>
              </span>
            )}
          </div>
          {progress != null && (
            <div className="mt-2 h-2.5 w-full max-w-md overflow-hidden rounded-full bg-ink/10">
              <div
                className={`h-full rounded-full ${progress >= 100 ? "bg-red-500" : "bg-signal"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? d.saving : d.save}
        </button>
        {msg && <p className="text-sm text-ink/70">{msg}</p>}
      </div>
    </div>
  );
}
