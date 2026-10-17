import { entityApi } from "@/lib/api/entities";
import { listBudgetRulesAction } from "@/lib/api/budget-rule-actions";
import { formatDateTime } from "@/lib/api/entities-config";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/budget-rules";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import BudgetRuleForm from "./budget-rule-form";
import BudgetRuleRowActions, { actionBadge } from "./budget-rule-row";
import type { BudgetRule } from "@/lib/api/budget-rule-actions";

export const dynamic = "force-dynamic";

export default async function BudgetRulesPage() {
  const lang = await getLang();
  const t = (lang === "en" ? en : zh).budgetRules;

  const [rulesResult, accountsResult] = await Promise.all([
    listBudgetRulesAction(),
    entityApi.googleAccounts.list(1, 100).catch(() => null),
  ]);

  if (!rulesResult.ok) {
    return (
      <div>
        <EntityPageHeader title={t.title} description={t.description} />
        <ErrorState message={rulesResult.error} title={t.loadFailed} />
      </div>
    );
  }

  const rules = rulesResult.data;
  const accounts = (accountsResult?.items ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    customerId: a.customerId,
  }));

  const columns: Array<Column<BudgetRule>> = [
    {
      header: t.columns.campaign,
      render: (r) => (
        <span className="font-medium text-ink">{r.campaignName}</span>
      ),
    },
    {
      header: t.columns.targetRoas,
      render: (r) => <span className="font-mono">{r.targetRoas}</span>,
    },
    {
      header: t.columns.budgetRange,
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.minDailyBudget} – {r.maxDailyBudget}
        </span>
      ),
    },
    {
      header: t.columns.spendCap,
      render: (r) => (
        <div className="space-y-1 text-[13px]">
          <div className="font-mono">
            {r.maxSpendCap != null ? r.maxSpendCap : t.spendCapOff}
          </div>
          <div className="text-xs text-ink/60">
            {r.maxSpendCap != null
              ? r.autoPauseOnBreach
                ? t.spendCapAutoPauseOn
                : t.spendCapAutoPauseOff
              : ""}
          </div>
        </div>
      ),
    },
    {
      header: t.columns.lastAction,
      render: (r) =>
        r.lastAction ? (
          <div className="max-w-xs space-y-1">
            <div>{actionBadge(r.lastAction.action, t)}</div>
            <p className="text-xs text-ink/60">{r.lastAction.reason}</p>
          </div>
        ) : (
          <span className="text-xs text-ink/40">{t.neverEvaluated}</span>
        ),
    },
    {
      header: t.columns.lastEvaluated,
      render: (r) =>
        r.lastEvaluatedAt ? (
          <span className="text-[13px] text-ink/70">
            {formatDateTime(r.lastEvaluatedAt)}
          </span>
        ) : (
          <span className="text-xs text-ink/40">{t.neverEvaluated}</span>
        ),
    },
    {
      header: t.columns.enabled,
      render: (r) => <BudgetRuleRowActions rule={r} t={t} />,
    },
  ];

  return (
    <div>
      <EntityPageHeader title={t.title} description={t.description} />
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {t.spendWarning}
      </div>
      {rules.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">{t.noRules}</p>
      ) : (
        <div className="mt-6">
          <DataTable columns={columns} rows={rules} />
        </div>
      )}
      <BudgetRuleForm accounts={accounts} t={t} />
    </div>
  );
}
