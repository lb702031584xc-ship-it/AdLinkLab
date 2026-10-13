"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  checkUrlsAction,
  saveAiSettingsAction,
} from "@/lib/api/ai-actions";
import type { AiUrlCheckResult, UrlCheckVerdict } from "@/lib/api/ai";
import { CapturePicker } from "@/components/ai/capture-picker";

const MAX_URLS = 20;

function verdictBadge(v: UrlCheckVerdict): string {
  if (v === "owned") return "bg-green-100 text-green-800";
  if (v === "affiliate_direct") return "bg-red-100 text-red-800";
  if (v === "suspicious") return "bg-amber-100 text-amber-800";
  return "bg-ink/10 text-ink/60";
}

export function ComplianceClient({
  isAdmin,
  initialOwnedDomains,
  hideHeader,
  onResult,
}: {
  isAdmin: boolean;
  initialOwnedDomains: string[];
  /** Worksheet embedding: hide the page header (the step card provides it). */
  hideHeader?: boolean;
  /** Worksheet embedding: report check results upward. */
  onResult?: (r: AiUrlCheckResult[] | null) => void;
}) {
  const t = useDict();
  const d = t.ai.compliance;
  const [urlsText, setUrlsText] = useState("");
  const [domains, setDomains] = useState(initialOwnedDomains.join(", "));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AiUrlCheckResult[] | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  function parseDomains(raw: string): string[] {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const urls = urlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setError(d.needInput);
      return;
    }
    if (urls.length > MAX_URLS) {
      setError(d.maxUrls);
      return;
    }
    const ownedDomains = parseDomains(domains);
    setError(null);
    setChecking(true);
    try {
      const res = await checkUrlsAction(urls, ownedDomains);
      if (res.ok) {
        setResults(res.data.results);
        onResult?.(res.data.results);
        // Admins persist owned domains to AI settings; members use them per-check only.
        if (isAdmin) {
          await saveAiSettingsAction({ ownedDomains });
        }
      } else {
        setError(res.error);
      }
    } finally {
      setChecking(false);
    }
  }

  function reset() {
    setResults(null);
    setError(null);
    onResult?.(null);
  }

  return (
    <div>
      {hideHeader ? null : (
        <EntityPageHeader title={d.title} description={d.description} />
      )}

      <div className="mt-6 rounded-xl border border-signal/25 bg-signal/5 p-5">
        <p className="text-sm font-semibold text-ink">{d.explainerTitle}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          {d.explainerBody}
        </p>
      </div>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {results ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={reset}
            className="mb-4 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {d.recheck}
          </button>
          <h3 className="text-sm font-semibold text-ink">{d.resultTitle}</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">{d.columns.input}</th>
                  <th className="px-3 py-2">{d.columns.finalDomain}</th>
                  <th className="px-3 py-2">{d.columns.affiliateParams}</th>
                  <th className="px-3 py-2">{d.columns.verdict}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-ink/10">
                    <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-ink/70">
                      {r.inputUrl}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{r.finalDomain}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.isOwnedDomain ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            {d.ownedBadge}
                          </span>
                        ) : null}
                        {r.finalUrl !== r.inputUrl ? (
                          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60">
                            {d.redirectedBadge}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {r.affiliateParams.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.affiliateParams.map((p) => (
                            <span
                              key={p}
                              className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-xs text-red-700"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink/40">{d.noParams}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictBadge(r.verdict)}`}
                      >
                        {d.verdicts[r.verdict]}
                      </span>
                    </td>
                  </tr>
                ))}
                {results.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-ink/50" colSpan={4}>
                      {d.empty}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6"
        >
          <label className={labelClass} htmlFor="check-urls">
            {d.urlsLabel}
          </label>
          <CapturePicker
            onPick={(c) => {
              setUrlsText((prev) => (prev.trim() ? `${prev.trim()}\n${c.finalUrl}` : c.finalUrl));
            }}
          />
          <textarea
            id="check-urls"
            rows={8}
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={d.urlsPlaceholder}
            className={`${inputClass} font-mono`}
          />
          <div className="mt-4">
            <label className={labelClass} htmlFor="owned-domains">
              {d.domainsLabel}
            </label>
            <input
              id="owned-domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder={d.domainsPlaceholder}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-xs text-ink/50">{d.domainsHint}</p>
          </div>
          <button
            type="submit"
            disabled={checking}
            className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {checking ? d.checking : d.submit}
          </button>
        </form>
      )}
    </div>
  );
}
