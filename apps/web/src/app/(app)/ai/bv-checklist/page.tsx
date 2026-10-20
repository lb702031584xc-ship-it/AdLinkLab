import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/bv-checklist";
import { BvChecklistClient } from "@/components/ai/bv-checklist-client";

export const dynamic = "force-dynamic";

/**
 * #18 广告客户验证（BV）准备清单：纯静态页，勾选状态存 localStorage，不调后端。
 * 入口待协调员在导航/合规区补链接（本页不改 layout 与 dictionaries 注册）。
 */
export default async function BvChecklistPage() {
  const lang = await getLang();
  return <BvChecklistClient dict={lang === "en" ? en : zh} />;
}
