"use client";

/**
 * One-time plaintext key box: shown exactly once after create/rotate.
 * The key lives only in this component's state — never persisted.
 */
import { useState } from "react";
import type { AdminApiKeysDict } from "@/i18n/dict/admin-api-keys";

export function OneTimeKeyBox({
  keyValue,
  t,
  onDismiss,
}: {
  keyValue: string;
  t: AdminApiKeysDict;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(keyValue);
      setCopied(true);
    } catch {
      // Clipboard unavailable — the key is still visible for manual copy.
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
      <p className="text-sm font-semibold text-amber-900">
        {t.oneTimeKey.title}
      </p>
      <p className="mt-1 text-xs text-amber-800">{t.oneTimeKey.warning}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-ink">
          {keyValue}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink/85"
        >
          {copied ? t.oneTimeKey.copied : t.oneTimeKey.copy}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-ink/5"
        >
          {t.oneTimeKey.dismiss}
        </button>
      </div>
    </div>
  );
}
