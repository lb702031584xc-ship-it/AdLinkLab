import { redirect } from "next/navigation";

/**
 * /reports/launch（投放报表）已并入数据报表总入口 /reports 页签。
 * 保留路由做服务端跳转，旧书签/旧链接不会 404（?offerId= 原样透传）。
 */
export default async function LaunchArchiveRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<{ offerId?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const target =
    typeof sp.offerId === "string" && sp.offerId
      ? `/reports?tab=launch&offerId=${encodeURIComponent(sp.offerId)}`
      : "/reports?tab=launch";
  redirect(target);
}
