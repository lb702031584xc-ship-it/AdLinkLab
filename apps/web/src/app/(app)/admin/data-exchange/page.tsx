import { DataExchangeClient } from "@/components/admin/data-exchange-client";

export const dynamic = "force-dynamic";

/** P1-27：数据导出 / 导入（admin）。 */
export default function DataExchangePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">数据导出 / 导入</h1>
      <div className="mt-4">
        <DataExchangeClient />
      </div>
    </div>
  );
}
