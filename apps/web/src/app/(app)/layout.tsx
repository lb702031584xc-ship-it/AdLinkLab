import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { zh as experimentZh, en as experimentEn } from "@/i18n/dict/experiment";
import { zh as rateWatchZh, en as rateWatchEn } from "@/i18n/dict/cashback-rate-watch";
import { zh as termsWatchZh, en as termsWatchEn } from "@/i18n/dict/cashback-terms-watch";
import { zh as redirectCheckZh, en as redirectCheckEn } from "@/i18n/dict/cashback-redirect-check";
import { zh as rateCompareZh, en as rateCompareEn } from "@/i18n/dict/cashback-rate-compare";
import { zh as arbCoachZh, en as arbCoachEn } from "@/i18n/dict/arb-coach";
import { zh as settingsZh, en as settingsEn } from "@/i18n/dict/settings";
import { LangSwitcher } from "@/components/lang-switcher";
import { getCurrentUser, getViewTenant } from "@/lib/api/auth";
import { clearViewTenantAction, logoutAction } from "@/lib/api/auth-actions";
import { TrackNav } from "@/components/track-nav";
import { CoachToggle } from "@/components/coach/coach-toggle";

/**
 * Authenticated app shell: sidebar nav + user footer.
 * Requires a valid session; otherwise redirects to /login.
 */
/**
 * 导航按「新手操作流程」排序：从左到右就是操作顺序。
 *
 * 只调顺序，不增删条目；不在清单里的路径排到后面并保持原相对顺序
 * （Array.sort 是稳定排序）。这样新增页面不会因为忘记登记而被吞掉。
 */
const NAV_FLOW_ORDER = [
  "/today",
  "/start",
  "/quickstart",
  "/dashboard",
  "/click-audit",
  "/affiliate/beginner-sop",
  "/networks",
  "/catalog",
  "/offers/new",
  "/offers",
  "/keywords/starter?tab=research",
  "/ads/auto-create",
  "/campaigns",
  "/monitoring",
  "/reports/weekly",
  "/experiments",
];

function navRank(href: string): number {
  const i = NAV_FLOW_ORDER.indexOf(href);
  return i === -1 ? NAV_FLOW_ORDER.length : i;
}

