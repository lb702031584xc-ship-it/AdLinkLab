import {
  listDirectTestPlansAction,
  type DirectTestPlan,
} from "@/lib/api/direct-test-actions";
import {
  DataTable,
  EntityPageHeader,
  type Column,
} from "@/components/entities/ui";
import { DirectTestFlow } from "./direct-test-client";

export const dynamic = "force-dynamic";

export default async function DirectTestPage() {
  const plansResult = await listDirectTestPlansAction();

  const columns: Array<Column<DirectTestPlan & { id: string }>> = [
    {
      header: "计划 ID",
      render: (r) => <span className="font-mono text-[13px]">{r.planId}</span>,
    },
    {
      header: "最终网址",
      render: (r) => <span className="font-mono text-[13px] break-all">{r.finalUrl}</span>,
    },
    {
      header: "Offer",
      render: (r) => <span className="text-[13px]">{r.offerId ?? "—"}</span>,
    },
    {
      header: "状态",
      render: (r) => <span className="font-mono">{r.status}</span>,
    },
    {
      header: "落地页关联",
      render: (r) => (
        <span className="text-[13px]">
          {r.landingPageLinked ? `已关联 ${r.landingPageId}` : "未关联"}
        </span>
      ),
    },
    {
      header: "Script 任务",
      render: (r) => <span className="font-mono text-[13px]">{r.targetId ?? "—"}</span>,
    },
    {
      header: "创建时间",
      render: (r) => (
        <span className="text-[13px]">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title="直链速测"
        description="粘终链、跳过落地页，快速生成速测计划；确认后建 Script 任务，有落地页再一键升级。"
      />
      <DirectTestFlow />
      <div className="mt-8">
        <h2 className="text-base font-semibold text-ink">本租户速测计划</h2>
        {plansResult.ok ? (
          <DataTable
            columns={columns}
            rows={plansResult.data.map((p) => ({ ...p, id: p.planId }))}
            emptyText="暂无速测计划（计划 2 小时过期，过期后不再列出）"
          />
        ) : (
          <p className="mt-4 text-sm text-red-700">计划列表加载失败：{plansResult.error}</p>
        )}
      </div>
    </div>
  );
}
