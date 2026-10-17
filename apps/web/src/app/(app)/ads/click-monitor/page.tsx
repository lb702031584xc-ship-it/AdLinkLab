import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/ads-click-monitor";
import { ClickMonitorClient } from "@/components/ads/click-monitor-client";

export const dynamic = "force-dynamic";

/** 点击次数监测 Script 生成器：累计点击达到上限时自动暂停广告。 */
export default async function ClickMonitorPage() {
  const lang = await getLang();
  return <ClickMonitorClient dict={lang === "en" ? en : zh} />;
}
