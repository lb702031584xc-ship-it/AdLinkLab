"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOfferAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";
import { coachCheckAction, type CoachFinding } from "@/lib/api/coach-actions";
import { CoachGate, hasCoachBlock } from "@/components/coach/coach-gate";

const inputClassName =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClassName = "mb-1 block text-sm font-medium text-ink/70";

const OFFER_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

const OFFER_SOURCES = ["affiliate", "amazon", "cashback"] as const;

function toIsoInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function OfferForm({ initialSource }: { initialSource?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [network, setNetwork] = useState("");
  const [source, setSource] = useState<string>(
    OFFER_SOURCES.includes(initialSource as (typeof OFFER_SOURCES)[number])
      ? (initialSource as string)
      : "affiliate"
  );
  const [destinationUrl, setDestinationUrl] = useState("");
  const [status, setStatus] = useState<string>("ACTIVE");
  const [priority, setPriority] = useState("100");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [coachFindings, setCoachFindings] = useState<CoachFinding[]>([]);
  const { t } = useI18n();
  const f = t.entities.forms.offer;

  const valid =
    name.trim() !== "" &&
    network.trim() !== "" &&
    destinationUrl.trim() !== "";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || pending || hasCoachBlock(coachFindings)) return;
    setError(null);
    const priorityNum = Number(priority);
    start(async () => {
      const result = await createOfferAction({
        name: name.trim(),
        network: network.trim(),
        source,
        destinationUrl: destinationUrl.trim(),
        status,
        priority: Number.isFinite(priorityNum) ? Math.floor(priorityNum) : 100,
        startsAt: toIsoInput(startsAt),
        endsAt: toIsoInput(endsAt),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/offers?tab=${source}`);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 space-y-5 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm"
    >
      <div>
        <label htmlFor="offer-name" className={labelClassName}>
          {f.name} *
        </label>
        <input
          id="offer-name"
          className={inputClassName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={f.namePlaceholder}
        />
      </div>
      <div>
        <label htmlFor="offer-network" className={labelClassName}>
          {f.network} *
        </label>
        <input
          id="offer-network"
          className={inputClassName}
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          placeholder={f.networkPlaceholder}
        />
      </div>
      <div>
        <label htmlFor="offer-source" className={labelClassName}>
          {f.source}
        </label>
        <select
          id="offer-source"
          className={inputClassName}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {OFFER_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t.entities.offers.tabs[s as keyof typeof t.entities.offers.tabs]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="offer-url" className={labelClassName}>
          {f.destinationUrl} *
        </label>
        <input
          id="offer-url"
          type="url"
          className={inputClassName}
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          onBlur={() => {
            const url = destinationUrl.trim();
            if (!url) {
              setCoachFindings([]);
              return;
            }
            void coachCheckAction({ url }).then((r) => {
              if (r.ok) setCoachFindings(r.data.findings);
            });
          }}
          placeholder={f.destinationUrlPlaceholder}
        />
        <div className="mt-2">
          <CoachGate dict={t.coach} findings={coachFindings} />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-status" className={labelClassName}>
            {f.status}
          </label>
          <select
            id="offer-status"
            className={inputClassName}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {OFFER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="offer-priority" className={labelClassName}>
            {f.priority}
          </label>
          <input
            id="offer-priority"
            type="number"
            className={inputClassName}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-starts" className={labelClassName}>
            {f.startsAt}
          </label>
          <input
            id="offer-starts"
            type="datetime-local"
            className={inputClassName}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="offer-ends" className={labelClassName}>
            {f.endsAt}
          </label>
          <input
            id="offer-ends"
            type="datetime-local"
            className={inputClassName}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || !valid}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? f.creating : f.submit}
        </button>
        <button
          type="button"
          onClick={() => router.push("/offers")}
          className="rounded-lg border border-ink/15 bg-white/70 px-4 py-2 text-sm font-medium hover:bg-white"
        >
          {t.common.actions.cancel}
        </button>
      </div>
    </form>
  );
}
