import Link from "next/link";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-discovery";
import { zh as trendsZh, en as trendsEn } from "@/i18n/dict/amazon-trends";
import { zh as watchZh, en as watchEn } from "@/i18n/dict/amazon-watch";
import { AmazonDiscoveryClient } from "@/components/amazon/discovery-client";
import { AmazonTrendsClient } from "@/components/amazon/amazon-trends-client";
import { AsinWatchClient } from "@/components/amazon/asin-watch-client";

export const dynamic = "force-dynamic";

type TabKey = "discovery" | "trends" | "watch";

/**
 * Amazon 选品总入口：选品 / 趋势（原热销日历）/ 监控（原需求监控）三页签。
 * ?tab=trends|watch 切换；旧路由 /amazon/trends、/amazon/watch 保留做服务端跳转。
 */
export default async function AmazonDiscoveryPage({
  searchParams,
}: {
  searchParams?: Promise<{ keyword?: string; tab?: string }>;
}) {
  const lang = await getLang();
  const dict = lang === "en" ? en : zh;
  // 热销日历"去选品"跳转带 ?keyword=xxx，预填关键词输入框。
  const sp = (await searchParams) ?? {};
  const initialKeyword =
    typeof sp.keyword === "string" ? sp.keyword.slice(0, 100) : "";
  const tab: TabKey =
    sp.tab === "trends" || sp.tab === "watch" ? sp.tab : "discovery";

  const tabs: Array<{ key: TabKey; label: string; href: string }> = [
    { key: "discovery", label: dict.tabDiscovery, href: "/amazon/discovery" },
    {
      key: "trends",
      label: dict.tabTrends,
      href: "/amazon/discovery?tab=trends",
    },
    { key: "watch", label: dict.tabWatch, href: "/amazon/discovery?tab=watch" },
  ];

  return (
    <div>
      <nav className="mb-4 flex gap-2 border-b border-ink/10">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-signal text-ink"
                : "text-ink/55 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "discovery" && (
        <AmazonDiscoveryClient dict={dict} initialKeyword={initialKeyword} />
      )}
      {tab === "trends" && (
        <AmazonTrendsClient dict={lang === "en" ? trendsEn : trendsZh} />
      )}
      {tab === "watch" && (
        <AsinWatchClient dict={lang === "en" ? watchEn : watchZh} />
      )}
    </div>
  );
}
