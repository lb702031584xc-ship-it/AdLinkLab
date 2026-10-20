/**
 * Feature 5 — 返利比价（rate-compare）page strings.
 *
 * Standalone dictionary module: imported directly by the rate-compare
 * page / component. It is intentionally NOT merged into
 * `dictionaries.ts` (left untouched per scope), following the same
 * pattern as the cashback dict.
 */
export const zh = {
  rateCompare: {
    title: "返利比价",
    description:
      "为一个商户配置多个返利网入口，每天自动抓取各家返利比例并横向对比；当其他家比主推（列表第一家）高出 1 个百分点以上时，会收到切换建议。",
    groupsTitle: "比价分组",
    newGroup: "新建分组",
    name: "分组名称",
    namePlaceholder: "例如：Nike 比价",
    merchantDomain: "商户域名",
    merchantDomainPlaceholder: "nike.com",
    portals: "返利网入口（第一家为主推）",
    portalName: "返利网名称",
    portalUrl: "商户在该返利网的页面 URL",
    addPortal: "添加一家",
    remove: "删除",
    create: "创建分组",
    creating: "创建中…",
    createSuccess: "分组已创建",
    back: "返回分组列表",
    loading: "加载中…",
    columns: {
      portal: "返利网",
      rate: "返利比例",
      checkedAt: "抓取时间",
      primary: "主推",
      best: "最高",
    },
    primaryBadge: "主推",
    bestBadge: "最高",
    noRate: "未抓到",
    compareNow: "立即比价",
    comparing: "比价中…",
    compareDone: "比价完成",
    compareSummary: (
      total: number,
      ok: number,
      bestPortal: string | null,
      bestRate: string | null
    ) =>
      `检查 ${total} 家，成功 ${ok} 家${
        bestPortal
          ? `，最优 ${bestPortal}${bestRate ? `（${bestRate}）` : ""}`
          : ""
      }`,
    alertHint: "高出主推 ≥1 个百分点时会自动生成一条切换建议（告警）。",
    latestTitle: "各家返利对比",
    historyTitle: "抓取历史",
    noGroups: "还没有比价分组，先新建一个吧。",
    noSnapshots: "暂无快照，点击「立即比价」开始第一次抓取。",
    groupCount: (n: number) => `共 ${n} 个分组`,
    portalsCount: (n: number) => `${n} 家`,
    error: "请求失败，请稍后重试。",
  },
};

export const en = {
  rateCompare: {
    title: "Rate Compare",
    description:
      "Configure several cashback portals for one merchant. Rates are fetched and compared daily; a switch suggestion is raised when another portal beats the primary (the first one) by 1 percentage point or more.",
    groupsTitle: "Compare Groups",
    newGroup: "New Group",
    name: "Group Name",
    namePlaceholder: "e.g. Nike comparison",
    merchantDomain: "Merchant Domain",
    merchantDomainPlaceholder: "nike.com",
    portals: "Portal entries (first one is primary)",
    portalName: "Portal Name",
    portalUrl: "Merchant page URL on this portal",
    addPortal: "Add a portal",
    remove: "Remove",
    create: "Create Group",
    creating: "Creating…",
    createSuccess: "Group created",
    back: "Back to groups",
    loading: "Loading…",
    columns: {
      portal: "Portal",
      rate: "Cashback Rate",
      checkedAt: "Checked At",
      primary: "Primary",
      best: "Best",
    },
    primaryBadge: "Primary",
    bestBadge: "Best",
    noRate: "Not fetched",
    compareNow: "Compare Now",
    comparing: "Comparing…",
    compareDone: "Comparison done",
    compareSummary: (
      total: number,
      ok: number,
      bestPortal: string | null,
      bestRate: string | null
    ) =>
      `checked ${total}, ok ${ok}${
        bestPortal ? `, best ${bestPortal}${bestRate ? ` (${bestRate})` : ""}` : ""
      }`,
    alertHint:
      "A switch suggestion (alert) is created automatically when another portal beats the primary by ≥1 percentage point.",
    latestTitle: "Portal Rate Comparison",
    historyTitle: "Fetch History",
    noGroups: "No compare groups yet — create one to get started.",
    noSnapshots: "No snapshots yet — click “Compare Now” to run the first check.",
    groupCount: (n: number) => `${n} group(s)`,
    portalsCount: (n: number) => `${n} portal(s)`,
    error: "Request failed, please try again later.",
  },
};
