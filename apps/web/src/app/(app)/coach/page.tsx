import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/arb-coach";
import { ArbCoachClient } from "@/components/arb-coach/arb-coach-client";

export const dynamic = "force-dynamic";

/**
 * ⚡套利教练：流量套利（mediabuy arbitrage）手把手教练模式。
 * pop/push 便宜流量 → 高转化 Offer → $10 测组合 → 小时级砍/留。
 * 与 Google 搜索打法（7 天 SOP / 工作表）并列的独立入口。
 * 注：导航菜单接线由父代理处理，本页不碰 (app)/layout.tsx。
 */
export default async function ArbCoachPage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <ArbCoachClient dict={l === "en" ? en : zh} lang={l} />;
}
