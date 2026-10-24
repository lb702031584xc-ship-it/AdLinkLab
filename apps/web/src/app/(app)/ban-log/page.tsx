import {
  getSurvivalStatsAction,
  listBanEventsAction,
  type BanEvent,
  type SurvivalStat,
} from "@/lib/api/ban-log-actions";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import { BanLogForm, RecoverAction } from "./ban-log-client";

export const dynamic = "force-dynamic";

export default async function BanLogPage() {
  const eventsResult = await listBanEventsAction();

  if (!eventsResult.ok) {
    return (
      <div>
        <EntityPageHeader
          title="封号复盘库"
          description="每一次封号都记一笔：损失多少、追回多少、哪类操作最容易封。"
        />
        <ErrorState message={eventsResult.error} title="复盘记录加载失败" />
        <BanLogForm />
      </div>
    );
  }

  const statsResult = await getSurvivalStatsAction();
  const eventColumns: Array<Column<BanEvent>> = [
    {
      header: "网络",
      render: (r) => <span className="font-medium text-ink">{r.network}</span>,
    },
    {
      header: "操作类型",
      render: (r) => <span className="font-mono">{r.operationType}</span>,
    },
    {
      header: "Offer",
      render: (r) => <span className="text-[13px]">{r.offerId ?? "—"}</span>,
    },
    {
      header: "损失（余额 + 待结，USD）",
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.lostBalanceUsd} + {r.lostPendingUsd}
        </span>
      ),
    },
    {
      header: "恢复",
      render: (r) => <RecoverAction event={r} />,
    },
    {
      header: "备注",
      render: (r) => <span className="text-[13px]">{r.note ?? "—"}</span>,
    },
    {
      header: "发生时间",
      render: (r) => (
        <span className="text-[13px]">{r.occurredAt ? new Date(r.occurredAt).toLocaleString() : "—"}</span>
      ),
    },
  ];

  const statRows = (statsResult.ok ? statsResult.data : []).map((s) => ({
    ...s,
    id: `${s.network}::${s.operationType}`,
  }));
  const statColumns: Array<Column<SurvivalStat & { id: string }>> = [
    {
      header: "网络",
      render: (r) => <span className="font-medium text-ink">{r.network}</span>,
    },
    {
      header: "操作类型",
      render: (r) => <span className="font-mono">{r.operationType}</span>,
    },
    {
      header: "封号数",
      render: (r) => <span className="font-mono">{r.banCount}</span>,
    },
    {
      header: "当前存活槽位数",
      render: (r) => <span className="font-mono">{r.activeSlotCount}</span>,
    },
    {
      header: "观测封号占比",
      render: (r) => (
        <span className="font-mono">
          {r.observedBanShare}（{(r.observedBanShare * 100).toFixed(2)}%）
        </span>
      ),
    },
    {
      header: "累计损失 / 追回（USD）",
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.totalLostUsd} / {r.totalRecoveredUsd}
        </span>
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title="封号复盘库"
        description="每一次封号都记一笔：损失多少、追回多少、哪类操作最容易封。"
      />
      <div className="mt-6">
        <DataTable columns={eventColumns} rows={eventsResult.data} emptyText="暂无复盘记录" />
      </div>
      <div className="mt-8">
        <h2 className="text-base font-semibold text-ink">按网络 × 操作类型存活统计</h2>
        <p className="mt-1 text-xs text-ink/60">
          口径说明：observedBanShare = banCount / max(1, banCount +
          activeSlotCount)，其中 activeSlotCount
          为该网络当前 ACTIVE/PAUSED 槽位数（槽位没有操作类型维度，同一网络的各操作类型组共用该数）。
          这是观测值、非精确存活率：分母不是历史同期 cohort（已封的槽位不再计入
          active，早期封号也不会被回溯进分母），只能用于组间比较与成本账封号概率参数的参考，
          不能直接当作“该操作存活率 X%”对外宣称。
        </p>
        {statsResult.ok ? (
          <DataTable columns={statColumns} rows={statRows} emptyText="暂无统计数据" />
        ) : (
          <p className="mt-4 text-sm text-red-700">统计加载失败：{statsResult.error}</p>
        )}
      </div>
      <BanLogForm />
    </div>
  );
}
