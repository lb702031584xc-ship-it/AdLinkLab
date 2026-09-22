"use client";

/**
 * Phase 8.4.9 — Integration detail client (targets, script, lifecycle).
 */
import { useState, useTransition } from "react";
import type { AdminIntegration, AdminTarget } from "@/lib/api/admin-script";
import {
  attachTargetAction,
  detachTargetAction,
  disableIntegrationAction,
  enableIntegrationAction,
  generateScriptAction,
  revokeIntegrationAction,
  rotateTokenAction,
} from "@/lib/api/admin-script-actions";

const SECURITY_NOTICE =
  "This script contains an integration credential. Store it securely and do not share it publicly.";

export function IntegrationDetailClient(props: {
  integration: AdminIntegration;
  targets: AdminTarget[];
  ads: Array<{ id: string; name: string; googleAdId: string }>;
}) {
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
  const id = props.integration.integrationId;

  function run(fn: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
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
        <h2 className="font-display text-2xl font-semibold text-ink">Overview</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-ink/50">Name</dt>
            <dd className="font-medium">{props.integration.name}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Status</dt>
            <dd className="font-medium">{props.integration.status}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Google Account</dt>
            <dd className="font-mono text-xs">{props.integration.googleAccountId}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Token status</dt>
            <dd>
              {props.integration.tokenStatus} · prefix{" "}
              <span className="font-mono">{props.integration.tokenPrefix}…</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink/50">Last seen</dt>
            <dd>{props.integration.lastSeenAt ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Targets</dt>
            <dd>{props.integration.targetCount}</dd>
          </div>
        </dl>
        <p className="text-xs text-ink/50">
          Script execution schedule is controlled in Google Ads Scripts — this
          lab does not invent a next-execution time.
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
            Rotate Token
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
            Disable
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
            Enable
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
            Revoke
          </button>
        </div>
        {onceToken ? (
          <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm">
            <p className="font-medium">New token (shown once)</p>
            <pre className="mt-2 overflow-x-auto break-all">{onceToken}</pre>
            <button
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => void navigator.clipboard.writeText(onceToken)}
            >
              Copy Token
            </button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold text-ink">Targets</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Ad
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
            Attach Ad
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-ink/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-ink/5 text-ink/60">
              <tr>
                <th className="px-3 py-2">Google Ad ID</th>
                <th className="px-3 py-2">Desired</th>
                <th className="px-3 py-2">Applied</th>
                <th className="px-3 py-2">Sync</th>
                <th className="px-3 py-2">Health</th>
                <th className="px-3 py-2">Last exec</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {props.targets.map((t) => (
                <tr key={t.targetId} className="border-t border-ink/10">
                  <td className="px-3 py-2 font-mono text-xs">{t.googleAdId}</td>
                  <td className="px-3 py-2">{t.desiredVersion ?? "—"}</td>
                  <td className="px-3 py-2">{t.appliedVersion ?? "—"}</td>
                  <td className="px-3 py-2">{t.syncState}</td>
                  <td className="px-3 py-2">{t.connectionHealth}</td>
                  <td className="px-3 py-2">{t.lastExecution ?? "—"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const r = await detachTargetAction({
                            integrationId: id,
                            targetId: t.targetId,
                          });
                          if (!r.ok) setError(r.error);
                          else window.location.reload();
                        })
                      }
                    >
                      Detach
                    </button>
                  </td>
                </tr>
              ))}
              {props.targets.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-ink/50" colSpan={7}>
                    No targets attached.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold text-ink">
          Google Ads Script
        </h2>
        <p className="text-sm text-ink/70">
          Integration: <strong>{props.integration.name}</strong> · Status:{" "}
          {props.integration.status}
          {scriptMeta ? ` · Version ${scriptMeta.scriptVersion}` : ""}
        </p>
        <label className="block text-sm">
          Integration token (from create/rotate — kept in memory only)
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
          Generate Script
        </button>
        {source ? (
          <div className="space-y-2">
            <p className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {SECURITY_NOTICE}
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
                {copiedScript ? "Copied" : "Copy Script"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm"
                onClick={() => {
                  setSource(null);
                  setScriptMeta(null);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
