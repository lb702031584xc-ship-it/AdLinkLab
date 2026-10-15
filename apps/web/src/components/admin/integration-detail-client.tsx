"use client";

/**
 * Phase 8.4.9 — Integration detail client (targets, script, lifecycle).
 */
import { useState, useTransition } from "react";
import type { AdminIntegration, AdminTarget } from "@/lib/api/admin-script";
import {
  attachTargetAction,
  detachTargetAction,
  deleteIntegrationAction,
  disableIntegrationAction,
  enableIntegrationAction,
  generateScriptAction,
  registerManualAdAction,
  revokeIntegrationAction,
  rotateTokenAction,
} from "@/lib/api/admin-script-actions";
import { useDict } from "@/i18n/use-dict";

export function IntegrationDetailClient(props: {
  integration: AdminIntegration;
  targets: AdminTarget[];
  ads: Array<{ id: string; name: string; googleAdId: string }>;
}) {
  const t = useDict();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [onceToken, setOnceToken] = useState<string | null>(null);
  const [scriptToken, setScriptToken] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [scriptMeta, setScriptMeta] = useState<{
    scriptVersion: string;
    apiVersion: string;
  } | null>(null);
  const [adId, setAdId] = useState(props.ads[0]?.id ?? "");
  const [copiedScript, setCopiedScript] = useState(false);
  const [showManualAd, setShowManualAd] = useState(false);
  const [manualCampaignId, setManualCampaignId] = useState("");
  const [manualCampaignName, setManualCampaignName] = useState("");
  const [manualAdGroupId, setManualAdGroupId] = useState("");
  const [manualAdGroupName, setManualAdGroupName] = useState("");
  const [manualGoogleAdId, setManualGoogleAdId] = useState("");
  const [manualAdName, setManualAdName] = useState("");
  const [manualAdDone, setManualAdDone] = useState<string | null>(null);
  const id = props.integration.integrationId;

  function run(fn: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : t.integrations.detail.actionFailed);
      }
    });
  }

  return (
    <div className="space-y-10">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold text-ink">{t.integrations.detail.overview}</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-ink/50">{t.common.misc.name}</dt>
            <dd className="font-medium">{props.integration.name}</dd>
          </div>
          <div>
            <dt className="text-ink/50">{t.common.misc.status}</dt>
            <dd className="font-medium">{props.integration.status}</dd>
          </div>
          <div>
            <dt className="text-ink/50">{t.integrations.detail.fields.googleAccount}</dt>
            <dd className="font-mono text-xs">{props.integration.googleAccountId}</dd>
          </div>
          <div>
            <dt className="text-ink/50">{t.integrations.detail.fields.tokenStatus}</dt>
            <dd>
              {props.integration.tokenStatus} · {t.integrations.detail.prefix}{" "}
              <span className="font-mono">{props.integration.tokenPrefix}…</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink/50">{t.integrations.detail.fields.lastSeen}</dt>
            <dd>{props.integration.lastSeenAt ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink/50">{t.integrations.detail.fields.targets}</dt>
            <dd>{props.integration.targetCount}</dd>
          </div>
        </dl>
        <p className="text-xs text-ink/50">
          {t.integrations.detail.scheduleNote}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm"
            onClick={() =>
              run(async () => {
                const r = await rotateTokenAction(id);
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setOnceToken(r.data.token);
                setScriptToken(r.data.token);
              })
            }
          >
            {t.integrations.detail.rotateToken}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm"
            onClick={() =>
              run(async () => {
                const r = await disableIntegrationAction(id);
                if (!r.ok) setError(r.error);
                else window.location.reload();
              })
            }
          >
            {t.integrations.detail.disable}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm"
            onClick={() =>
              run(async () => {
                const r = await enableIntegrationAction(id);
                if (!r.ok) setError(r.error);
                else window.location.reload();
              })
            }
          >
            {t.integrations.detail.enable}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-800"
            onClick={() =>
              run(async () => {
                const r = await revokeIntegrationAction(id);
                if (!r.ok) setError(r.error);
                else window.location.reload();
              })
            }
          >
            {t.integrations.detail.revoke}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-800"
            onClick={() =>
              run(async () => {
                if (!window.confirm(t.integrations.detail.deleteConfirm)) return;
                const r = await deleteIntegrationAction(id);
                if (!r.ok) setError(r.error);
                else window.location.href = "/script-integrations";
              })
            }
          >
            {t.integrations.detail.delete}
          </button>
        </div>
        {onceToken ? (
          <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm">
            <p className="font-medium">{t.integrations.detail.newTokenTitle}</p>
            <pre className="mt-2 overflow-x-auto break-all">{onceToken}</pre>
            <button
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => void navigator.clipboard.writeText(onceToken)}
            >
              {t.integrations.detail.copyToken}
            </button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold text-ink">{t.integrations.detail.targets}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            {t.integrations.detail.ad}
            <select
              className="ml-2 rounded border border-ink/15 px-2 py-1"
              value={adId}
              onChange={(e) => setAdId(e.target.value)}
            >
              {props.ads.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.googleAdId})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !adId}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
            onClick={() =>
              run(async () => {
                const r = await attachTargetAction({
                  integrationId: id,
                  entityId: adId,
                });
                if (!r.ok) setError(r.error);
                else window.location.reload();
              })
            }
          >
            {t.integrations.detail.attachAd}
          </button>
        </div>
        <div>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setShowManualAd((v) => !v)}
          >
            {t.integrations.detail.manualAdTitle}
          </button>
          <p className="mt-1 text-xs text-ink/55">
            {t.integrations.detail.manualAdHint}
          </p>
          {showManualAd ? (
            <div className="mt-2 grid gap-2 rounded-xl border border-ink/10 p-3 sm:grid-cols-2">
              <label className="text-sm">
                {t.integrations.detail.manualGoogleCampaignId} *
                <input
                  className="mt-1 w-full rounded border border-ink/15 px-2 py-1 font-mono text-xs"
                  value={manualCampaignId}
                  onChange={(e) => setManualCampaignId(e.target.value)}
                  placeholder="1234567890"
                />
              </label>
              <label className="text-sm">
                {t.integrations.detail.manualCampaignName}
                <input
                  className="mt-1 w-full rounded border border-ink/15 px-2 py-1 text-xs"
                  value={manualCampaignName}
                  onChange={(e) => setManualCampaignName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                {t.integrations.detail.manualGoogleAdGroupId} *
                <input
                  className="mt-1 w-full rounded border border-ink/15 px-2 py-1 font-mono text-xs"
                  value={manualAdGroupId}
                  onChange={(e) => setManualAdGroupId(e.target.value)}
                  placeholder="12345678901"
                />
              </label>
              <label className="text-sm">
                {t.integrations.detail.manualAdGroupName}
                <input
                  className="mt-1 w-full rounded border border-ink/15 px-2 py-1 text-xs"
                  value={manualAdGroupName}
                  onChange={(e) => setManualAdGroupName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                {t.integrations.detail.manualGoogleAdId} *
                <input
                  className="mt-1 w-full rounded border border-ink/15 px-2 py-1 font-mono text-xs"
                  value={manualGoogleAdId}
                  onChange={(e) => setManualGoogleAdId(e.target.value)}
                  placeholder="123456789012"
                />
              </label>
              <label className="text-sm">
                {t.integrations.detail.manualAdName} *
                <input
                  className="mt-1 w-full rounded border border-ink/15 px-2 py-1 text-xs"
                  value={manualAdName}
                  onChange={(e) => setManualAdName(e.target.value)}
                />
              </label>
              <div className="flex items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  disabled={
                    pending ||
                    !manualCampaignId.trim() ||
                    !manualAdGroupId.trim() ||
                    !manualGoogleAdId.trim() ||
                    !manualAdName.trim()
                  }
                  className="rounded-lg bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
                  onClick={() =>
                    run(async () => {
                      const r = await registerManualAdAction({
                        integrationId: id,
                        googleCampaignId: manualCampaignId,
                        campaignName: manualCampaignName || undefined,
                        googleAdGroupId: manualAdGroupId,
                        adGroupName: manualAdGroupName || undefined,
                        googleAdId: manualGoogleAdId,
                        adName: manualAdName,
                      });
                      if (!r.ok) {
                        setError(r.error);
                        return;
                      }
                      setManualAdDone(r.data.name);
                      window.location.reload();
                    })
                  }
                >
                  {t.integrations.detail.manualRegisterAd}
                </button>
                {manualAdDone ? (
                  <span className="text-sm text-emerald-700">
                    {t.integrations.detail.manualRegistered}：{manualAdDone}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-xl border border-ink/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-ink/5 text-ink/60">
              <tr>
                <th className="px-3 py-2">{t.integrations.detail.columns.googleAdId}</th>
                <th className="px-3 py-2">{t.integrations.detail.columns.desired}</th>
                <th className="px-3 py-2">{t.integrations.detail.columns.applied}</th>
                <th className="px-3 py-2">{t.integrations.detail.columns.sync}</th>
                <th className="px-3 py-2">{t.integrations.detail.columns.health}</th>
                <th className="px-3 py-2">{t.integrations.detail.columns.lastExec}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {props.targets.map((target) => (
                <tr key={target.targetId} className="border-t border-ink/10">
                  <td className="px-3 py-2 font-mono text-xs">{target.googleAdId}</td>
                  <td className="px-3 py-2">{target.desiredVersion ?? "—"}</td>
                  <td className="px-3 py-2">{target.appliedVersion ?? "—"}</td>
                  <td className="px-3 py-2">{target.syncState}</td>
                  <td className="px-3 py-2">{target.connectionHealth}</td>
                  <td className="px-3 py-2">{target.lastExecution ?? "—"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const r = await detachTargetAction({
                            integrationId: id,
                            targetId: target.targetId,
                          });
                          if (!r.ok) setError(r.error);
                          else window.location.reload();
                        })
                      }
                    >
                      {t.integrations.detail.detach}
                    </button>
                  </td>
                </tr>
              ))}
              {props.targets.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-ink/50" colSpan={7}>
                    {t.integrations.detail.noTargets}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold text-ink">
          {t.integrations.detail.scriptTitle}
        </h2>
        <p className="text-sm text-ink/70">
          {t.integrations.detail.scriptIntegration}: <strong>{props.integration.name}</strong> · {t.integrations.detail.scriptStatus}:{" "}
          {props.integration.status}
          {scriptMeta ? t.integrations.detail.scriptVersion(scriptMeta.scriptVersion) : ""}
        </p>
        <label className="block text-sm">
          {t.integrations.detail.tokenLabel}
          <input
            type="password"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-ink/15 px-3 py-2 font-mono text-sm"
            value={scriptToken}
            onChange={(e) => setScriptToken(e.target.value)}
            placeholder="alk_s_…"
          />
        </label>
        <button
          type="button"
          disabled={pending || !scriptToken.trim()}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          onClick={() =>
            run(async () => {
              const r = await generateScriptAction({
                integrationId: id,
                token: scriptToken.trim(),
              });
              if (!r.ok) {
                setError(r.error);
                return;
              }
              setSource(r.data.source);
              setScriptMeta({
                scriptVersion: r.data.scriptVersion,
                apiVersion: r.data.apiVersion,
              });
              setCopiedScript(false);
            })
          }
        >
          {t.integrations.detail.generateScript}
        </button>
        {source ? (
          <div className="space-y-2">
            <p className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {t.integrations.detail.securityNotice}
            </p>
            <textarea
              readOnly
              className="h-80 w-full rounded-xl border border-ink/10 bg-ink/[0.03] p-3 font-mono text-xs"
              value={source}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(source);
                  setCopiedScript(true);
                }}
              >
                {copiedScript ? t.common.actions.copied : t.integrations.detail.copyScript}
              </button>
              <button
                type="button"
                className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm"
                onClick={() => {
                  setSource(null);
                  setScriptMeta(null);
                }}
              >
                {t.integrations.detail.clear}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
