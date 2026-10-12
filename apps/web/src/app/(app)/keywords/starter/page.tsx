import { Suspense } from "react";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/keyword-starter";
import { KeywordStarterTabsClient } from "@/components/keywords/keyword-tabs-client";

export const dynamic = "force-dynamic";

/**
 * 类目关键词启动包（双 Tab）：
 * ?tab=research 需求验证（选品）| ?tab=launch 投放选词（投流），默认 research。
 */
export default async function KeywordStarterPage() {
  const lang = await getLang();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Suspense>
        <KeywordStarterTabsClient dict={lang === "en" ? en : zh} lang={lang} />
      </Suspense>
    </div>
  );
}
