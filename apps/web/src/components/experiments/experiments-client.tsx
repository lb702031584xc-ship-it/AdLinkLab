"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createExperimentAction,
  listExperimentsAction,
} from "@/lib/api/experiments-actions";
import type {
  Experiment,
  ExperimentStatus,
  ExperimentType,
  ExperimentVariantType,
  GraduationAction,
} from "@/lib/api/experiments";
import type { ExperimentDict } from "@/i18n/dict/experiment";
import { ExperimentListView } from "./experiment-views";
import { creativeDifference } from "@/lib/creative-difference";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40";
const primaryClass =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50";

const STATUSES: Array<"" | ExperimentStatus> = [
  "",
  "DRAFT",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
];

function VariantFields({
  side,
  dict,
  type,
  setType,
  linkId,
  setLinkId,
  label,
  setLabel,
  headlines,
  setHeadlines,
  descriptions,
  setDescriptions,
  adGroupMode,
}: {
  side: "A" | "B";
  dict: ExperimentDict;
  type: ExperimentVariantType;
  setType: (v: ExperimentVariantType) => void;
  linkId: string;
  setLinkId: (v: string) => void;
  label: string;
  setLabel: (v: string) => void;
  /** P1-12：AD_GROUP 变体文案（每行一条）。 */
  headlines: string;
  setHeadlines: (v: string) => void;
  descriptions: string;
  setDescriptions: (v: string) => void;
  adGroupMode: boolean;
}) {
  return (
    <fieldset className="rounded-lg border border-ink/15 p-3">
      <legend className="px-1 text-sm font-medium text-ink">
        {side === "A" ? dict.form.variantALabel : dict.form.variantBLabel}
      </legend>
      <div className="grid gap-2">
        {adGroupMode ? null : (
          <>
            <label className="text-xs text-ink/60">
              {dict.form.variantTypeLabel}
              <select
                className={inputClass}
                value={type}
                onChange={(e) => setType(e.target.value as ExperimentVariantType)}
              >
                <option value="LANDING_PAGE">{dict.variantType.LANDING_PAGE}</option>
                <option value="DIRECT_LINK">{dict.variantType.DIRECT_LINK}</option>
              </select>
            </label>
            <label className="text-xs text-ink/60">
              {dict.form.trackingLinkLabel}
              <input
                className={`${inputClass} font-mono`}
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
                placeholder={dict.form.trackingLinkPlaceholder}
              />
            </label>
          </>
        )}
        {adGroupMode ? (
          <>
            <label className="text-xs text-ink/60">
              {dict.form.headlinesLabel}
              <textarea
                className={inputClass}
                rows={4}
                value={headlines}
                onChange={(e) => setHeadlines(e.target.value)}
                placeholder={dict.form.headlinesPlaceholder}
              />
            </label>
            <label className="text-xs text-ink/60">
              {dict.form.descriptionsLabel}
              <textarea
                className={inputClass}
                rows={3}
                value={descriptions}
                onChange={(e) => setDescriptions(e.target.value)}
                placeholder={dict.form.descriptionsPlaceholder}
              />
            </label>
          </>
        ) : null}
        <label className="text-xs text-ink/60">
          {dict.form.labelLabel}
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={dict.form.labelPlaceholder}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** Experiments list + create form. */
export function ExperimentsClient({ dict }: { dict: ExperimentDict }) {
  const router = useRouter();
  const [items, setItems] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | ExperimentStatus>("");

  const [showForm, setShowForm] = useState(false);
  const [offerId, setOfferId] = useState("");
  const [name, setName] = useState("");
  /** P1-12：实验类型（AD_GROUP = 文案 A/B，变体带文案 + 差异度）。 */
  const [experimentType, setExperimentType] = useState<ExperimentType>("LANDING_PAGE");
  const [seedAdGroupId, setSeedAdGroupId] = useState("");
  const [graduationAction, setGraduationAction] = useState<GraduationAction>("none");
  const [typeA, setTypeA] = useState<ExperimentVariantType>("LANDING_PAGE");
  const [linkA, setLinkA] = useState("");
  const [labelA, setLabelA] = useState("");
  const [headlinesA, setHeadlinesA] = useState("");
  const [descriptionsA, setDescriptionsA] = useState("");
  const [typeB, setTypeB] = useState<ExperimentVariantType>("DIRECT_LINK");
  const [linkB, setLinkB] = useState("");
  const [labelB, setLabelB] = useState("");
  const [headlinesB, setHeadlinesB] = useState("");
  const [descriptionsB, setDescriptionsB] = useState("");
  const [splitA, setSplitA] = useState("50");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // P1-12：AD_GROUP 实时差异度（<50% 显示警告，不拦截）。
  const adGroupDiff =
    experimentType === "AD_GROUP"
      ? creativeDifference(
          `${headlinesA}\n${descriptionsA}`,
          `${headlinesB}\n${descriptionsB}`
        )
      : null;

  const load = async (status: "" | ExperimentStatus) => {
    setLoading(true);
    setError(null);
    const res = await listExperimentsAction(
      status ? { status } : undefined
    );
    if (res.ok) setItems(res.data.items);
    else setError(res.error);
    setLoading(false);
  };

  useEffect(() => {
    load(statusFilter);
  }, [statusFilter]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const lines = (s: string) =>
      s.split("\n").map((x) => x.trim()).filter(Boolean);
    const isAdGroup = experimentType === "AD_GROUP";
    if (
      !offerId.trim() ||
      !name.trim() ||
      (isAdGroup
        ? lines(headlinesA).length === 0 || lines(descriptionsA).length === 0 ||
          lines(headlinesB).length === 0 || lines(descriptionsB).length === 0
        : !linkA.trim() || !linkB.trim())
    ) {
      setFormError(dict.form.missingField);
      return;
    }
    setCreating(true);
    setFormError(null);
    const res = await createExperimentAction({
      offerId: offerId.trim(),
      name: name.trim(),
      variantA: isAdGroup
        ? {
            type: "AD_GROUP",
            trackingLinkId: null,
            label: labelA.trim() || undefined,
            headlines: lines(headlinesA),
            descriptions: lines(descriptionsA),
          }
        : {
            type: typeA,
            trackingLinkId: linkA.trim(),
            label: labelA.trim() || undefined,
          },
      variantB: isAdGroup
        ? {
            type: "AD_GROUP",
            trackingLinkId: null,
            label: labelB.trim() || undefined,
            headlines: lines(headlinesB),
            descriptions: lines(descriptionsB),
          }
        : {
            type: typeB,
            trackingLinkId: linkB.trim(),
            label: labelB.trim() || undefined,
          },
      trafficSplitA: Number(splitA) || 50,
      experimentType,
      seedAdGroupId: seedAdGroupId.trim() || null,
      graduationAction,
    });
    setCreating(false);
    if (res.ok) {
      router.push(`/experiments/${res.data.id}`);
    } else {
      setFormError(res.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{dict.list.title}</h1>
          <p className="mt-1 text-sm text-ink/60">{dict.list.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink/60">
            {dict.list.statusFilter}{" "}
            <select
              className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "" | ExperimentStatus)
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? dict.list.all : dict.status[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            className={primaryClass}
            onClick={() => setShowForm((v) => !v)}
          >
            {dict.list.new}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={onCreate}
          className="space-y-3 rounded-lg border border-ink/15 bg-white p-4"
        >
          <p className="text-sm font-semibold text-ink">{dict.form.title}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-ink/60">
              {dict.form.offerIdLabel}
              <input
                className={`${inputClass} font-mono`}
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                placeholder={dict.form.offerIdPlaceholder}
              />
            </label>
            <label className="text-xs text-ink/60">
              {dict.form.nameLabel}
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={dict.form.namePlaceholder}
              />
            </label>
          </div>
          {/* P1-12：实验类型 + 种子广告组 + 毕业动作。 */}
          <div className="grid gap-2 md:grid-cols-3">
            <label className="text-xs text-ink/60">
              {dict.form.experimentTypeLabel}
              <select
                className={inputClass}
                value={experimentType}
                onChange={(e) => setExperimentType(e.target.value as ExperimentType)}
              >
                <option value="LANDING_PAGE">{dict.experimentType.LANDING_PAGE}</option>
                <option value="DIRECT_LINK">{dict.experimentType.DIRECT_LINK}</option>
                <option value="AD_GROUP">{dict.experimentType.AD_GROUP}</option>
              </select>
            </label>
            <label className="text-xs text-ink/60">
              {dict.form.seedAdGroupLabel}
              <input
                className={`${inputClass} font-mono`}
                value={seedAdGroupId}
                onChange={(e) => setSeedAdGroupId(e.target.value)}
                placeholder={dict.form.seedAdGroupPlaceholder}
              />
            </label>
            <label className="text-xs text-ink/60">
              {dict.form.graduationLabel}
              <select
                className={inputClass}
                value={graduationAction}
                onChange={(e) => setGraduationAction(e.target.value as GraduationAction)}
              >
                <option value="none">{dict.form.graduationNone}</option>
                <option value="pause_loser">{dict.form.graduationPauseLoser}</option>
              </select>
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <VariantFields
              side="A"
              dict={dict}
              type={typeA}
              setType={setTypeA}
              linkId={linkA}
              setLinkId={setLinkA}
              label={labelA}
              setLabel={setLabelA}
              headlines={headlinesA}
              setHeadlines={setHeadlinesA}
              descriptions={descriptionsA}
              setDescriptions={setDescriptionsA}
              adGroupMode={experimentType === "AD_GROUP"}
            />
            <VariantFields
              side="B"
              dict={dict}
              type={typeB}
              setType={setTypeB}
              linkId={linkB}
              setLinkId={setLinkB}
              label={labelB}
              setLabel={setLabelB}
              headlines={headlinesB}
              setHeadlines={setHeadlinesB}
              descriptions={descriptionsB}
              setDescriptions={setDescriptionsB}
              adGroupMode={experimentType === "AD_GROUP"}
            />
          </div>
          {adGroupDiff != null ? (
            <p
              className={`text-sm ${adGroupDiff < 0.5 ? "text-amber-700" : "text-ink/60"}`}
            >
              {dict.form.creativeDifference}: {(adGroupDiff * 100).toFixed(1)}%
              {adGroupDiff < 0.5 ? ` — ${dict.form.creativeDifferenceWarn}` : ""}
            </p>
          ) : null}
          <label className="block max-w-xs text-xs text-ink/60">
            {dict.form.splitLabel}
            <input
              className={inputClass}
              type="number"
              min={1}
              max={99}
              value={splitA}
              onChange={(e) => setSplitA(e.target.value)}
            />
          </label>
          {formError && <p className="text-sm text-red-700">{formError}</p>}
          <button type="submit" className={primaryClass} disabled={creating}>
            {creating ? dict.form.creating : dict.form.create}
          </button>
        </form>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink/60">…</p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-red-700">{error}</p>
      ) : (
        <ExperimentListView items={items} dict={dict} />
      )}
    </div>
  );
}
