import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/daily-alerts-page";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { getCurrentUser } from "@/lib/api/auth";
import { getDailyAlertsAction } from "@/lib/api/daily-alerts-actions";
import { DailyAlertsPageClient } from "@/components/monitoring/daily-alerts-page-client";

export const dynamic = "force-dynamic";

/** 每日预警独立页：复用 P2-9 分级口径（P0/P1/P2 + 三分组），按日期看报告 + 90 天累计。 */
export default async function DailyAlertsPage() {
  const lang = await getLang();
  const t = lang === "en" ? en : zh;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const res = await getDailyAlertsAction();
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
      <DailyAlertsPageClient t={t} input={res.data} />
    </div>
  );
}
