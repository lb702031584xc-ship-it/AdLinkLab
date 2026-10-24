import {
  getPortfolioAction,
  listAccountSlotsAction,
  type AccountSlot,
} from "@/lib/api/account-matrix-actions";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import {
  PortfolioPanel,
  SlotActions,
  TemplateForm,
} from "./account-matrix-client";

export const dynamic = "force-dynamic";

export default async function AccountMatrixPage() {
  const slotsResult = await listAccountSlotsAction();

  if (!slotsResult.ok) {
    return (
      <div>
        <EntityPageHeader
          title="账号矩阵"
          description="合法持有账号的组合台账：10 槽位模板、挂 Offer、封号补位与组合预算。"
        />
        <ErrorState message={slotsResult.error} title="账号矩阵加载失败" />
        <TemplateForm />
      </div>
    );
  }

  const portfolioResult = await getPortfolioAction({});
  const columns: Array<Column<AccountSlot>> = [
    {
      header: "槽位",
      render: (r) => <span className="font-mono">{r.slotIndex}</span>,
    },
    {
      header: "标签",
      render: (r) => <span className="font-medium text-ink">{r.accountLabel}</span>,
    },
    {
      header: "网络",
      render: (r) => <span>{r.network}</span>,
    },
    {
      header: "挂载 Offer",
      render: (r) => (
        <span className="text-[13px]">
          {r.offer ? r.offer.name : r.offerId ?? "—"}
        </span>
      ),
    },
    {
      header: "状态",
      render: (r) => <span className="font-mono">{r.status}</span>,
    },
    {
      header: "余额 / 待结 / 投入 / 佣金（USD）",
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.balanceUsd} / {r.pendingUsd} / {r.investedUsd} / {r.earnedUsd}
        </span>
      ),
    },
    {
      header: "操作",
      render: (r) => <SlotActions slot={r} />,
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title="账号矩阵"
        description="合法持有账号的组合台账：10 槽位模板、挂 Offer、封号补位与组合预算。"
      />
      <div className="mt-6">
        <DataTable columns={columns} rows={slotsResult.data} emptyText="暂无槽位，先用下方模板创建 10 个槽位" />
      </div>
      <PortfolioPanel initial={portfolioResult.ok ? portfolioResult.data : null} />
      <TemplateForm />
    </div>
  );
}
