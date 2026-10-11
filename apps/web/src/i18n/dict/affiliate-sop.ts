/** 联盟新手 7 天 SOP — i18n dict */

export interface SopDay {
  day: number;
  title: string;
  goal: string;
  checks: string[];
  profitTip: string;
  links: { label: string; href: string }[];
}

export interface AffiliateSopDict {
  pageTitle: string;
  pageDesc: string;
  progress: string;
  reset: string;
  resetConfirm: string;
  dayLabel: (n: number) => string;
  goalLabel: string;
  checklistLabel: string;
  profitTipLabel: string;
  toolsLabel: string;
  complete: string;
  days: SopDay[];
}

export const zh: AffiliateSopDict = {
  pageTitle: "联盟新手 7 天 SOP",
  pageDesc:
    "7 天从 0 到跑出第一单：选联盟 → 完善资料 → 选 Offer → 配链接监控 → 落地页 → Google Ads 首测 → 看数据优化。每天照着 checklist 做。",
  progress: "完成进度",
  reset: "重置进度",
  resetConfirm: "确定要清空所有勾选进度吗？",
  dayLabel: (n) => `第 ${n} 天`,
  goalLabel: "今日目标",
  checklistLabel: "Checklist",
  profitTipLabel: "💰 盈利加速建议",
  toolsLabel: "用到的工具",
  complete: "🎉 7 天完成！你已经跑通了完整链路，继续优化放大吧。",
  days: [
    {
      day: 1,
      title: "选联盟 & 注册账号",
      goal: "选定 2–3 个联盟并提交注册申请",
      checks: [
        "了解主流联盟类型：综合网盟（Awin/Impact）、独立站联盟（PartnerBoost）、亚马逊卖家联盟（YeahPromos/Levanta）",
        "准备注册资料：网站 URL、联系邮箱、收款方式（Payoneer 优先）",
        "提交 2–3 个联盟的注册申请",
        "记录每个联盟的审核状态和预计时间",
      ],
      profitTip:
        "优先选有独立站 Offer 的联盟——独立站佣金通常 10–30%，比亚马逊联盟 3–4.5% 高几倍。同样流量，收入差 3–5 倍。",
      links: [{ label: "联盟网络", href: "/networks" }],
    },
    {
      day: 2,
      title: "完善资料 & 定推广方式",
      goal: "资料一次过审，推广方式定位清晰",
      checks: [
        "填写公司/个人信息：名称与网站品牌一致（如 ElectroVibe Lab）",
        "Primary Region 选主要受众地区（如 United States）",
        "推广方式只勾真实在用的：Content（Editorial/Influencer）+ Search（Linking via Landing Pages）",
        "Campaign 描述写清：网站定位 + 流量来源（SEO/Google Ads/社媒）+ 联盟披露",
        "绑定收款：Payoneer 或银行卡",
      ],
      profitTip:
        "资料写得专业 = 商家 Offer 通过率高 = 更快拿到高佣金 Offer。千万别勾 Direct Linking（直链），很多商家会自动拒绝这种发布者。",
      links: [{ label: "联盟网络", href: "/networks" }],
    },
    {
      day: 3,
      title: "选 Offer",
      goal: "筛出 3–5 个值得测试的 Offer",
      checks: [
        "浏览联盟 Offer 市场，按类目筛选（选你懂的类目）",
        "用 AI 分析看 Offer 风险：/ai/analyze 跑一遍条款",
        "记录关键指标：佣金率、Cookie 有效期、结算周期、最低支付额",
        "排除项：佣金率 <5%、Cookie <7 天、需要预付费、条款含糊的",
        "最终选定 3–5 个 Offer 进入测试",
      ],
      profitTip:
        "新手公式：佣金率 × 客单价 × 转化率。优先选高客单价（>$50）+ 佣金率 >10% 的，1 单顶 10 单。别贪多，3 个 Offer 足够测出感觉。",
      links: [
        { label: "Offer 列表", href: "/offers" },
        { label: "AI 分析", href: "/ai/analyze" },
        { label: "条款解析", href: "/ai/terms" },
      ],
    },
    {
      day: 4,
      title: "拿追踪链接 & 配健康监控",
      goal: "每个 Offer 都有可监控的追踪链接",
      checks: [
        "为每个 Offer 生成专属追踪链接",
        "在追踪链接详情页设置健康检查频率（跑 Google Ads 的设 15–30 分钟）",
        "链接来源标记：手动填的手选 MANUAL，联盟同步的选 AUTO",
        "点「立即检查」验证链接可达、不是空白页/出错页",
        "确认死链自动暂停 + 告警已开启",
      ],
      profitTip:
        "跑付费流量时，死链 = 烧钱。Offer 页面一下线，广告还在烧，每 15 分钟检查一次能帮你省下真金白银。这是付费玩家和免费玩家的最大区别。",
      links: [
        { label: "追踪链接", href: "/tracking-links" },
        { label: "链接健康", href: "/link-health" },
      ],
    },
    {
      day: 5,
      title: "准备落地页",
      goal: "每个测试 Offer 都有高转化落地页",
      checks: [
        "用 /landing-pages/analyze 给现有落地页打分，低于 70 分的优化",
        "落地页必备：痛点开头、产品对比、FAQ、多个 CTA、联盟披露",
        "移动端检查：按钮够大、加载 <3 秒、吸顶 CTA 正常",
        "每个落地页只推 1 个 Offer，别混",
      ],
      profitTip:
        "落地页转化率每提升 1%，同样的广告费就多赚 1%。新手最容易犯的错是直接把广告导到商家首页——多一层自己的落地页，转化率经常翻倍，还符合 Google Ads 政策。",
      links: [{ label: "落地页分析", href: "/landing-pages/analyze" }],
    },
    {
      day: 6,
      title: "Google Ads 首测",
      goal: "小预算跑出第一波真实数据",
      checks: [
        "每个 Offer 建 1 个 Campaign，日预算 $10–20",
        "关键词选高购买意图词（如 best + 产品名），别碰品牌词",
        "广告落地页指向自己的落地页，不是直链商家",
        "开启转化追踪",
        "跑满 24 小时再看数据，别中途乱调",
      ],
      profitTip:
        "第一波测试的目标不是盈利，是买数据。$20 买 100 个点击，你就知道哪个 Offer 有戏。千万别第一天就加预算——让数据说话，24 小时后再决定。",
      links: [
        { label: "投广告", href: "/ads/auto-create" },
        { label: "关键词包", href: "/keywords/starter" },
      ],
    },
    {
      day: 7,
      title: "看数据 & 优化放大",
      goal: "找到第一个 ROI > 1 的 Offer，制定下周计划",
      checks: [
        "看每个 Offer 的点击、转化、花费、收入",
        "算 ROI：ROI < 0.5 的暂停，0.5–1 的优化落地页/关键词，>1 的加预算",
        "检查死链告警：有没有 Offer 页面挂掉",
        "复盘：哪个关键词/广告语转化最好",
        "制定下周计划：加预算 / 加 Offer / 扩关键词",
      ],
      profitTip:
        "第一周的目标不是暴富，是找到 1 个 ROI > 1 的 Offer。找到了就复制放大：加预算、扩相似关键词、找同类 Offer。一个盈利模型跑通，比 10 个半吊子强 100 倍。",
      links: [
        { label: "数据报表", href: "/dashboard" },
        { label: "流量监控", href: "/monitoring" },
        { label: "每周报告", href: "/reports/weekly" },
      ],
    },
  ],
};

