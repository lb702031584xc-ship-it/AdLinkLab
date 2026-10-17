"use client";

/**
 * Budget pacer — new rule form (client widget).
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the budget-rule server actions only.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBudgetRuleAction } from "@/lib/api/budget-rule-actions";
import type { BudgetRulesDict } from "@/i18n/dict/budget-rules";

export interface AccountOption {
  id: string;
  name: string;
  customerId: string;
}

export default function BudgetRuleForm({
  accounts,
  t,
}: {
  accounts: AccountOption[];
  t: BudgetRulesDict["budgetRules"];
}) {
  const router = useRouter();
  const [googleAccountId, setGoogleAccountId] = useState(
    accounts[0]?.id ?? ""
  );
  const [campaignName, setCampaignName] = useState("");
  const [targetRoas, setTargetRoas] = useState("3");
  const [minBudget, setMinBudget] = useState("10");
  const [maxBudget, setMaxBudget] = useState("100");
  const [increasePct, setIncreasePct] = useState("20");
  const [decreasePct, setDecreasePct] = useState("20");
  const [checkInterval, setCheckInterval] = useState("7");
  const [initialBudget, setInitialBudget] = useState("");
  const [maxSpendCap, setMaxSpendCap] = useState("");
  const [autoPauseOnBreach, setAutoPauseOnBreach] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!googleAccountId || !campaignName.trim()) {
      setError(t.createFailed);
      return;
    }
    const num = (v: string) => {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
    };
    const payload = {
      googleAccountId,
      campaignName: campaignName.trim(),
      targetRoas: num(targetRoas) ?? NaN,
      minDailyBudget: num(minBudget) ?? NaN,
      maxDailyBudget: num(maxBudget) ?? NaN,
      increasePct: num(increasePct),
      decreasePct: num(decreasePct),
      checkIntervalDays: num(checkInterval),
      initialBudget: num(initialBudget),
      maxSpendCap: num(maxSpendCap) ?? null,
      autoPauseOnBreach,
    };
    setSaving(true);
    try {
      const result = await createBudgetRuleAction(payload);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.unknownError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">{t.form.title}</h2>
      <p className="mt-1 text-xs text-ink/60">{t.form.defaultsNote}</p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>{t.form.googleAccount}</label>
          <select
            className={inputClass}
            value={googleAccountId}
            onChange={(e) => setGoogleAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.customerId})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t.form.campaignName}</label>
          <input
            className={inputClass}
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Cashback US"
          />
          <p className="mt-1 text-xs text-ink/50">{t.form.campaignNameHint}</p>
        </div>
        <div>
          <label className={labelClass}>{t.form.targetRoas}</label>
          <input
            className={inputClass}
            value={targetRoas}
            onChange={(e) => setTargetRoas(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={labelClass}>{t.form.initialBudget}</label>
          <input
            className={inputClass}
            value={initialBudget}
            onChange={(e) => setInitialBudget(e.target.value)}
            inputMode="decimal"
            placeholder="50"
          />
          <p className="mt-1 text-xs text-ink/50">{t.form.initialBudgetHint}</p>
        </div>
        <div>
          <label className={labelClass}>{t.form.minBudget}</label>
          <input
            className={inputClass}
            value={minBudget}
            onChange={(e) => setMinBudget(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={labelClass}>{t.form.maxBudget}</label>
          <input
            className={inputClass}
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={labelClass}>{t.form.increasePct}</label>
          <input
            className={inputClass}
            value={increasePct}
            onChange={(e) => setIncreasePct(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={labelClass}>{t.form.decreasePct}</label>
          <input
            className={inputClass}
            value={decreasePct}
            onChange={(e) => setDecreasePct(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={labelClass}>{t.form.checkInterval}</label>
          <input
            className={inputClass}
            value={checkInterval}
            onChange={(e) => setCheckInterval(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelClass}>{t.form.maxSpendCap}</label>
          <input
            className={inputClass}
            value={maxSpendCap}
            onChange={(e) => setMaxSpendCap(e.target.value)}
            inputMode="decimal"
            placeholder=""
          />
          <p className="mt-1 text-xs text-ink/50">{t.form.maxSpendCapHint}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={autoPauseOnBreach}
            onChange={(e) => setAutoPauseOnBreach(e.target.checked)}
            className="h-4 w-4"
          />
          {t.form.autoPauseOnBreach}
        </label>
        <p className="-mt-2 text-xs text-ink/50">
          {t.form.autoPauseOnBreachHint}
        </p>
      </div>
      <div className="mt-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? t.form.submitting : t.form.submit}
        </button>
      </div>
    </form>
  );
}
