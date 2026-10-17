import { AdminGrantsClient } from "@/components/admin/admin-grants-client";

/** §5：管理员授权（申请/审批/吊销/审计）。 */
export default function AdminGrantsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">管理员授权</h1>
      <p className="mt-1 text-sm text-ink/60">
        默认关闭：申请只是申请，不直接启用；审批需管理员且审批人 ≠ 申请人；白名单逐个确认，禁止通配符；有效期 7–90 天，无永久授权。
      </p>
      <div className="mt-6">
        <AdminGrantsClient />
      </div>
    </div>
  );
}
