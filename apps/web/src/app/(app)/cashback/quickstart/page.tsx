import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/cashback-quickstart";
import { CashbackQuickstartClient } from "@/components/cashback/cashback-quickstart-client";

export const dynamic = "force-dynamic";

/**
 * 返利站新手 7 天 SOP：搞懂钱从哪来 → 选高佣商家 → 上架 Offer → 配轮换 → 开监控 → 发第一波 → 看数据复盘。
 * 挂在返利站赛道（菜单名"新手 7 天"）。
 */
export default async function CashbackQuickstartPage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <CashbackQuickstartClient dict={l === "en" ? en : zh} lang={l} />;
}
