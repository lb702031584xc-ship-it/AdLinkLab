import { redirect } from "next/navigation";

/**
 * /amazon/trends（热销日历）已并入 /amazon/discovery 页签。
 * 保留路由做服务端跳转，旧书签/旧链接不会 404。
 */
export default function AmazonTrendsRedirectPage() {
  redirect("/amazon/discovery?tab=trends");
}
