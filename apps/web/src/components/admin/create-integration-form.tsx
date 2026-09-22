"use client";

/**
 * Phase 8.4.9 — Create Integration form (token shown once).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIntegrationAction } from "@/lib/api/admin-script-actions";

export function CreateIntegrationForm(props: {
  accounts: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [googleAccountId, setGoogleAccountId] = useState(
    props.accounts[0]?.id ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [onceToken, setOnceToken] = useState<string | null>(null);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function onCreate() {
    setError(null);
    start(async () => {
      const result = await createIntegrationAction({ name, googleAccountId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOnceToken(result.data.token);
      setIntegrationId(result.data.integrationId);
    });
  }

  async function copyToken() {
    if (!onceToken) return;
    await navigator.clipboard.writeText(onceToken);
    setCopied(true);
  }

  if (onceToken && integrationId) {
    return (
      <div className="space-y-4 rounded-xl border border-amber-500/40 bg-amber-50/80 p-6">
        <h2 className="font-display text-xl font-semibold text-ink">
          Integration token (shown once)
        </h2>
        <p className="text-sm text-ink/70">
          This token will only be shown once. Store it securely. It is required
          to generate Google Ads Script source later.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-ink/5 p-3 text-sm break-all">
          {onceToken}
        </pre>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void copyToken()}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
          >
            {copied ? "Copied" : "Copy Token"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/script-integrations/${integrationId}`)}
            className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-medium text-ink"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-ink/10 bg-white/70 p-6">
      <label className="block text-sm font-medium text-ink">
        Integration Name
        <input
          className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production US Script"
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        Google Account
        <select
          className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2"
          value={googleAccountId}
          onChange={(e) => setGoogleAccountId(e.target.value)}
        >
          {props.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !name.trim() || !googleAccountId}
        onClick={onCreate}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create Integration"}
      </button>
    </div>
  );
}
