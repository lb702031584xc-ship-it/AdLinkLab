/**
 * 第十二批："7 天跑起来"任务流字典。
 */
export interface QuickstartDict {
  pageTitle: string;
  pageSubtitle: string;
  progress: string;
  done: string;
  remaining: string;
  graduateTitle: string;
  graduateBody: string;
  dayLabel: string;
  goDo: string;
  markDone: string;
  unmark: string;
  autoDetected: string;
  tasks: Record<string, { title: string; desc: string }>;
  sop: {
    title: string;
    subtitle: string;
    tabNames: Record<"associates" | "paapi" | "googleAds", string>;
    wizards: Record<
      "associates" | "paapi" | "googleAds",
      Array<{ title: string; body: string; link?: string; linkLabel?: string }>
    >;
    siteCheck: {
      title: string;
      subtitle: string;
      placeholder: string;
      check: string;
      articleCount: string;
      items: Record<
        "disclosure" | "privacy" | "contact" | "articles",
        { title: string; fix: string }
      >;
    };
  };
}

export const zh: QuickstartDict = {
  pageTitle: "7 天跑起来",
  pageSubtitle: "每天一个小目标，看到第一次真实点击即毕业。",
  progress: "进度",
  done: "已完成",
  remaining: "还差",
  graduateTitle: "🎓 恭喜毕业！",
  graduateBody:
    "你已经看到第一次真实点击——从 0 到 1 的路走完了。接下来把跑起来的流程复制放大：继续选品 → 建页 → 投广告。",
  dayLabel: "第",
  goDo: "去完成 →",
  markDone: "标记完成",
  unmark: "取消完成",
  autoDetected: "已自动检测到",
  tasks: {
    paapi: {
      title: "连上 PA-API",
      desc: "在 AI 设置里配好 Amazon PA-API 凭证，解锁自动选品数据。",
    },
    pipeline: {
      title: "跑一次选品流水线",
      desc: "去 /amazon/pipeline 跑一遍 6 道门，看看什么品值得测。",
    },
    landing: {
      title: "生成第一个落地页",
      desc: "用模板库一键生成一个评测/对比落地页。",
    },
    tracking: {
      title: "建跟踪链接",
      desc: "给落地页生成联盟跟踪链接，开始统计点击。",
    },
    campaign: {
      title: "开第一个广告系列",
      desc: "用 launch 向导或 ads/auto-create 建第一个广告系列。",
    },
    first_click: {
      title: "看到第一次点击",
      desc: "广告上线后，跟踪链接出现第一次真实点击（测试点击不算）。",
    },
    review: {
      title: "复盘：看首单仪表盘",
      desc: "去 Dashboard 看累计花费/点击/预估转化，规划下一周。",
    },
  },
  sop: {
    title: "开户 SOP（Day1 一起做）",
    subtitle: "三个账号手把手：要填什么、去哪里填，一步一步来。",
    tabNames: { associates: "Associates 申请", paapi: "PA-API 配置", googleAds: "Google Ads 开户" },
    wizards: {
      associates: [
        {
          title: "去对应国家站点报名",
          body: "美国站去 affiliate-program.amazon.com，其他国家去对应站点的 Associates 页面，点 Sign up（免费）。",
          link: "https://affiliate-program.amazon.com",
          linkLabel: "affiliate-program.amazon.com",
        },
        {
          title: "填写网站信息",
          body: "填你的内容站域名、网站类型、主要流量来源、月访问量——如实填写，不要夸大。",
        },
        {
          title: "税务信息选 W-8BEN",
          body: "非美国个人选 W-8BEN（证明非美税务居民），按提示填姓名、地址、签名。",
        },
        {
          title: "等审核并保住账号",
          body: "通常 1-3 天出结果；注意 180 天内需要带来 3 笔有效销售，否则账号可能被关闭。",
        },
      ],
      paapi: [
        {
          title: "在 Associates 后台申请 PA-API",
          body: "登录 Associates → 顶部 Tools → Product Advertising API → 申请访问（需要已有 Associates 账号）。",
        },
        {
          title: "拿到三件套",
          body: "Access Key、Secret Key、Partner Tag（跟踪 ID），复制保存好，不要截图外传。",
        },
        {
          title: "填到本站",
          body: "去 Amazon 选品 → PA-API 配置（或 AI 设置页），把三件套填入并保存。",
          link: "/admin/ai-settings",
          linkLabel: "去 AI 设置页",
        },
        {
          title: "验证",
          body: "回 /amazon/discovery 搜一个关键词，能出结果即配置成功。",
          link: "/amazon/discovery",
          linkLabel: "去选品验证",
        },
      ],
      googleAds: [
        {
          title: "新建 Google Ads 账号",
          body: "去 ads.google.com 点“开始使用”，按提示新建账号（不需要先建广告系列）。",
          link: "https://ads.google.com",
          linkLabel: "ads.google.com",
        },
        {
          title: "选对账单设置",
          body: "账单国家、时区、货币一次选定——货币选定后不可更改，建议与收款货币一致选 USD。",
        },
        {
          title: "绑定付款方式",
          body: "绑定信用卡/借记卡；先不充值也行，建广告系列时再设预算。",
        },
        {
          title: "先别急着建广告",
          body: "先完成选品→落地页→跟踪链接（自动化广告页一条龙），再开第一个广告系列。",
          link: "/ads/auto-create",
          linkLabel: "去自动化广告",
        },
      ],
    },
    siteCheck: {
      title: "网站就绪检查",
      subtitle: "填你的内容站域名，系统抓取检查合规三件套 + 文章数。",
      placeholder: "如：example.com",
      check: "检查",
      articleCount: "检测到文章数",
      items: {
        disclosure: {
          title: "Affiliate Disclosure 页面",
          fix: "修复：在网站加 /affiliate-disclosure 页面并在页脚链接（联盟申请必查项）。",
        },
        privacy: {
          title: "Privacy Policy 页面",
          fix: "修复：加 /privacy-policy 页面（可用模板生成，页脚链接）。",
        },
        contact: {
          title: "Contact 页面",
          fix: "修复：加 /contact 页面（邮箱表单即可）。",
        },
        articles: {
          title: "站内文章数 ≥ 5",
          fix: "修复：至少发布 5 篇评测/指南类文章再申请（空站最容易被拒）。",
        },
      },
    },
  },
};

