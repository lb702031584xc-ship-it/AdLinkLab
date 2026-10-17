"use client";

/**
 * Per-row rotate / revoke buttons for the admin API keys table.
 * Rotate shows the new plaintext key once, inline under the row.
 */
import { useState } from "react";
import {
  rotateApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyStatus,
} from "@/lib/api/api-keys-actions";
import type { AdminApiKeysDict } from "@/i18n/dict/admin-api-keys";
import { OneTimeKeyBox } from "./one-time-key-box";

type Phase = "idle" | "confirmRotate" | "rotating" | "confirmRevoke" | "revoking";

export function ApiKeyRowActions({
  keyId,
  status,
  t,
}: {
  keyId: string;
  status: ApiKeyStatus;
  t: AdminApiKeysDict;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);

  const isTerminal = status === "revoked" || status === "expired";

  async function doRotate() {
    setPhase("rotating");
    setError(null);
    const result = await rotateApiKeyAction(keyId);
    if (result.ok) {
      setOneTimeKey(result.key);
      setPhase("idle");
    } else {
      setPhase("idle");
      setError(result.error);
    }
  }

  async function doRevoke() {
    setPhase("revoking");
    setError(null);
    const result = await revokeApiKeyAction(keyId);
    if (!result.ok) {
      setPhase("idle");
      setError(result.error);
    }
    // On success the page revalidates and the row shows as revoked.
  }

  if (oneTimeKey) {
    return (
      <OneTimeKeyBox
        keyValue={oneTimeKey}
        t={t}
        onDismiss={() => setOneTimeKey(null)}
      />
    );
  }

  if (phase === "confirmRotate" || phase === "rotating") {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="max-w-52 text-[11px] text-ink/60">
          {t.rowActions.rotateConfirmTitle}
        </span>
        <span className="inline-flex gap-2">
          <button
            type="button"
            disabled={phase === "rotating"}
            onClick={doRotate}
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink/85 disabled:opacity-50"
          >
            {phase === "rotating" ? t.rowActions.rotating : t.rowActions.rotateConfirm}
          </button>
          <button
            type="button"
            disabled={phase === "rotating"}
            onClick={() => setPhase("idle")}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-ink/5 disabled:opacity-50"
          >
            {t.rowActions.cancel}
          </button>
        </span>
        {error ? (
          <span className="max-w-52 text-[11px] text-red-700">{error}</span>
        ) : null}
      </span>
    );
  }

  if (phase === "confirmRevoke" || phase === "revoking") {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="max-w-52 text-[11px] text-ink/60">
          {t.rowActions.revokeConfirmTitle}
        </span>
        <span className="inline-flex gap-2">
          <button
            type="button"
            disabled={phase === "revoking"}
            onClick={doRevoke}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {phase === "revoking" ? t.rowActions.revoking : t.rowActions.revokeConfirm}
          </button>
          <button
            type="button"
            disabled={phase === "revoking"}
            onClick={() => setPhase("idle")}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-ink/5 disabled:opacity-50"
          >
            {t.rowActions.cancel}
          </button>
        </span>
        {error ? (
          <span className="max-w-52 text-[11px] text-red-700">{error}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex gap-2">
        <button
          type="button"
          disabled={isTerminal}
          onClick={() => setPhase("confirmRotate")}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-ink/5 disabled:opacity-50"
        >
          {t.rowActions.rotate}
        </button>
        <button
          type="button"
          disabled={isTerminal}
          onClick={() => setPhase("confirmRevoke")}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
        >
          {t.rowActions.revoke}
        </button>
      </span>
      {error ? (
        <span className="max-w-52 text-[11px] text-red-700">{error}</span>
      ) : null}
    </span>
  );
}
