import { redirect } from "next/navigation";

/**
 * /amazon/watch（需求监控）已并入 /amazon/discovery 页签。
 * 保留路由做服务端跳转，旧书签/旧链接不会 404。
 */
export default function AmazonWatchRedirectPage() {
  redirect("/amazon/discovery?tab=watch");
}
