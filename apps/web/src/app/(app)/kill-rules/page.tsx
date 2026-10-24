import {
  listKillRuleEventsAction,
  listKillRulesAction,
  type KillRule,
  type KillRuleEvent,
} from "@/lib/api/kill-rule-actions";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import {
  KillRuleEvaluateForm,
  KillRuleForm,
  KillRuleRowActions,
  SeedDefaultsButton,
} from "./kill-rule-client";

export const dynamic = "force-dynamic";

export default async function KillRulesPage() {
  const rulesResult = await listKillRulesAction();

  if (!rulesResult.ok) {
    return (
      <div>
        <EntityPageHeader
          title="砍线规则"
          description="点击阈值判定 + 审计：命中只写事件，执行动作由调用方决定。"
        />
        <ErrorState message={rulesResult.error} title="砍线规则加载失败" />
        <KillRuleForm />
        <SeedDefaultsButton />
        <KillRuleEvaluateForm />
      </div>
    );
  }

  const eventsResult = await listKillRuleEventsAction();
  const ruleColumns: Array<Column<KillRule>> = [
    {
      header: "规则名",
      render: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      header: "Offer",
      render: (r) => <span className="text-[13px]">{r.offerId ?? "全局"}</span>,
    },
    {
      header: "点击阈值",
      render: (r) => <span className="font-mono">{r.clicksThreshold}</span>,
    },
    {
      header: "要求零转化",
      render: (r) => <span>{r.requireZeroConv ? "是" : "否"}</span>,
    },
    {
      header: "命中动作",
      render: (r) => <span className="font-mono">{r.action}</span>,
    },
    {
      header: "启用",
      render: (r) => <span>{r.enabled ? "开启" : "关闭"}</span>,
    },
    {
      header: "操作",
      render: (r) => <KillRuleRowActions rule={r} />,
    },
  ];
  const eventColumns: Array<Column<KillRuleEvent>> = [
    {
      header: "规则 ID",
      render: (r) => <span className="font-mono text-[13px]">{r.ruleId}</span>,
    },
    {
      header: "Offer",
      render: (r) => <span className="text-[13px]">{r.offerId ?? "—"}</span>,
    },
    {
      header: "点击 / 转化",
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.clicks} / {r.conversions}
        </span>
      ),
    },
    {
      header: "实际动作",
      render: (r) => <span className="font-mono">{r.actionTaken}</span>,
    },
    {
      header: "时间",
      render: (r) => (
        <span className="text-[13px]">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title="砍线规则"
        description="点击阈值判定 + 审计：命中只写事件，执行动作由调用方决定。"
      />
      <div className="mt-6">
        <DataTable columns={ruleColumns} rows={rulesResult.data} emptyText="暂无砍线规则" />
      </div>
      <SeedDefaultsButton />
      <KillRuleEvaluateForm />
      <div className="mt-8">
        <h2 className="text-base font-semibold text-ink">审计事件</h2>
        {eventsResult.ok ? (
          <DataTable columns={eventColumns} rows={eventsResult.data} emptyText="暂无审计事件" />
        ) : (
          <p className="mt-4 text-sm text-red-700">审计事件加载失败：{eventsResult.error}</p>
        )}
      </div>
      <KillRuleForm />
    </div>
  );
}
