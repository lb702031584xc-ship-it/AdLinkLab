export interface CashbackQuickstartStep {
  id: string;
  dayLabel: string;
  title: string;
  intro: string[];
  checklist: string[];
  tools: { label: string; href: string; external?: boolean }[];
}

export interface CashbackQuickstartDict {
  title: string;
  description: string;
  progressLabel: string;
  progressText: string;
  stepDone: string;
  stepTodo: string;
  expand: string;
  collapse: string;
  profitTitle: string;
  profitTips: string[];
  steps: CashbackQuickstartStep[];
}

export const zh: CashbackQuickstartDict = {
  title: "返利站新手 7 天 SOP",
  description:
    "从零把返利站跑起来：搞懂钱从哪来 → 选高佣商家 → 上架 Offer → 配轮换 → 开监控 → 发第一波 → 看数据复盘。进度自动保存在本机浏览器。",
  progressLabel: "7 天进度",
  progressText: "{done}/{total}",
  stepDone: "已完成",
  stepTodo: "进行中",
  expand: "展开",
  collapse: "收起",
  profitTitle: "新手短期利润三板斧",
  profitTips: [
    "追涨：rate-watch 涨幅告警一响，当天就把涨幅 Top3 顶到「今日高返」",
    "避坑：terms-watch 自动暂停收紧 terms 的商家，不白推",
    "保链路：dead-link 每小时检查 + 轮换配置，保证链接 100% 可点",
  ],
  steps: [
    {
      id: "money",
      dayLabel: "Day 1",
      title: "搞懂钱从哪来",
      intro: [
        "返利站的利润公式：利润 = 订单量 × 客单价 × 利差。用户经你的链接去商家下单，商家按订单金额给你 CPS 佣金（比如 10%），你返 8% 给用户，自己留下 2% 利差。",
        "三个乘数里，新手唯一能快速撬动的是「订单量」——而订单量来自一句话：用户觉得在你这买更划算。后面 6 天做的每一件事，都是为了这句话。",
      ],
      checklist: ["读完 Day 1 的两段话", "后台菜单走一遍，知道每个功能在哪", "记住两个词：CPS（按成交付佣金）、利差（你留下的那部分）"],
      tools: [],
    },
    {
      id: "merchants",
      dayLabel: "Day 2",
      title: "选 5 个高佣商家",
      intro: [
        "只做用户本来就要买的东西：3C、美妆、母婴。别教育市场，别碰用户没需求的品类。",
        "打开费率对比，同一个品类里谁的返利比例最高就选谁。目标：定 1 个主品类，记下 5 个商家名 + 返利比例。",
      ],
      checklist: ["打开费率对比看一圈", "定下 1 个主品类（3C / 美妆 / 母婴三选一）", "记下 5 个商家名 + 各自的返利比例"],
      tools: [{ label: "费率对比", href: "/cashback/rate-compare" }],
    },
    {
      id: "offers",
      dayLabel: "Day 3",
      title: "上架 Offer",
      intro: [
        "一个商家一条 Offer。建的时候把 terms 里「什么不返」（exclusions）抄进备注——这是保命项：用户下单不返钱，骂的是你。",
        "返利比例跟 Day 2 记的一致，保存后自己点一遍链接确认能跳。",
      ],
      checklist: ["在返利 Offer 页建 5 条 Offer", "每条都贴上 exclusions（什么不返）", "核对返利比例无误，自己点一遍链接"],
      tools: [{ label: "返利 Offer", href: "/cashback/offers" }],
    },
    {
      id: "rotation",
      dayLabel: "Day 4",
      title: "配轮换",
      intro: [
        "一个商家配 2–3 条链路，坏一条自动切另一条。返利链接失效 = 直接丢单，用户还会觉得你是骗子。",
        "配完用直链轮换 Script 跑一遍，亲眼看到跳转正常才算完。",
      ],
      checklist: ["轮换配置里每个商家 ≥2 条链路", "跑一遍直链轮换 Script，确认跳转正常"],
      tools: [
        { label: "轮换配置", href: "/cashback/rotations" },
        { label: "直链轮换 Script", href: "/ads/rotation-script" },
      ],
    },
    {
      id: "monitor",
      dayLabel: "Day 5",
      title: "开监控",
      intro: [
        "三个自动哨兵，24 小时替你盯着：涨幅告警（赚钱信号）、terms 变更（避坑信号）、死链检查（保命信号）。",
        "全打开之后，你每天要做的就是看一眼告警，该推的推，该停的停。",
      ],
      checklist: ["rate-watch 涨幅告警打开", "terms-watch 打开", "redirect-check 死链检查打开"],
      tools: [{ label: "返利监控", href: "/cashback/monitor" }],
    },
    {
      id: "launch",
      dayLabel: "Day 6",
      title: "发第一波",
      intro: [
        "看涨幅监控，把涨幅 Top3 做成一张「今日高返」图（或一句话文案），推给你的种子用户——微信群、朋友圈、小红书都行。",
        "新用户首单自掏 5 元补贴：买的不是订单，是第一个活跃用户。有了第一个，后面才有复购和裂变。",
      ],
      checklist: ["找出涨幅 Top3 商家", "做一张今日高返图 / 一句话文案", "发出去了（截图留存）", "新用户首单 5 元补贴规则写好"],
      tools: [{ label: "涨幅监控", href: "/cashback/rate-watch" }],
    },
    {
      id: "review",
      dayLabel: "Day 7",
      title: "看数据复盘",
      intro: [
        "对一下涨幅榜和出单榜：出单的商家下周加大推，没动静的换掉。返利站是周周调仓的生意，没有一劳永逸的选品。",
        "定下周主推 3 个商家，回到 Day 2 的逻辑再走一遍。",
      ],
      checklist: ["看本周哪个 Offer 出单了", "涨幅榜和出单榜对一遍", "定下周主推的 3 个商家"],
      tools: [
        { label: "返利监控", href: "/cashback/monitor" },
        { label: "周报", href: "/reports/weekly" },
      ],
    },
  ],
};

