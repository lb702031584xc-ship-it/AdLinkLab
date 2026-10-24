"use client";

/**
 * 直链速测 — 粘终链 → 生成速测计划 → confirm → upgrade 全流程（client widget）。
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the direct-test server actions only.
 * 速测计划存内存、2h TTL；过期后 confirm / upgrade 会返回 410，需重新生成。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmDirectTestPlanAction,
  createDirectTestPlanAction,
  upgradeDirectTestPlanAction,
  type DirectTestConfirmed,
  type DirectTestCreated,
  type DirectTestUpgraded,
} from "@/lib/api/direct-test-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";

export function DirectTestFlow() {
  const router = useRouter();
  const [finalUrl, setFinalUrl] = useState("");
  const [offerId, setOfferId] = useState("");
  const [googleAccountId, setGoogleAccountId] = useState("");
  const [landingPageId, setLandingPageId] = useState("");
  const [created, setCreated] = useState<DirectTestCreated | null>(null);
  const [confirmed, setConfirmed] = useState<DirectTestConfirmed | null>(null);
  const [upgraded, setUpgraded] = useState<DirectTestUpgraded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!finalUrl.trim()) {
      setError("请粘贴终链。");
      return;
    }
    setBusy(true);
    try {
      const res = await createDirectTestPlanAction({
        finalUrl: finalUrl.trim(),
        offerId: offerId.trim() || undefined,
        googleAccountId: googleAccountId.trim() || undefined,
      });
      if (res.ok) {
        setCreated(res.data);
        setConfirmed(null);
        setUpgraded(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!created) return;
    setError(null);
    setBusy(true);
    try {
      const res = await confirmDirectTestPlanAction(created.planId);
      if (res.ok) {
        setConfirmed(res.data);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpgrade() {
    if (!created) return;
    setError(null);
    if (!landingPageId.trim()) {
      setError("请填写要关联的落地页 ID。");
      return;
    }
    setBusy(true);
    try {
      const res = await upgradeDirectTestPlanAction(
        created.planId,
        landingPageId.trim()
      );
      if (res.ok) {
        setUpgraded(res.data);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "升级失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-ink/10 bg-white p-5">
      <h2 className="text-base font-semibold text-ink">直链速测流程</h2>
      <p className="mt-1 text-xs text-ink/60">
        跳过落地页步骤的轻量计划：粘终链 → 生成速测计划 → confirm 建
        create-campaign Script 任务 → 有落地页后一键升级关联。计划 2 小时过期，过期需重新生成。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>终链（最终网址）</label>
          <input className={inputClass} value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://merchant.example/offer" />
        </div>
        <div>
          <label className={labelClass}>Offer ID（可选）</label>
          <input className={inputClass} value={offerId} onChange={(e) => setOfferId(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Google 账号 ID（可选）</label>
          <input className={inputClass} value={googleAccountId} onChange={(e) => setGoogleAccountId(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "生成中…" : "生成速测计划"}
          </button>
        </div>
      </form>

      {created && (
        <div className="mt-5 space-y-3 rounded-lg bg-ink/5 px-4 py-3 text-sm">
          <p>计划 ID：<span className="font-mono">{created.planId}</span>（状态：{created.plan.status}）</p>
          <p>建议系列名：<span className="font-medium">{created.suggestedCampaignName}</span></p>
          <p>最终网址：<span className="font-mono break-all">{created.finalUrl}</span></p>
          <p className="text-xs text-ink/60">有效期 2 小时（{created.expiresInSeconds} 秒）。</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Confirm（建 Script 任务）
            </button>
          </div>
          {confirmed && (
            <div className="space-y-1">
              <p>
                已确认：任务类型 <span className="font-mono">{confirmed.taskType}</span>，状态 {confirmed.status}
                {confirmed.alreadyQueued ? "（此前已排队，返回已有任务）" : ""}，Target ID：
                <span className="font-mono">{confirmed.targetId}</span>
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <input
              className="w-72 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
              value={landingPageId}
              onChange={(e) => setLandingPageId(e.target.value)}
              placeholder="落地页 ID"
            />
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={busy}
              className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              一键升级（关联落地页）
            </button>
          </div>
          {upgraded && (
            <div className="space-y-1">
              <p>
                已升级：landingPageLinked={String(upgraded.landingPageLinked)}，landingPageId：
                <span className="font-mono">{upgraded.landingPageId}</span>
              </p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {upgraded.scriptSyncNote}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
