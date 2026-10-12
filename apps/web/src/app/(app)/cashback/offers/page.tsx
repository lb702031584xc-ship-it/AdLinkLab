import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * 返利 Offer 已并入统一 Offer 中心（/offers?tab=cashback）。
 * 保留路由，兼容老书签/外链。
 */
export default async function CashbackOffersPage() {
  redirect("/offers?tab=cashback");
}
