import { Suspense } from "react";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/keyword-starter";
import { KeywordStarterTabsClient } from "@/components/keywords/keyword-tabs-client";
import { entityApi } from "@/lib/api/entities";

export const dynamic = "force-dynamic";

/**
 * 类目关键词启动包（双 Tab）：
 * ?tab=research 需求验证（选品）| ?tab=launch 投放选词（投流），默认 research。
 */
export default async function KeywordStarterPage() {
  const lang = await getLang();

  // Offer 选择器用
  let offers: { id: string; name: string; network: string }[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      network: o.network,
    }));
  } catch {
    /* selector will be empty */
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Suspense>
        <KeywordStarterTabsClient
          dict={lang === "en" ? en : zh}
          lang={lang}
          offers={offers}
        />
      </Suspense>
    </div>
  );
}
