import { Suspense } from "react";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/ads-auto";
import { AdsAutoClient } from "@/components/ai/ads-auto-client";

export const dynamic = "force-dynamic";

/** 功能2 — 自动化广告：输入终链 URL → AI 生成广告计划 → 确认建广告。支持 ?offerId= 带入 offer（关键词从该 offer 的投放选词自动带入）。 */
export default async function AdsAutoCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string }>;
}) {
  const sp = await searchParams;
  const lang = await getLang();
  return (
    <Suspense>
      <AdsAutoClient dict={lang === "en" ? en : zh} lang={lang} initialOfferId={sp.offerId ?? null} />
    </Suspense>
  );
}
