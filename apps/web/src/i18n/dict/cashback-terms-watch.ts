/**
 * 功能 2 — 商家返利条款监控 (terms-watch) pages strings.
 *
 * Standalone dictionary module: imported directly by the terms-watch page /
 * component. It is intentionally NOT merged into `dictionaries.ts`
 * (left untouched per scope) — same pattern as dict/cashback.ts.
 */
export const zh = {
  termsWatch: {
    title: "返利条款监控",
    description:
      "每天自动抓取商家条款页面并计算文本 hash；hash 变化时做关键词扫描，若新出现“禁止返利流量”类条款，会记 critical 告警并自动暂停该商家的跟踪链接。",
    addTitle: "新增监控",
    merchantName: "商家名称",
    merchantNamePlaceholder: "例如：某美妆品牌",
    merchantDomain: "商家域名",
    merchantDomainPlaceholder: "www.merchant.example",
    termsUrl: "条款页面 URL",
    termsUrlPlaceholder: "https://www.merchant.example/terms",
    submit: "开始监控",
    creating: "创建中…",
    checkNow: "立即检查",
    checking: "检查中…",
    columns: {
      merchant: "商家",
      domain: "域名",
      termsUrl: "条款页面",
      allowed: "返利允许",
      status: "状态",
      lastChecked: "上次检查",
      actions: "操作",
    },
    allowed: {
      yes: "允许",
      no: "禁止",
      unknown: "未知",
    },
    status: {
      ok: "正常",
      changed: "已变化",
      blocked: "抓取失败",
    },
    empty: "还没有监控，在上方添加一个商家条款页面吧。",
    created: "已开始监控。",
    checkDone: "检查完成。",
    hashChanged: "内容有变化",
    hashUnchanged: "内容无变化",
    prohibitedNewly: "⚠ 新出现禁止返利条款",
    pausedLinksNote: "已自动暂停跟踪链接 {n} 条",
    loadFailed: "加载失败",
    retry: "重试",
  },
};

export const en = {
  termsWatch: {
    title: "Cashback Terms Watch",
    description:
      "Fetches merchant terms pages daily and hashes the text. When the hash changes, keyword scanning runs; if newly-appearing terms prohibit cashback traffic, a critical alert is raised and that merchant's tracking links are auto-paused.",
    addTitle: "Add watch",
    merchantName: "Merchant name",
    merchantNamePlaceholder: "e.g. Some Beauty Brand",
    merchantDomain: "Merchant domain",
    merchantDomainPlaceholder: "www.merchant.example",
    termsUrl: "Terms page URL",
    termsUrlPlaceholder: "https://www.merchant.example/terms",
    submit: "Start watching",
    creating: "Creating…",
    checkNow: "Check now",
    checking: "Checking…",
    columns: {
      merchant: "Merchant",
      domain: "Domain",
      termsUrl: "Terms page",
      allowed: "Cashback allowed",
      status: "Status",
      lastChecked: "Last checked",
      actions: "Actions",
    },
    allowed: {
      yes: "Allowed",
      no: "Prohibited",
      unknown: "Unknown",
    },
    status: {
      ok: "OK",
      changed: "Changed",
      blocked: "Fetch failed",
    },
    empty: "No watches yet — add a merchant terms page above.",
    created: "Watch started.",
    checkDone: "Check complete.",
    hashChanged: "content changed",
    hashUnchanged: "content unchanged",
    prohibitedNewly: "⚠ newly-appeared terms prohibit cashback traffic",
    pausedLinksNote: "auto-paused {n} tracking link(s)",
    loadFailed: "Failed to load",
    retry: "Retry",
  },
};
