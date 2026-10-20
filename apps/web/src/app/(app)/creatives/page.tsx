import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/creatives";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { getCurrentUser } from "@/lib/api/auth";
import { listCreativesAction } from "@/lib/api/creatives-actions";
import { CreativesClient } from "@/components/creatives/creatives-client";

export const dynamic = "force-dynamic";

/** 创意管理库：租户自有 RSA 文案资产（手动 / AI / 投放档案导入）。 */
export default async function CreativesPage() {
  const lang = await getLang();
  const t = lang === "en" ? en : zh;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const res = await listCreativesAction({ pageSize: 100 });
  if (!res.ok) {
    return (
      <div>
        <EntityPageHeader title={t.page.title} description={t.page.description} />
        <ErrorState title={t.page.title} message={res.error} />
      </div>
    );
  }

  return (
    <div>
      <EntityPageHeader title={t.page.title} description={t.page.description} />
      <CreativesClient t={t} initial={res.data.items} />
    </div>
  );
}
