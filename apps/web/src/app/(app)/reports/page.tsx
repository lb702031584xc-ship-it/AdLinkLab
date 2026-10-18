import Link from "next/link";
import { getLang } from "@/i18n/lang";
import { zh as launchZh, en as launchEn } from "@/i18n/dict/launch-archive";
import { zh as weeklyZh, en as weeklyEn } from "@/i18n/dict/weekly-report";
import { LaunchArchiveClient } from "@/components/reports/launch-archive-client";
import { WeeklyReportListClient } from "@/components/weekly-report/weekly-report-list-client";
import { listWeeklyReportsAction } from "@/lib/api/weekly-report-actions";

export const dynamic = "force-dynamic";

type TabKey = "launch" | "weekly";

/**
 * 数据报表总入口：投放报表（原 /reports/launch）/ 周报（原 /reports/weekly）两页签。
 * ?tab=launch|weekly 切换；旧路由保留做服务端跳转。
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; offerId?: string }>;
}) {
  const lang = await getLang();
  const sp = (await searchParams) ?? {};
  const tab: TabKey = sp.tab === "weekly" ? "weekly" : "launch";
  const offerId =
    typeof sp.offerId === "string" && sp.offerId ? sp.offerId : null;

  const launchDict = lang === "en" ? launchEn : launchZh;
  const weeklyDict = lang === "en" ? weeklyEn : weeklyZh;

  const tabs: Array<{ key: TabKey; label: string; href: string }> = [
    { key: "launch", label: launchDict.title, href: "/reports" },
    { key: "weekly", label: weeklyDict.nav.title, href: "/reports?tab=weekly" },
  ];

  const weeklyRes = tab === "weekly" ? await listWeeklyReportsAction() : null;
  const weeklyInitial =
    weeklyRes && weeklyRes.ok ? weeklyRes.data.reports : [];

  return (
    <div>
      <nav className="mb-4 flex gap-2 border-b border-ink/10">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-signal text-ink"
                : "text-ink/55 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "launch" && (
        <LaunchArchiveClient dict={launchDict} initialOfferId={offerId} />
      )}
      {tab === "weekly" && <WeeklyReportListClient initial={weeklyInitial} />}
    </div>
  );
}
