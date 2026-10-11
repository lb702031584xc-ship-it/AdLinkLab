import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/affiliate-sop";
import { AffiliateSopClient } from "@/components/affiliate/affiliate-sop-client";

export const dynamic = "force-dynamic";

/**
 * 联盟新手 7 天 SOP：选联盟 → 资料 → 选 Offer → 链接监控 → 落地页 → Google Ads 首测 → 优化。
 * 挂在联盟营销赛道菜单首位（菜单名"新手 7 天 SOP"）。
 */
export default async function AffiliateBeginnerSopPage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <AffiliateSopClient dict={l === "en" ? en : zh} lang={l} />;
}
