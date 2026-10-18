import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/admin-console";
import {
  zh as catalogZh,
  en as catalogEn,
} from "@/i18n/dict/catalog";
import { getCurrentUser } from "@/lib/api/auth";
import { AdminConsoleClient } from "@/components/admin/admin-console-client";

export const dynamic = "force-dynamic";

/**
 * 管理控制台（仅管理员）：登录账号 / 权限审批 / 备份 / 其他管理。
 * 服务端鉴权：非 admin 直接重定向，不只靠菜单隐藏。
 */
type TabId = "accounts" | "grants" | "backup" | "others";

function parseTab(v: string | undefined): TabId {
  return v === "grants" || v === "backup" || v === "others" || v === "accounts"
    ? v
    : "accounts";
}

export default async function AdminConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const sp = await searchParams;
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  const d = l === "en" ? en : zh;
  const catalogDict = l === "en" ? catalogEn : catalogZh;

  return (
    <AdminConsoleClient
      d={d}
      mode={catalogDict.mode}
      initialTab={parseTab(sp.tab)}
    />
  );
}
