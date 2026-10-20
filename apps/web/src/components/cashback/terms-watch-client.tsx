"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  en as termsWatchEn,
  zh as termsWatchZh,
} from "@/i18n/dict/cashback-terms-watch";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  checkTermsWatchAction,
  createTermsWatchAction,
  listTermsWatchesAction,
} from "@/lib/api/cashback-terms-watch-actions";
import type { TermsWatch } from "@/lib/api/cashback-terms-watch";

function useTermsWatchDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? termsWatchZh : termsWatchEn;
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

function formatDateTime(v: string | null): string {
  if (!v) return "—";
  return v.slice(0, 16).replace("T", " ");
}

/** Terms watch: list + create form + manual check per row. */
export function TermsWatchClient() {
  const d = useTermsWatchDict();
  const [watches, setWatches] = useState<TermsWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [merchantName, setMerchantName] = useState("");
  const [merchantDomain, setMerchantDomain] = useState("");
  const [termsUrl, setTermsUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function refresh() {
    const res = await listTermsWatchesAction();
    if (res.ok) {
      setWatches(res.data.items);
      setError(null);
    } else {
      setError(res.error);
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate() {
    setCreating(true);
    setNotice(null);
    const res = await createTermsWatchAction({
      merchantName: merchantName.trim(),
      merchantDomain: merchantDomain.trim(),
      termsUrl: termsUrl.trim(),
    });
    setCreating(false);
    if (res.ok) {
      setMerchantName("");
      setMerchantDomain("");
      setTermsUrl("");
      setNotice(d.termsWatch.created);
      await refresh();
    } else {
      setError(res.error);
    }
  }

  async function onCheck(id: string) {
    setCheckingId(id);
    setNotice(null);
    const res = await checkTermsWatchAction(id);
    setCheckingId(null);
    if (res.ok) {
      const r = res.data.result;
      const allowedTxt =
        r.cashbackAllowed == null
          ? d.termsWatch.allowed.unknown
          : r.cashbackAllowed
            ? d.termsWatch.allowed.yes
            : d.termsWatch.allowed.no;
      const bits = [
        `${d.termsWatch.columns.status}：${d.termsWatch.status[r.status]}`,
        r.hashChanged ? d.termsWatch.hashChanged : d.termsWatch.hashUnchanged,
        `${d.termsWatch.columns.allowed}：${allowedTxt}`,
      ];
      if (r.prohibitedNewly) bits.push(d.termsWatch.prohibitedNewly);
      if (r.pausedLinks > 0)
        bits.push(
          d.termsWatch.pausedLinksNote.replace("{n}", String(r.pausedLinks))
        );
      setNotice(`${d.termsWatch.checkDone} ${bits.join("；")}`);
      await refresh();
    } else {
      setError(res.error);
    }
  }

  function allowedBadge(w: TermsWatch) {
    if (w.cashbackAllowed === true)
      return (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs text-emerald-800">
          {d.termsWatch.allowed.yes}
        </span>
      );
    if (w.cashbackAllowed === false)
      return (
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-800">
          {d.termsWatch.allowed.no}
        </span>
      );
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
        {d.termsWatch.allowed.unknown}
      </span>
    );
  }

  function statusBadge(w: TermsWatch) {
    const label =
      w.status === "changed"
        ? d.termsWatch.status.changed
        : w.status === "blocked"
          ? d.termsWatch.status.blocked
          : d.termsWatch.status.ok;
    const cls =
      w.status === "changed"
        ? "bg-amber-100 text-amber-800"
        : w.status === "blocked"
          ? "bg-red-100 text-red-800"
          : "bg-slate-100 text-slate-600";
    return (
      <span className={`rounded-full px-2.5 py-0.5 text-xs ${cls}`}>{label}</span>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <EntityPageHeader
        title={d.termsWatch.title}
        description={d.termsWatch.description}
      />

      {notice && (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-600/30 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}{" "}
          <button
            className="underline"
            onClick={() => {
              setError(null);
              refresh();
            }}
          >
            {d.termsWatch.retry}
          </button>
        </div>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-ink">
          {d.termsWatch.addTitle}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            {d.termsWatch.merchantName}
            <input
              className={inputClass}
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              placeholder={d.termsWatch.merchantNamePlaceholder}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            {d.termsWatch.merchantDomain}
            <input
              className={inputClass}
              value={merchantDomain}
              onChange={(e) => setMerchantDomain(e.target.value)}
              placeholder={d.termsWatch.merchantDomainPlaceholder}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            {d.termsWatch.termsUrl}
            <input
              className={inputClass}
              value={termsUrl}
              onChange={(e) => setTermsUrl(e.target.value)}
              placeholder={d.termsWatch.termsUrlPlaceholder}
            />
          </label>
        </div>
        <div className="mt-4">
          <button
            className={btnPrimary}
            disabled={creating || !merchantName.trim() || !termsUrl.trim()}
            onClick={onCreate}
          >
            {creating ? d.termsWatch.creating : d.termsWatch.submit}
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-ink/60">
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.merchant}</th>
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.domain}</th>
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.termsUrl}</th>
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.allowed}</th>
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.status}</th>
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.lastChecked}</th>
              <th className="px-4 py-3 font-medium">{d.termsWatch.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                  …
                </td>
              </tr>
            ) : watches.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                  {d.termsWatch.empty}
                </td>
              </tr>
            ) : (
              watches.map((w) => (
                <tr key={w.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{w.merchantName}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink">
                    {w.merchantDomain}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-3">
                    <a
                      href={w.termsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-signal underline"
                    >
                      {w.termsUrl}
                    </a>
                  </td>
                  <td className="px-4 py-3">{allowedBadge(w)}</td>
                  <td className="px-4 py-3">{statusBadge(w)}</td>
                  <td className="px-4 py-3 text-ink/70">{formatDateTime(w.lastChecked)}</td>
                  <td className="px-4 py-3">
                    <button
                      className={btnGhost}
                      disabled={checkingId === w.id}
                      onClick={() => onCheck(w.id)}
                    >
                      {checkingId === w.id
                        ? d.termsWatch.checking
                        : d.termsWatch.checkNow}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
