"use client";

import { useEffect, useRef, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  checkUrlsAction,
  saveAiSettingsAction,
} from "@/lib/api/ai-actions";
import type { AiUrlCheckResult, UrlCheckVerdict } from "@/lib/api/ai";
import { CapturePicker } from "@/components/ai/capture-picker";
import { OfferPipelineNav } from "@/components/ai/offer-pipeline-nav";
import { loadWorkStateAction } from "@/lib/api/work-state-actions";
import { useWorkState } from "@/lib/use-work-state";

const MAX_URLS = 20;

function verdictBadge(v: UrlCheckVerdict): string {
  if (v === "owned") return "bg-green-100 text-green-800";
  if (v === "affiliate_direct") return "bg-red-100 text-red-800";
  if (v === "suspicious") return "bg-amber-100 text-amber-800";
  return "bg-ink/10 text-ink/60";
}

export interface ComplianceOffer {
  id: string;
  name: string;
  network?: string | null;
  destinationUrl: string;
  affiliateUrl?: string | null;
}

export function ComplianceClient({
  isAdmin,
  initialOwnedDomains,
  hideHeader,
  onResult,
  initialOffer,
  offers,
}: {
  isAdmin: boolean;
  initialOwnedDomains: string[];
  /** Worksheet embedding: hide the page header (the step card provides it). */
  hideHeader?: boolean;
  /** Worksheet embedding: report check results upward. */
  onResult?: (r: AiUrlCheckResult[] | null) => void;
  /** Offer 上下文：独立页 ?offerId= / 工作表嵌入时带入。 */
  initialOffer?: ComplianceOffer | null;
  /** 独立页 offer 下拉列表。 */
  offers?: ComplianceOffer[];
}) {
  const t = useDict();
  const d = t.ai.compliance;
  const [urlsText, setUrlsText] = useState("");
  const [domains, setDomains] = useState(initialOwnedDomains.join(", "));
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(
    initialOffer?.id ?? null
  );
  const [selectedOfferName, setSelectedOfferName] = useState<string | null>(
    initialOffer?.name ?? null
  );
  const [selectedOfferNetwork, setSelectedOfferNetwork] = useState<string | null>(
    initialOffer?.network ?? null
  );
  const appliedOfferRef = useRef<string | null>(initialOffer?.id ?? null);

  /* Offer 主线：按 offer 自动保存/恢复待查链接 */
  useWorkState({
    page: "ai-compliance",
    offerId: selectedOfferId,
    label: selectedOfferName,
    buildSnapshot: () => ({ version: 1, urlsText, domains }),
    isMeaningful: (snap) => Boolean((snap.urlsText as string)?.trim()),
    applySnapshot: (snap) => {
      if (typeof snap.urlsText === "string") setUrlsText(snap.urlsText);
      if (typeof snap.domains === "string") setDomains(snap.domains);
    },
    watch: [selectedOfferId, urlsText, domains],
  });

  /* 选了 offer：链接框只显示该 offer 的数据（不再把旧内容带过来）。
     联盟链接和目标 URL 各占一行，都参与跳转链检查（联盟链接是投放实际用的）。 */
  const applyOfferUrl = (o: ComplianceOffer) => {
    setSelectedOfferId(o.id);
    setSelectedOfferName(o.name);
    setSelectedOfferNetwork(o.network ?? null);
    setDomains(initialOwnedDomains.join(", "));
    const urls = [o.affiliateUrl?.trim(), o.destinationUrl?.trim()].filter(Boolean);
    setUrlsText(urls.join("\n"));
  };

  useEffect(() => {
    const key = initialOffer ? initialOffer.id : null;
    if (key && appliedOfferRef.current !== key) {
      appliedOfferRef.current = key;
      applyOfferUrl(initialOffer!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOffer]);

  const onSelectOffer = async (id: string) => {
    const o = (offers ?? []).find((x) => x.id === id) ?? null;
    if (!o) return;
    try {
      const res = await loadWorkStateAction("ai-compliance", o.id);
      const snap = res.ok ? res.data.state : null;
      if (snap && typeof snap.urlsText === "string" && snap.urlsText.trim()) {
        setSelectedOfferId(o.id);
        setSelectedOfferName(o.name);
        setSelectedOfferNetwork(o.network ?? null);
        setUrlsText(snap.urlsText);
        if (typeof snap.domains === "string") setDomains(snap.domains);
        return;
      }
    } catch {
      /* 恢复失败则走默认填充 */
    }
    applyOfferUrl(o);
  };
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

      {!hideHeader && (
        <OfferPipelineNav
          current="compliance"
          offerId={selectedOfferId}
          offerName={selectedOfferName}
          offerNetwork={selectedOfferNetwork}
          offers={offers}
          onSelectOffer={onSelectOffer}
        />
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
                  <th className="px-3 py-2">重定向跳数</th>
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
                    {/* P1-3：跳数 >3 黄色警告（可能影响转化率）；affiliate 参数检测保留。 */}
                    <td className="px-3 py-2">
                      {typeof r.redirectHops === "number" ? (
                        r.redirectHops > 3 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800" title="重定向超过 3 跳，可能影响转化率">
                            {r.redirectHops} 跳 ⚠️
                          </span>
                        ) : (
                          <span className="text-ink/70">{r.redirectHops} 跳</span>
                        )
                      ) : (
                        <span className="text-ink/40">—</span>
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
                    <td className="px-3 py-6 text-ink/50" colSpan={5}>
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
