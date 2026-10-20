import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/settings";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { getCurrentUser } from "@/lib/api/auth";
import { getSettingsAction } from "@/lib/api/settings-actions";
import { listCatalogNetworksAction } from "@/lib/api/catalog-actions";
import { SettingsClient } from "@/components/settings/settings-client";

export const dynamic = "force-dynamic";

/** 每租户系统设置（对标 autoads 系统设置）：AI 引擎 / 广告发布 / 代理 / 联盟账号 / 系统偏好。 */
export default async function SettingsPage() {
  const lang = await getLang();
  const t = lang === "en" ? en : zh;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [settingsRes, networksRes] = await Promise.all([
    getSettingsAction(),
    listCatalogNetworksAction(),
  ]);

  if (!settingsRes.ok) {
    return (
      <div>
        <EntityPageHeader title={t.page.title} description={t.page.description} />
        <ErrorState title={t.page.title} message={settingsRes.error} />
      </div>
    );
  }

  return (
    <div>
      <EntityPageHeader title={t.page.title} description={t.page.description} />
      <SettingsClient
        t={t}
        initial={settingsRes.data}
        networks={networksRes.ok ? networksRes.data : []}
        platformAdmin={
          (user.role as string) === "admin" || (user.role as string) === "owner"
        }
      />
    </div>
  );
}