export const en: CashbackQuickstartDict = {
  title: "Cashback 7-Day Quickstart",
  description:
    "Get your cashback site running from zero: understand the money → pick high-commission merchants → list offers → set up rotation → turn on monitoring → launch the first push → review the data. Progress is auto-saved in your browser.",
  progressLabel: "7-day progress",
  progressText: "{done}/{total}",
  stepDone: "Done",
  stepTodo: "In progress",
  expand: "Expand",
  collapse: "Collapse",
  profitTitle: "Three short-term profit levers",
  profitTips: [
    "Ride the spike: when rate-watch fires a hike alert, push the Top 3 hiked merchants as “Today's top cashback” the same day",
    "Avoid traps: terms-watch auto-pauses merchants that tightened their terms — never promote for nothing",
    "Keep links alive: hourly dead-link checks + rotation so every link stays clickable",
  ],
  steps: [
    {
      id: "money",
      dayLabel: "Day 1",
      title: "Understand where the money comes from",
      intro: [
        "The cashback profit formula: profit = order volume × average order value × spread. A user buys through your link, the merchant pays you a CPS commission (e.g. 10%), you give 8% back to the user and keep a 2% spread.",
        "Of the three multipliers, order volume is the only one a beginner can move fast — and it comes from one sentence: the user feels buying through you is cheaper. Everything in the next 6 days serves that sentence.",
      ],
      checklist: [
        "Read the two paragraphs of Day 1",
        "Walk through the backend menu once so you know where everything is",
        "Remember two terms: CPS (commission per sale) and spread (the part you keep)",
      ],
      tools: [],
    },
    {
      id: "merchants",
      dayLabel: "Day 2",
      title: "Pick 5 high-commission merchants",
      intro: [
        "Only sell what users already buy: 3C electronics, beauty, mom & baby. Don't educate the market, don't touch categories with no demand.",
        "Open rate comparison and pick the highest-cashback merchants in the same category. Goal: lock 1 main category, note 5 merchant names + their cashback rates.",
      ],
      checklist: [
        "Browse the rate comparison page",
        "Lock 1 main category (3C / beauty / mom & baby)",
        "Note 5 merchant names + each cashback rate",
      ],
      tools: [{ label: "Rate comparison", href: "/cashback/rate-compare" }],
    },
    {
      id: "offers",
      dayLabel: "Day 3",
      title: "List offers",
      intro: [
        "One offer per merchant. Copy the “what's excluded” part of the terms into the notes — this is what keeps you alive: when a user's order earns no cashback, you're the one who gets blamed.",
        "Keep the cashback rate consistent with what you noted on Day 2, then click each link yourself to confirm it redirects.",
      ],
      checklist: [
        "Create 5 offers on the cashback offers page",
        "Paste the exclusions (what earns no cashback) on each",
        "Verify the rates are correct and click every link yourself",
      ],
      tools: [{ label: "Cashback offers", href: "/cashback/offers" }],
    },
    {
      id: "rotation",
      dayLabel: "Day 4",
      title: "Set up rotation",
      intro: [
        "Give each merchant 2–3 links so a broken one auto-switches to the next. A dead cashback link means lost orders — and users calling you a scam.",
        "Run the direct-link rotation script once and watch the redirect work with your own eyes before calling it done.",
      ],
      checklist: [
        "At least 2 links per merchant in rotation config",
        "Run the direct-link rotation script and confirm redirects work",
      ],
      tools: [
        { label: "Rotation config", href: "/cashback/rotations" },
        { label: "Direct-link rotation script", href: "/ads/rotation-script" },
      ],
    },
    {
      id: "monitor",
      dayLabel: "Day 5",
      title: "Turn on monitoring",
      intro: [
        "Three automatic watchdogs working 24/7 for you: hike alerts (money signal), terms changes (trap signal), dead-link checks (survival signal).",
        "Once they're on, your daily job is just glancing at alerts: promote what should be promoted, pause what should be paused.",
      ],
      checklist: [
        "Turn on rate-watch hike alerts",
        "Turn on terms-watch",
        "Turn on redirect-check dead-link checks",
      ],
      tools: [{ label: "Cashback monitoring", href: "/cashback/monitor" }],
    },
    {
      id: "launch",
      dayLabel: "Day 6",
      title: "Launch the first push",
      intro: [
        "Check the hike monitor, turn the Top 3 hiked merchants into a “Today's top cashback” image (or a one-line post), and push it to your seed users — WeChat groups, Moments, Xiaohongshu, anywhere.",
        "Subsidize new users' first order out of your own pocket (¥5): you're not buying the order, you're buying your first active user. The first one brings repeat buys and referrals.",
      ],
      checklist: [
        "Find the Top 3 hiked merchants",
        "Make one “today's top cashback” image / one-line copy",
        "Push it out (keep a screenshot)",
        "Write down the ¥5 first-order subsidy rule for new users",
      ],
      tools: [{ label: "Hike monitor", href: "/cashback/rate-watch" }],
    },
    {
      id: "review",
      dayLabel: "Day 7",
      title: "Review the data",
      intro: [
        "Compare the hike leaderboard with the order leaderboard: double down on merchants that converted, swap out the silent ones. A cashback site rebalances weekly — there is no set-and-forget product pick.",
        "Lock next week's 3 hero merchants and run the Day 2 logic again.",
      ],
      checklist: [
        "See which offers converted this week",
        "Compare the hike leaderboard with the order leaderboard",
        "Lock next week's 3 hero merchants",
      ],
      tools: [
        { label: "Cashback monitoring", href: "/cashback/monitor" },
        { label: "Weekly report", href: "/reports/weekly" },
      ],
    },
  ],
};
