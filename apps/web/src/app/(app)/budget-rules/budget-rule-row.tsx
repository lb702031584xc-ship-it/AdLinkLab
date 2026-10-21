"use client";

/**
 * Budget pacer — per-rule row actions (client widget).
 * Enable/disable toggle + expandable lastAction history.
 * Talks to the API through the budget-rule server actions only.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getBudgetRuleHistoryAction,
  updateBudgetRuleAction,
  type BudgetRule,
} from "@/lib/api/budget-rule-actions";
import type { BudgetRulesDict } from "@/i18n/dict/budget-rules";

type T = BudgetRulesDict["budgetRules"];

export function actionBadge(action: string, t: T) {
  const label =
    action === "up"
      ? t.action.up
      : action === "down"
        ? t.action.down
        : action === "init"
          ? t.action.init
          : action === "paused"
            ? t.action.paused
            : t.action.hold;
  const color =
    action === "up"
      ? "bg-green-100 text-green-800"
      : action === "down"
        ? "bg-red-100 text-red-800"
        : action === "init"
          ? "bg-blue-100 text-blue-800"
          : action === "paused"
            ? "bg-red-100 text-red-800"
            : "bg-ink/10 text-ink/70";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}

export default function BudgetRuleRowActions({
  rule,
  t,
}: {
  rule: BudgetRule;
  t: T;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<
    NonNullable<BudgetRule["lastAction"]>[] | null
  >(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function toggle() {
    const next = !rule.enabled;
    const template = next ? t.toggleConfirmEnable : t.toggleConfirmDisable;
    if (!window.confirm(template.replace("{name}", rule.campaignName))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updateBudgetRuleAction(rule.id, { enabled: next });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (history) return;
    setHistoryError(null);
    try {
      const result = await getBudgetRuleHistoryAction(rule.id);
      if (result.ok) {
        setHistory(result.data.history);
      } else {
        setHistoryError(result.error);
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : t.unknownError);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          title={rule.enabled ? t.disable : t.enable}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            rule.enabled ? "bg-signal" : "bg-ink/20"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              rule.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className="text-xs text-ink/60">
          {rule.enabled ? t.enabledOn : t.enabledOff}
        </span>
        <button
          type="button"
          onClick={toggleHistory}
          className="ml-2 text-xs font-medium text-signal hover:underline"
        >
          {t.columns.detail}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {expanded && (
        <div className="mt-2 rounded-lg bg-ink/5 p-3 text-xs">
          <p className="font-medium text-ink/80">{t.historyTitle}</p>
          <p className="mt-0.5 text-ink/50">{t.historyNote}</p>
          {historyError && <p className="mt-1 text-red-600">{historyError}</p>}
          {history && history.length === 0 && (
            <p className="mt-1 text-ink/60">{t.historyEmpty}</p>
          )}
          {history?.map((h, i) => (
            <div key={i} className="mt-2 space-y-1 text-ink/80">
              <div className="flex items-center gap-2">
                {actionBadge(h.action, t)}
                <span className="text-ink/50">
                  {new Date(h.at).toLocaleString()}
                </span>
              </div>
              <p>{h.reason}</p>
              {(h.oldBudget !== undefined || h.newBudget !== undefined) && (
                <p className="font-mono">
                  {h.oldBudget ?? "—"} → {h.newBudget ?? "—"}
                </p>
              )}
              {h.roas != null && (
                <p>
                  ROAS {h.roas} · revenue {h.revenue} · spend {h.spend}
                </p>
              )}
              {h.taskId && (
                <p className="font-mono text-ink/50">task {h.taskId}</p>
              )}
              {h.action === "paused" &&
                h.spendCap !== undefined &&
                h.cumulativeSpend !== undefined && (
                  <p>
                    spend cap {h.spendCap} · cumulative spend{" "}
                    {h.cumulativeSpend}
                  </p>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
