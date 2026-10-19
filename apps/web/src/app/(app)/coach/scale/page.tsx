import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/arb-coach";
import { ArbCoachScale } from "@/components/arb-coach/arb-coach-scale";

export const dynamic = "force-dynamic";

/** ⚡套利教练 / 放量记录：每次放量动作记一笔（localStorage）+ 放量铁律。 */
export default async function ArbCoachScalePage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <ArbCoachScale dict={l === "en" ? en : zh} />;
}