export const en: QuickstartDict = {
  pageTitle: "7-Day Launch",
  pageSubtitle: "One small goal per day — you graduate at your first real click.",
  progress: "Progress",
  done: "done",
  remaining: "left",
  graduateTitle: "🎓 You graduated!",
  graduateBody:
    "You have seen your first real click — the 0→1 journey is complete. Now scale the loop: keep selecting products → building pages → running ads.",
  dayLabel: "Day",
  goDo: "Go do it →",
  markDone: "Mark done",
  unmark: "Undo",
  autoDetected: "Auto-detected",
  tasks: {
    paapi: {
      title: "Connect PA-API",
      desc: "Add your Amazon PA-API credentials in AI settings to unlock automated product data.",
    },
    pipeline: {
      title: "Run the pipeline once",
      desc: "Run /amazon/pipeline through its 6 gates and see which products are worth testing.",
    },
    landing: {
      title: "Build your first landing page",
      desc: "Generate a review/comparison landing page from the template library.",
    },
    tracking: {
      title: "Create a tracking link",
      desc: "Generate an affiliate tracking link for your landing page to start counting clicks.",
    },
    campaign: {
      title: "Launch your first campaign",
      desc: "Create your first campaign with the launch wizard or ads/auto-create.",
    },
    first_click: {
      title: "See your first click",
      desc: "After launch, get the first real click on a tracking link (test clicks don't count).",
    },
    review: {
      title: "Review: first-win dashboard",
      desc: "Check total spend/clicks/estimated conversions on the Dashboard and plan next week.",
    },
  },
  sop: {
    title: "Account SOP (do with Day 1)",
    subtitle: "Three accounts, hand-held: what to fill in and where, step by step.",
    tabNames: { associates: "Associates signup", paapi: "PA-API setup", googleAds: "Google Ads account" },
    wizards: {
      associates: [
        {
          title: "Sign up on your country's site",
          body: "US: affiliate-program.amazon.com; other countries: their local Associates page. Click Sign up (free).",
          link: "https://affiliate-program.amazon.com",
          linkLabel: "affiliate-program.amazon.com",
        },
        {
          title: "Fill in your website info",
          body: "Your content site domain, site type, main traffic sources, monthly visits — be honest, don't inflate.",
        },
        {
          title: "Tax info: choose W-8BEN",
          body: "Non-US individuals choose W-8BEN (certifies non-US tax residency); fill in name, address, signature.",
        },
        {
          title: "Wait for review and keep the account",
          body: "Usually 1-3 days; note you need 3 qualifying sales within 180 days or the account may be closed.",
        },
      ],
      paapi: [
        {
          title: "Request PA-API in Associates",
          body: "Log in to Associates → Tools → Product Advertising API → request access (needs an Associates account).",
        },
        {
          title: "Get the three credentials",
          body: "Access Key, Secret Key, Partner Tag (tracking ID). Copy and store them safely; don't share screenshots.",
        },
        {
          title: "Paste them into this site",
          body: "Go to Amazon selection → PA-API setup (or the AI settings page) and save the three values.",
          link: "/admin/ai-settings",
          linkLabel: "Go to AI settings",
        },
        {
          title: "Verify",
          body: "Go back to /amazon/discovery and search a keyword — results mean success.",
          link: "/amazon/discovery",
          linkLabel: "Verify in discovery",
        },
      ],
      googleAds: [
        {
          title: "Create a Google Ads account",
          body: "Go to ads.google.com → Get started, and create an account (no campaign needed yet).",
          link: "https://ads.google.com",
          linkLabel: "ads.google.com",
        },
        {
          title: "Pick billing settings carefully",
          body: "Billing country, timezone and currency are set once — currency can't be changed later. USD is recommended.",
        },
        {
          title: "Add a payment method",
          body: "Add a credit/debit card; you don't need to top up before creating your first campaign.",
        },
        {
          title: "Don't rush into ads",
          body: "Finish product → landing page → tracking link (all in automated ads) first.",
          link: "/ads/auto-create",
          linkLabel: "Go to automated ads",
        },
      ],
    },
    siteCheck: {
      title: "Website readiness check",
      subtitle: "Enter your content site domain; the system checks the compliance trio + article count.",
      placeholder: "e.g. example.com",
      check: "Check",
      articleCount: "Articles detected",
      items: {
        disclosure: {
          title: "Affiliate Disclosure page",
          fix: "Fix: add an /affiliate-disclosure page and link it in the footer (networks check this).",
        },
        privacy: {
          title: "Privacy Policy page",
          fix: "Fix: add a /privacy-policy page (generate from a template, link in footer).",
        },
        contact: {
          title: "Contact page",
          fix: "Fix: add a /contact page (an email form is enough).",
        },
        articles: {
          title: "At least 5 articles",
          fix: "Fix: publish at least 5 review/guide articles before applying (empty sites get rejected most).",
        },
      },
    },
  },
};
