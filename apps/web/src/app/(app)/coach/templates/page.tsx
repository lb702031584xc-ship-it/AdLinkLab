import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/arb-coach";
import { ArbCoachTemplates } from "@/components/arb-coach/arb-coach-templates";

export const dynamic = "force-dynamic";

/** ⚡套利教练 / 组合模板库：初/中/高三档完整开测模板，一键应用到速测看板。 */
export default async function ArbCoachTemplatesPage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <ArbCoachTemplates dict={l === "en" ? en : zh} />;
}
