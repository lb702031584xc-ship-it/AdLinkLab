import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/data-io";
import { EntityPageHeader } from "@/components/entities/ui";
import { getCurrentUser } from "@/lib/api/auth";
import { DataIoClient } from "@/components/data-io/data-io-client";

export const dynamic = "force-dynamic";

/** 数据管理：导出 Offers/Campaigns/Settings（密钥脱敏），导入 Settings 配置。 */
export default async function DataManagementPage() {
  const lang = await getLang();
  const t = lang === "en" ? en : zh;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <EntityPageHeader title={t.page.title} description={t.page.description} />
      <DataIoClient t={t} />
    </div>
  );
}