export const en: AffiliateSopDict = {
  pageTitle: "Affiliate 7-Day Starter SOP",
  pageDesc:
    "From 0 to your first conversion in 7 days: pick networks → complete profile → choose offers → set up link monitoring → landing pages → first Google Ads test → analyze & optimize. Follow the checklist each day.",
  progress: "Progress",
  reset: "Reset progress",
  resetConfirm: "Clear all checked progress?",
  dayLabel: (n) => `Day ${n}`,
  goalLabel: "Today's goal",
  checklistLabel: "Checklist",
  profitTipLabel: "💰 Profit acceleration tips",
  toolsLabel: "Tools you'll use",
  complete: "🎉 7 days done! You've run the full loop — keep optimizing and scaling.",
  days: [
    {
      day: 1,
      title: "Pick Networks & Register",
      goal: "Choose 2–3 networks and submit applications",
      checks: [
        "Learn the network types: general (Awin/Impact), DTC (PartnerBoost), Amazon-seller (YeahPromos/Levanta)",
        "Prepare registration info: website URL, contact email, payout method (Payoneer recommended)",
        "Submit applications to 2–3 networks",
        "Track each application's review status and ETA",
      ],
      profitTip:
        "Prioritize networks with DTC-site offers — commissions are often 10–30% vs Amazon Associates' 3–4.5%. Same traffic, 3–5x revenue.",
      links: [{ label: "Networks", href: "/networks" }],
    },
    {
      day: 2,
      title: "Complete Profile & Promo Methods",
      goal: "Pass review first time with a sharp profile",
      checks: [
        "Fill in company/personal info: name matches your site brand (e.g. ElectroVibe Lab)",
        "Set Primary Region to your main audience (e.g. United States)",
        "Only check promo methods you actually use: Content (Editorial/Influencer) + Search (Linking via Landing Pages)",
        "Write a clear campaign description: site niche + traffic sources + affiliate disclosure",
        "Connect payout: Payoneer or bank account",
      ],
      profitTip:
        "A professional profile = higher offer approval rates = faster access to high-commission offers. Never check Direct Linking — many advertisers auto-reject such publishers.",
      links: [{ label: "Networks", href: "/networks" }],
    },
    {
      day: 3,
      title: "Pick Offers",
      goal: "Shortlist 3–5 offers worth testing",
      checks: [
        "Browse the offer marketplace, filter by categories you know",
        "Run /ai/analyze on terms to screen offer risk",
        "Record key metrics: commission rate, cookie duration, payout cycle, minimum payout",
        "Exclude: commission <5%, cookie <7 days, upfront fees, vague terms",
        "Finalize 3–5 offers for testing",
      ],
      profitTip:
        "Beginner formula: commission rate × order value × conversion rate. Prefer high-ticket (>$50) + >10% commission — one sale equals ten. Don't over-pick; 3 offers is enough to learn.",
      links: [
        { label: "Offers", href: "/offers" },
        { label: "AI Analyze", href: "/ai/analyze" },
        { label: "Terms Parser", href: "/ai/terms" },
      ],
    },
    {
      day: 4,
      title: "Get Links & Set Up Monitoring",
      goal: "Every offer has a monitored tracking link",
      checks: [
        "Generate a dedicated tracking link per offer",
        "Set health-check frequency on each link's detail page (15–30 min for Google Ads traffic)",
        "Mark link source: MANUAL for pasted links, AUTO for network-synced",
        "Hit “Check now” to verify the link loads and isn't blank/error",
        "Confirm dead-link auto-pause + alerts are on",
      ],
      profitTip:
        "With paid traffic, a dead link = burning money. If an offer page goes down while ads keep running, a 15-min check interval saves real cash. This separates paid players from free-traffic players.",
      links: [
        { label: "Tracking Links", href: "/tracking-links" },
        { label: "Link Health", href: "/link-health" },
      ],
    },
    {
      day: 5,
      title: "Prepare Landing Pages",
      goal: "A high-converting landing page per test offer",
      checks: [
        "Score existing pages with /landing-pages/analyze; fix anything under 70",
        "Landing page must-haves: pain-point hook, product comparison, FAQ, multiple CTAs, affiliate disclosure",
        "Mobile check: big buttons, <3s load, sticky CTA works",
        "One offer per landing page — never mix",
      ],
      profitTip:
        "Every +1% conversion rate = +1% revenue on the same ad spend. Beginners' biggest mistake is sending ads straight to the merchant homepage — your own landing page often doubles conversion and complies with Google Ads policy.",
      links: [{ label: "Landing Page Analyzer", href: "/landing-pages/analyze" }],
    },
    {
      day: 6,
      title: "First Google Ads Test",
      goal: "Get the first wave of real data on a small budget",
      checks: [
        "1 campaign per offer, $10–20/day budget",
        "High-intent keywords (e.g. best + product name); avoid brand terms",
        "Ads point to YOUR landing page, never direct-link the merchant",
        "Enable conversion tracking",
        "Run a full 24h before judging — don't tweak mid-flight",
      ],
      profitTip:
        "The first test buys data, not profit. $20 for 100 clicks tells you which offer has legs. Never raise budget on day one — let the data speak after 24 hours.",
      links: [
        { label: "Create Ads", href: "/ads/auto-create" },
        { label: "Keyword Packs", href: "/keywords/starter" },
      ],
    },
    {
      day: 7,
      title: "Analyze & Optimize",
      goal: "Find your first ROI > 1 offer and plan next week",
      checks: [
        "Review clicks, conversions, spend, revenue per offer",
        "ROI < 0.5 → pause; 0.5–1 → optimize page/keywords; >1 → scale budget",
        "Check dead-link alerts: did any offer page go down?",
        "Debrief: which keywords/ad copy converted best",
        "Next-week plan: raise budget / add offers / expand keywords",
      ],
      profitTip:
        "Week one's goal isn't riches — it's finding ONE offer with ROI > 1. Then copy and scale: more budget, similar keywords, similar offers. One proven model beats ten half-baked ones by 100x.",
      links: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Traffic Monitor", href: "/monitoring" },
        { label: "Weekly Reports", href: "/reports/weekly" },
      ],
    },
  ],
};
