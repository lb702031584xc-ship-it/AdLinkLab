"use client";

/**
 * Admin "create API key" form (name / scopes / IP whitelist / expiry).
 * On success the plaintext key is shown once in OneTimeKeyBox.
 */
import { useRef, useState, type FormEvent } from "react";
import { createApiKeyAction } from "@/lib/api/api-keys-actions";
import type { AdminApiKeysDict } from "@/i18n/dict/admin-api-keys";
import { OneTimeKeyBox } from "./one-time-key-box";

export function CreateApiKeyForm({ t }: { t: AdminApiKeysDict }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rawExpiry = String(fd.get("expiresAt") ?? "");
    setPending(true);
    setError(null);
    setOneTimeKey(null);
    const result = await createApiKeyAction({
      name: String(fd.get("name") ?? ""),
      scopes: String(fd.get("scopes") ?? ""),
      ipWhitelist: String(fd.get("ipWhitelist") ?? ""),
      // datetime-local has no timezone: convert to ISO on the client.
      expiresAt: rawExpiry ? new Date(rawExpiry).toISOString() : "",
    });
    setPending(false);
    if (result.ok) {
      setOneTimeKey(result.key);
      formRef.current?.reset();
    } else {
      setError(result.error);
    }
  }

  const input =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

  return (
    <div className="mb-8 rounded-2xl border border-ink/10 bg-white p-5">
      <h2 className="text-base font-semibold text-ink">
        {t.createForm.title}
      </h2>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.name}
          </span>
          <input
            name="name"
            type="text"
            required
            autoComplete="off"
            placeholder={t.createForm.namePlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.expiresAt}
          </span>
          <input name="expiresAt" type="datetime-local" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.scopes}
          </span>
          <input
            name="scopes"
            type="text"
            autoComplete="off"
            placeholder={t.createForm.scopesPlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.ipWhitelist}
          </span>
          <input
            name="ipWhitelist"
            type="text"
            autoComplete="off"
            placeholder={t.createForm.ipWhitelistPlaceholder}
            className={input}
          />
          <span className="mt-1 block text-xs text-ink/50">
            {t.createForm.ipWhitelistHint}
          </span>
        </label>
      </form>
      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {oneTimeKey ? (
        <OneTimeKeyBox
          keyValue={oneTimeKey}
          t={t}
          onDismiss={() => setOneTimeKey(null)}
        />
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => formRef.current?.requestSubmit()}
        className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending ? t.createForm.submitting : t.createForm.submit}
      </button>
    </div>
  );
}
