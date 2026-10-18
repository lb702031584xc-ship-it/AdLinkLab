import { redirect } from "next/navigation";

/**
 * /launch 已下线：投放统一由自动化广告（/ads/auto-create）承接。
 * 保留路由做服务端跳转，外部书签/旧链接不会 404（?offerId= 原样透传）。
 */
export default async function LaunchRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string }>;
}) {
  const sp = await searchParams;
  const target =
    typeof sp.offerId === "string" && sp.offerId
      ? `/ads/auto-create?offerId=${encodeURIComponent(sp.offerId)}`
      : "/ads/auto-create";
  redirect(target);
}
