import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/launch-archive";
import { LaunchArchiveClient } from "@/components/reports/launch-archive-client";

export const dynamic = "force-dynamic";

/** 投放报表（投放档案）：确认计划后自动建档，填官方推荐/实际表现，看诊断、按时间筛选、下载 CSV。 */
export default async function LaunchArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string }>;
}) {
  const lang = await getLang();
  const sp = await searchParams;
  return (
    <LaunchArchiveClient dict={lang === "en" ? en : zh} initialOfferId={sp.offerId ?? null} />
  );
}
