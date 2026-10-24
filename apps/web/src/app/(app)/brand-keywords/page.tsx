import {
  listBrandKeywordsAction,
  type BrandKeyword,
} from "@/lib/api/brand-keyword-actions";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import { BrandKeywordForm, BrandKeywordRowActions } from "./brand-keyword-client";

export const dynamic = "force-dynamic";

export default async function BrandKeywordsPage() {
  const result = await listBrandKeywordsAction();

  if (!result.ok) {
    return (
      <div>
        <EntityPageHeader
          title="品牌词"
          description="品牌词分级管理：警告即降级，恢复靠人工。"
        />
        <ErrorState message={result.error} title="品牌词加载失败" />
        <BrandKeywordForm />
      </div>
    );
  }

  const columns: Array<Column<BrandKeyword>> = [
    {
      header: "品牌词",
      render: (r) => <span className="font-medium text-ink">{r.keyword}</span>,
    },
    {
      header: "品牌",
      render: (r) => <span>{r.brand ?? "—"}</span>,
    },
    {
      header: "Offer",
      render: (r) => <span className="text-[13px]">{r.offerId ?? "—"}</span>,
    },
    {
      header: "状态 / 竞价",
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.status} / {r.biddingEnabled ? "ON" : "OFF"}
        </span>
      ),
    },
    {
      header: "警告数 / 最后警告",
      render: (r) => (
        <span className="text-[13px]">
          {r.warningCount}
          {r.lastWarningKind ? ` / ${r.lastWarningKind}` : ""}
          {r.lastWarningAt ? `（${new Date(r.lastWarningAt).toLocaleString()}）` : ""}
        </span>
      ),
    },
    {
      header: "操作",
      render: (r) => <BrandKeywordRowActions keyword={r} />,
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title="品牌词"
        description="品牌词分级管理：警告即降级，恢复靠人工。"
      />
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        降级后状态可见：第一次警告即自动降级（status=DOWNGRADED 且竞价关闭），后续警告保持降级、警告数继续累加；人工恢复后警告计数与最后一次警告记录保留不清零。
      </div>
      <div className="mt-6">
        <DataTable columns={columns} rows={result.data} emptyText="暂无品牌词" />
      </div>
      <BrandKeywordForm />
    </div>
  );
}