function orderNavByFlow<T extends { title: string; items: { href: string }[] }>(
  sections: T[]
): T[] {
  return sections.map((sec) => ({
    ...sec,
    items: [...sec.items].sort((a, b) => navRank(a.href) - navRank(b.href)),
  }));
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const t = getDictionary(lang);

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isAdmin = user.role === "admin";
  const viewTenant = isAdmin ? await getViewTenant() : null;
  // Researcher role (Phase 4): isolated to the Research Lab only.
  // AuthUser.role is typed "admin" | "user" — the researcher role arrives
  // from the API once the auth owner widens it; compare loosely so the
  // isolation works the moment it does.
  const isResearcher = (user.role as string) === "researcher";

  const researchNavItem = {
    href: "/research",
    label: t.research.nav.title,
  };

  interface NavSection {
    title: string;
    items: { href: string; label: string; phase?: string }[];
    /** 常驻展开 + 标题高亮的一级菜单组。 */
    pinned?: boolean;
  }

  const s = t.common.nav.sections;
  const ni = t.common.nav.items;
  const ph = t.common.nav.phases;
  const experimentDict = lang === "en" ? experimentEn : experimentZh;
  const rateWatchDict = lang === "en" ? rateWatchEn : rateWatchZh;
  const termsWatchDict = lang === "en" ? termsWatchEn : termsWatchZh;
  const redirectCheckDict = lang === "en" ? redirectCheckEn : redirectCheckZh;
  const rateCompareDict = lang === "en" ? rateCompareEn : rateCompareZh;
  const arbCoachDict = lang === "en" ? arbCoachEn : arbCoachZh;
  const navSections: NavSection[] = isResearcher
    ? [{ title: "🧪 Research", items: [researchNavItem] }]
    : [
        {
          title: s.start,
                    items: [
            { href: "/today", label: lang === "en" ? "Today" : "今天" },
            {
              href: "/start",
              label: lang === "en" ? "Before you start" : "开始前",
            },
            {
              href: "/click-audit",
              label: lang === "en" ? "Click audit" : "点击对账",
            },
            { href: "/dashboard", label: t.common.nav.dashboard },
            { href: "/quickstart", label: t.quickstart.pageTitle },
          ],
        },
        {
          title: arbCoachDict.pageTitle,
          items: [
            { href: "/coach", label: arbCoachDict.nav.overview },
            { href: "/coach/templates", label: arbCoachDict.nav.templates },
            { href: "/coach/board", label: arbCoachDict.nav.board },
            { href: "/coach/scale", label: arbCoachDict.nav.scale },
          ],
        },
        {
          title: s.affiliate,
                    items: [
            { href: "/affiliate/beginner-sop", label: ni.affiliateBeginnerSop },
            { href: "/networks", label: ni.connectNetworks, phase: ph.selection },
            { href: "/catalog", label: ni.catalog, phase: ph.selection },
            { href: "/offers", label: ni.offerList, phase: ph.selection },
            { href: "/offers/new", label: ni.offerNewImport, phase: ph.selection },
            {
              href: "/keywords/starter?tab=research",
              label: ni.keywords,
              phase: ph.selection,
            },
            { href: "/ai/analyze", label: t.ai.nav.analyze, phase: ph.analysis },
            {
              href: "/ai/blueprint",
              label: t.ai.nav.blueprint,
              phase: ph.analysis,
            },
            {
              href: "/landing-pages",
              label: t.common.nav.landingPages,
              phase: ph.creative,
            },
            {
              href: "/creatives",
              label: lang === "en" ? "Creative Library" : "创意管理",
              phase: ph.creative,
            },
            { href: "/ads/auto-create", label: ni.launchAds, phase: ph.traffic },
            { href: "/ai/traffic-planner", label: t.ai.nav.trafficPlanner, phase: ph.traffic },
            {
              href: "/ai/bv-checklist",
              label: lang === "en" ? "BV Verification Checklist" : "BV 验证准备清单",
              phase: ph.traffic,
            },
            {
              href: "/ai/investigation-guide",
              label: lang === "en" ? "Investigation Guide" : "平台调查应对",
              phase: ph.monitor,
            },
            { href: "/campaigns", label: t.common.nav.campaigns, phase: ph.traffic },
            { href: "/monitoring", label: ni.trafficMonitoring, phase: ph.monitor },
            {
              href: "/reports/weekly",
              label: t.weeklyReport.nav.title,
              phase: ph.monitor,
            },
            {
              href: "/experiments",
              label: experimentDict.nav.experiments,
              phase: ph.monitor,
            },
          ],
        },
        {
          title: s.amazon,
                    items: [
            { href: "/amazon/manual-guide", label: ni.amazonManualGuide },
            // PA-API config page: admin-only (API credentials), hidden from members.
            ...(isAdmin
              ? [
                  {
                    href: "/admin/ai-settings",
                    label: ni.amazonPaapi,
                    phase: ph.selection,
                  },
                ]
              : []),
            { href: "/amazon/discovery", label: ni.amazonDiscovery, phase: ph.selection },
            { href: "/amazon/pipeline", label: ni.amazonPipeline, phase: ph.selection },
            { href: "/amazon/combo", label: ni.amazonCombo, phase: ph.analysis },
            { href: "/ai/analyze", label: t.ai.nav.analyze, phase: ph.analysis },
            { href: "/offers", label: ni.amazonImportAffiliate, phase: ph.analysis },
            {
              href: "/landing-pages",
              label: t.common.nav.landingPages,
              phase: ph.creative,
            },
            {
              href: "/creatives",
              label: lang === "en" ? "Creative Library" : "创意管理",
              phase: ph.creative,
            },
            { href: "/campaigns", label: t.common.nav.campaigns, phase: ph.traffic },
            { href: "/monitoring", label: ni.trafficMonitoring, phase: ph.monitor },
          ],
        },
        {
          title: s.cashback,
                    items: [
            { href: "/cashback/quickstart", label: ni.cashbackQuickstart },
            { href: "/cashback/offers", label: ni.cashbackOffers, phase: ph.selection },
            { href: "/cashback/monitor", label: ni.cashbackMonitor, phase: ph.selection },
            {
              href: "/keywords/starter?tab=research",
              label: ni.keywords,
              phase: ph.selection,
            },
            { href: "/ai/analyze", label: t.ai.nav.analyze, phase: ph.analysis },
            {
              href: "/ai/blueprint",
              label: t.ai.nav.blueprint,
              phase: ph.analysis,
            },
            {
              href: "/landing-pages",
              label: t.common.nav.landingPages,
              phase: ph.creative,
            },
            {
              href: "/creatives",
              label: lang === "en" ? "Creative Library" : "创意管理",
              phase: ph.creative,
            },
            { href: "/cashback/rotations", label: ni.cashbackRotations, phase: ph.traffic },
            { href: "/ads/auto-create", label: ni.launchAds, phase: ph.traffic },
            { href: "/ads/rotation-script", label: ni.rotationScript, phase: ph.traffic },
            { href: "/ads/click-monitor", label: ni.clickMonitor, phase: ph.traffic },
            { href: "/campaigns", label: t.common.nav.campaigns, phase: ph.traffic },
            { href: "/monitoring", label: ni.trafficMonitoring, phase: ph.monitor },
            {
              href: "/reports/weekly",
              label: t.weeklyReport.nav.title,
              phase: ph.monitor,
            },
            {
              href: "/experiments",
              label: experimentDict.nav.experiments,
              phase: ph.monitor,
            },
            {
              href: "/cashback/rate-watch",
              label: rateWatchDict.page.title,
              phase: ph.monitor,
            },
            {
              href: "/cashback/terms-watch",
              label: termsWatchDict.termsWatch.title,
              phase: ph.monitor,
            },
            {
              href: "/cashback/redirect-check",
              label: redirectCheckDict.page.title,
              phase: ph.monitor,
            },
            {
              href: "/cashback/rate-compare",
              label: rateCompareDict.rateCompare.title,
              phase: ph.monitor,
            },
          ],
        },
        {
          title: s.reports,
                    items: [
            {
              href: "/daily-alerts",
              label: (lang === "en" ? "Daily Alerts" : "每日预警"),
              phase: ph.monitor,
            },
            { href: "/reports", label: ni.launchArchive, phase: ph.monitor },
            { href: "/payout-watch", label: ni.payoutWatch, phase: ph.monitor },
            { href: "/budget-rules", label: ni.budgetRules, phase: ph.monitor },
            // 成本账 + 账号矩阵（2026-10-24，7 条清单）
            { href: "/cost-ledger", label: lang === "en" ? "Cost Ledger" : "成本账", phase: ph.monitor },
            { href: "/account-matrix", label: lang === "en" ? "Account Matrix" : "账号矩阵", phase: ph.monitor },
            { href: "/ban-log", label: lang === "en" ? "Ban Log" : "封号复盘", phase: ph.monitor },
            { href: "/brand-keywords", label: lang === "en" ? "Brand Keywords" : "品牌词", phase: ph.monitor },
            { href: "/kill-rules", label: lang === "en" ? "Kill Rules" : "砍线规则", phase: ph.monitor },
            { href: "/direct-test", label: lang === "en" ? "Direct Test" : "直链速测", phase: ph.traffic },
            { href: "/tracking-links", label: t.common.nav.trackingLinks },
            { href: "/clicks", label: t.common.nav.clicks },
            { href: "/conversions", label: t.common.nav.conversions },
            { href: "/orders", label: ni.orderLedger },
            { href: "/search-terms", label: ni.searchTerms },
            { href: "/ai/decision", label: t.ai.nav.decision },
            { href: "/ai/strategy", label: t.strategy.nav.strategy },
            researchNavItem,
          ],
        },
        {
          title: s.system,
          items: [
            {
              href: "/settings",
              label: (lang === "en" ? settingsEn : settingsZh).page.title,
            },
            {
              href: "/data-management",
              label: lang === "en" ? "Data Management" : "数据管理",
            },
            { href: "/script-integrations", label: t.common.nav.scriptIntegrations },
            { href: "/jobs", label: t.common.nav.jobs },
            { href: "/audit-logs", label: t.common.nav.auditLogs },
            ...(isAdmin
              ? [
                  { href: "/admin/users", label: t.auth.nav.users },
                  { href: "/admin/api-keys", label: t.auth.nav.apiKeys },
                ]
              : []),
          ],
        },
        // 管理控制台：仅管理员可见的一级菜单，收拢所有 admin-only 操作。
        ...(isAdmin
          ? [
              {
                title: s.adminConsole,
                items: [
                  {
                    href: "/admin/console",
                    label: ni.adminConsoleOverview,
                  },
                ],
              },
            ]
          : []),
      ];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-r border-ink/10 bg-ink text-mist">
        <div className="px-5 py-6">
          <p className="font-display text-2xl tracking-tight">AdLinkLab</p>
          <p className="mt-1 text-sm text-mist/70">
            {t.common.brand.phase("Phase 8.4.7")}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-4 px-3 pb-8" aria-label="Tracks">
          <TrackNav sections={orderNavByFlow(navSections)} />
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-sm font-medium text-white">{user.email}</p>
          <p className="mt-1">
            <span className="inline-block rounded-full bg-white/10 px-2 py-0.5 text-xs text-mist/80">
              {isAdmin ? t.auth.userMenu.admin : t.auth.userMenu.user}
            </span>
          </p>
          <div className="mt-3 flex items-center gap-2">
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md px-2.5 py-1 text-xs font-medium text-mist/60 transition hover:bg-white/5 hover:text-white"
              >
                {t.auth.userMenu.logout}
              </button>
            </form>
            <LangSwitcher />
          </div>
          <CoachToggle dict={t.coach} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        {viewTenant ? (
          <div className="flex items-center justify-between gap-4 bg-sand/20 px-6 py-2 text-sm text-ink lg:px-10">
            <span>{t.auth.banner.viewingAs}</span>
            <form action={clearViewTenantAction}>
              <button
                type="submit"
                className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-paper transition hover:bg-ink/85"
              >
                {t.auth.banner.exitView}
              </button>
            </form>
          </div>
        ) : null}
        <main className="px-6 py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
