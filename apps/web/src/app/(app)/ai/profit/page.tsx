import { redirect } from "next/navigation";

/**
 * /ai/profit 已下线：盈利测算统一由 AI 分析工作表（/ai/analyze）承接。
 * 保留路由做服务端跳转，外部书签/旧链接不会 404（?offerId= 原样透传）。
 */
export default async function AiProfitRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string }>;
}) {
  const sp = await searchParams;
  const target =
    typeof sp.offerId === "string" && sp.offerId
      ? `/ai/analyze?offerId=${encodeURIComponent(sp.offerId)}`
      : "/ai/analyze";
  redirect(target);
}
