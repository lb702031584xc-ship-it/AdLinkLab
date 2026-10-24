import { listRiskParamsAction } from "@/lib/api/cost-ledger-actions";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import {
  BidMathForm,
  CostLedgerEvaluateForm,
  RiskParamForm,
} from "./cost-ledger-forms";
import type { RiskParam } from "@/lib/api/cost-ledger-actions";

export const dynamic = "force-dynamic";

export default async function CostLedgerPage() {
  const paramsResult = await listRiskParamsAction();

  if (!paramsResult.ok) {
    return (
      <div>
        <EntityPageHeader
          title="成本账"
          description="封号不是门禁、是一笔账：沉没成本 × 封号概率 = 预期损失，再与预期利润比较。"
        />
        <ErrorState message={paramsResult.error} title="成本账加载失败" />
        <CostLedgerEvaluateForm />
        <BidMathForm />
        <RiskParamForm />
      </div>
    );
  }

  // Prisma Decimal 在 JSON 里可能以字符串出现，展示前统一转数字。
  const params: RiskParam[] = paramsResult.data.map((p) => ({
    ...p,
    banProbability: Number(p.banProbability),
  }));

  const columns: Array<Column<RiskParam & { id: string }>> = [
    {
      header: "网络",
      render: (r) => <span className="font-medium text-ink">{r.network}</span>,
    },
    {
      header: "操作类型",
      render: (r) => <span className="font-mono">{r.operationType}</span>,
    },
    {
      header: "封号概率覆盖值",
      render: (r) => (
        <span className="font-mono">
          {r.banProbability}（{(r.banProbability * 100).toFixed(2)}%）
        </span>
      ),
    },
  ];
  const rows = params.map((p, i) => ({
    ...p,
    id: `${p.network}::${p.operationType}::${i}`,
  }));

  return (
    <div>
      <EntityPageHeader
        title="成本账"
        description="封号不是门禁、是一笔账：沉没成本 × 封号概率 = 预期损失，再与预期利润比较。"
      />
      <div className="mt-6">
        <DataTable columns={columns} rows={rows} emptyText="暂无风险参数覆盖值，测算将使用代码默认值" />
      </div>
      <CostLedgerEvaluateForm />
      <BidMathForm />
      <RiskParamForm />
    </div>
  );
}
