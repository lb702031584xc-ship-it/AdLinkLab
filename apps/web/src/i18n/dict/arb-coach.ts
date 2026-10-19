/**
 * ⚡套利教练 — 流量套利（mediabuy arbitrage）手把手教练模式 dict，自包含。
 * 注：站内另有"教练模式"（dict/coach.ts）是关键操作前的错误拦截，
 * 与本页（套利全流程教练）是两个功能，命名上以 arb-coach 区分。
 */

export interface ArbCoachLink {
  label: string;
  href: string;
  /** 外部官网链接：新窗口打开。 */
  external?: boolean;
}

export interface ArbCoachPhase {
  id: "prepare" | "offer" | "tracking" | "launch" | "dashboard" | "scale";
  title: string;
  goal: string;
  checks: string[];
  /** 教练提示：为什么这么做 + 关键数字，语气像教练。 */
  coachTip: string;
  links: ArbCoachLink[];
}

export interface ArbCoachTemplate {
  id: "beginner" | "intermediate" | "advanced";
  /** 级别徽标，如 "🌱 初级"。 */
  badge: string;
  title: string;
  budget: string;
  desc: string;
  /** 写入看板组合备注的关键参数摘要。 */
  note: string;
  stages: { title: string; params: string[] }[];
}

export interface ArbCoachDict {
  pageTitle: string;
  pageDesc: string;
  progress: string;
  reset: string;
  resetConfirm: string;
  phaseLabel: string;
  goalLabel: string;
  checklistLabel: string;
  coachTipLabel: string;
  toolsLabel: string;
  complete: string;
  /** 套利不走 $8 门槛的醒目提示（Phase 1 用）。 */
  arbitrageNoteTitle: string;
  arbitrageNoteBody: string;
  phases: ArbCoachPhase[];
  board: {
    title: string;
    desc: string;
    addCombo: string;
    name: string;
    namePlaceholder: string;
    spend: string;
    clicks: string;
    conversions: string;
    payout: string;
    cpc: string;
    epc: string;
    roi: string;
    verdict: string;
    actions: string;
    save: string;
    cancel: string;
    edit: string;
    remove: string;
    removeConfirm: string;
    empty: string;
    verdictKill: string;
    verdictScale: string;
    verdictWatch: string;
    reasonKillNoConv: string;
    reasonKillRoi: string;
    reasonScale: string;
    reasonWatch: string;
    reasonNoSpend: string;
    reasonNoPayout: string;
    newComboDefault: string;
  };
  nav: {
    overview: string;
    templates: string;
    board: string;
    scale: string;
  };
  templates: {
    pageTitle: string;
    pageDesc: string;
    apply: string;
    applied: string;
    appliedToast: string;
    paramsTitle: string;
    budget: string;
    items: ArbCoachTemplate[];
  };
  scale: {
    pageTitle: string;
    pageDesc: string;
    add: string;
    date: string;
    combo: string;
    action: string;
    params: string;
    note: string;
    paramsPlaceholder: string;
    notePlaceholder: string;
    save: string;
    cancel: string;
    edit: string;
    remove: string;
    removeConfirm: string;
    empty: string;
    actionOptions: string[];
    rulesTitle: string;
    rules: string[];
  };
}

export const zh: ArbCoachDict = {
  pageTitle: "⚡套利教练",
  pageDesc:
    "流量套利手把手：pop/push 便宜流量 → 高转化 Offer（抽奖 / CC submit）→ $5 测一个组合 → 小时级砍/留。不骗点击、不买号，拼的是选品和砍单速度。跟着 6 个阶段走，跑出第一个 ROI 为正的组合。",
  progress: "完成进度",
  reset: "重置进度",
  resetConfirm: "确定要清空所有勾选进度和测试数据吗？",
  phaseLabel: "阶段 {n}",
  goalLabel: "本阶段目标",
  checklistLabel: "Checklist",
  coachTipLabel: "🎯 教练说",
  toolsLabel: "用到的工具",
  complete: "🎉 6 个阶段走完！你已经跑通套利全链路——继续复制 winning 组合，把利润做大。",
  arbitrageNoteTitle: "⚠️ 先看这条：套利不走 $8 佣金门槛",
  arbitrageNoteBody:
    "站内 $8 佣金门槛是 Google 搜索打法（高客单、慢决策）用的。套利玩的是小额高频转化（抽奖单佣金 $1–5），判定只看 EPC vs CPC：EPC > CPC 就有得赚。两个打法别混。",
  phases: [
    {
      id: "prepare",
      title: "准备：账号三件套",
      goal: "联盟 + 流量 + 追踪三个账号就绪，新手从初级 $10 档起",
      checks: [
        "定档位：初级（全程约 $10）/ 中级（约 $100）/ 高级（$1000+），新手从初级起",
        "注册联盟账号：初级 Mobipium（免费）、中级加 Zeydoo（免费）、高级加 ClickDealer",
        "注册流量平台并充值：初级 PopAds 预存 $10、中级 PropellerAds 最低 $100、高级 Zeropark 预算至少 $1000",
        "注册 bemob（免费版够用），拿到你的 postback URL",
        "绑定收款方式（Payoneer 或 PayPal，联盟打款用）",
      ],
      coachTip:
        "三档写清楚：初级 BeMob 免费 + Mobipium 免费 + PopAds 预存 $10，全程约 $10；中级 BeMob 免费 + Zeydoo 免费 + PropellerAds 最低 $100；高级工具 $100–300/月 + 流量预算至少 $1000（Zeropark 推送 + ClickDealer）。新手从初级 $10 档起——第一周的目标是交小钱学流程，不是赚钱。档位越高学费越贵，别跳级。",
      links: [
        { label: "Mobipium（联盟·初级）", href: "https://mobipium.com", external: true },
        { label: "Zeydoo（联盟·中级）", href: "https://zeydoo.com", external: true },
        { label: "Popads（流量·初级）", href: "https://www.popads.net", external: true },
        { label: "PropellerAds（流量·中级）", href: "https://propellerads.com", external: true },
        { label: "bemob（追踪·免费）", href: "https://bemob.com", external: true },
      ],
    },
    {
      id: "offer",
      title: "选 Offer：高转化类型",
      goal: "筛出 3–5 个值得 $10 测试的 Offer",
      checks: [
        "在联盟后台按 vertical 筛：抽奖（sweepstakes）/ CC submit / pin submit / SOI",
        "新手从 SOI（单页提交）开始——转化最容易，先跑通链路",
        "记录每个候选的 payout、国家（geo）、每日 cap（限量）",
        "排除项：需要预付费的、条款含糊的、CR 异常低的",
        "在 AdLinkLab 建 Offer 档案（链接/佣金/国家记下来，方便复盘）",
      ],
      coachTip:
        "套利选品看 EPC 不看情怀：payout $1–5 很正常，关键是转化率高不高。问 AM 要“本周跑得好的 3 个 Offer”比你自己筛一下午管用。cap 小的别碰——刚测出数据就没量了，白忙。",
      links: [{ label: "去建 Offer →", href: "/offers/new" }],
    },
    {
      id: "tracking",
      title: "追踪：BeMob 接好",
      goal: "Campaign 按规范建好，测试转化能回传",
      checks: [
        "BeMob 新建 Campaign：命名格式 Country_Device_OS_Browser（如 WW_android_chrome）",
        "Traffic Source 选 PopAds；Destination 选 Built-in flow；LANDINGS 关闭（直链，不用落地页）",
        "加 5 个 Offer，每个 weight=100；Cost model=Auto；uniqueness=24 小时；货币 USD",
        "拿到 BeMob 的 Campaign URL（这才是你要投的链接）",
        "Postback 设置：BeMob → Affiliate Network → 在 Mobipium 点 Edit 复制预设 postback 链接 → 粘贴到 Mobipium Pixel 的 “Configure your Callback URL”",
        "自己点一次 Campaign URL 做测试转化，确认 BeMob 报表能看到 conversion",
      ],
      coachTip:
        "命名规范 Country_Device_OS_Browser（如 WW_android_chrome）现在多花 10 秒，以后看报表时省 10 分钟——跑起来后你有几十个 campaign，乱命名的坟场谁都救不了。postback 不通 = 烧钱看不到赚钱，新手亏钱第一大坑；测试转化这一步不许跳过。",
      links: [{ label: "bemob（追踪·免费）", href: "https://bemob.com", external: true }],
    },
    {
      id: "launch",
      title: "建组：PopAds $5 开测",
      goal: "每个组合日预算 $5，1 Offer × 1 角度起测，Name 与 BeMob 一致",
      checks: [
        "PopAds 新建 campaign：Name 与 BeMob 的 Campaign 名一致（Country_Device_OS_Browser）",
        "URL 粘贴 BeMob 的 Campaign URL（投的是追踪链接，不是 Offer 直链）",
        "日预算 $5；Adv type 选 Popunder；频率 1/24；排除 Adult 类目",
        "定向：Worldwide + Android + Chrome 47+ + Smartphone",
        "出价从平台推荐的中低位起步，别一上来就最高价抢量",
        "1 个组合 = 1 offer × 1 角度，变量一次只动一个",
      ],
      coachTip:
        "日预算 $5 是初级档的止损线——$5 花完没转化就停，别加钱“再看看”。定向 Worldwide + Android + Chrome 47+ + Smartphone + 频率 1/24 + 排除 Adult，这是课程验证过的起手式，先抄作业再创新。中级 CPA Goal 2.0 玩法备注：CPA 出价 = 佣金 × 0.7，测试预算 = 100 × 佣金——等你升级到中级档再用，初级先按 $5 跑。",
      links: [
        { label: "Popads（流量）", href: "https://www.popads.net", external: true },
        { label: "PropellerAds（流量）", href: "https://propellerads.com", external: true },
      ],
    },
    {
      id: "dashboard",
      title: "速测看板：小时级砍/留",
      goal: "花 $5–$10 拿到首批转化后再分析，每个组合 24 小时内给 verdict",
      checks: [
        "先花够 $5–$10：没转化也别急着下结论，数据不足时看板只会显示“观察”",
        "Offer 报告按转化排序：持续零转化的 Offer 暂停（参考：4 个 Offer 留 3 个盈利的）",
        "⚠️ BeMob 免费版 bot 流量 bug：referrer 为 www.google.com 的流量是 bot，会把成本虚高（如实际 $5 显示 $15）——在报告里 exclude 该 referrer 后再看数",
        "砍线（高级通用）：单个 target / 创意 / lander 花费达到 1x offer payout 仍零转化 → 暂停；每个创意/lander 给 1–2x 佣金的测试花费",
        "按 target 优化，不按 source——同一个 source 下好坏 target 天差地别",
        "🔪 砍：看板提示出现就停掉 campaign，不犹豫；🚀 加量：ROI > 20% 按阶段 6 放量",
      ],
      coachTip:
        "砍线的数学：单个 target/创意/lander 烧掉 1 单佣金还没转化，神仙 Offer 也救不了，砍——每个创意只配 1–2x 佣金的测试费。但 $5 没花够之前别动手，没转化可能是量不够不是 Offer 不行。还有 BeMob 免费版的 bot 坑：www.google.com referrer 的流量是假的，会把 $5 显示成 $15，不 exclude 它你会误杀赚钱的组合。按 target 优化不按 source，这是课程里反复强调的——source 是平均数，target 才是真相。",
      links: [],
    },
    {
      id: "scale",
      title: "放量：复制 winning 组合",
      goal: "日预算 $5 → $10 起步，GEO 收窄到盈利国家",
      checks: [
        "初级放量：日预算 $5 → $10；GEO 收窄到盈利国家（课程案例：德国 / 瑞典 / 韩国 / 泰国）",
        "保持出价稳定，一次只改一个变量（预算和 GEO 不要同时动）",
        "进阶·垂直扩展优先：删掉无利润的部分 + 敢提价，win ratio 往 100% 走",
        "白名单门槛：10–20 个转化打底、$5000 花费之后再考虑建白名单",
        "创意 2–3 天耗尽：持续加新素材，别指望一个创意吃一个月",
        "每天复盘：ROI 掉下 20% 的组合降预算或停",
      ],
      coachTip:
        "放量第一步只做两件事：预算 $5 → $10，GEO 收窄到盈利国家（德国/瑞典/韩国/泰是课程里的真实案例）——出价别动，变量一次一个。进阶记住三个数：白名单要 10–20 个转化打底、$5000 花费后再谈；创意寿命 2–3 天，素材停了等于利润停了。垂直扩展优先：把不赚钱的部分砍掉、敢给赚钱的部分提价，win ratio 往 100% 推。",
      links: [],
    },
  ],
  board: {
    title: "🧪 速测看板",
    desc: "每个测试组合一行：填花费/点击/转化/payout，自动算 CPC / EPC / ROI 并给 verdict。数据只存你浏览器本地。",
    addCombo: "＋ 添加测试组合",
    name: "组合",
    namePlaceholder: "如：抽奖-US-lander1-角度A",
    spend: "花费 $",
    clicks: "点击",
    conversions: "转化",
    payout: "单佣金 $",
    cpc: "CPC",
    epc: "EPC",
    roi: "ROI",
    verdict: "判定",
    actions: "操作",
    save: "保存",
    cancel: "取消",
    edit: "编辑",
    remove: "删除",
    removeConfirm: "确定删除这个组合吗？",
    empty: "还没有测试组合，点“＋ 添加测试组合”开始记录。",
    verdictKill: "🔪 砍",
    verdictScale: "🚀 加量",
    verdictWatch: "👀 观察",
    reasonKillNoConv: "1 单佣金花完还没转化",
    reasonKillRoi: "ROI ≤ -50% 且已花 $10",
    reasonScale: "ROI > 20%，值得加量",
    reasonWatch: "数据不足，继续观察",
    reasonNoSpend: "还没花钱",
    reasonNoPayout: "payout 未知，无法判定",
    newComboDefault: "新组合",
  },
  nav: {
    overview: "总览闯关",
    templates: "组合模板",
    board: "速测看板",
    scale: "放量记录",
  },
  templates: {
    pageTitle: "组合模板库",
    pageDesc:
      "三个档位的完整开测模板，参数来自课程原打法。选一个点“应用此模板”，看板里自动建好组合，直接开测。",
    apply: "应用此模板",
    applied: "已应用，去速测看板开测 →",
    appliedToast: "模板已应用到速测看板",
    paramsTitle: "各阶段参数",
    budget: "预算",
    items: [
      {
        id: "beginner",
        badge: "🌱 初级",
        title: "PopAds Popunder · $10 档",
        budget: "$10",
        desc: "零基础新手第一周：跑通联盟 → 追踪 → 流量 → 回传全链路，目标不是赚钱，是花小钱学会流程。",
        note: "PopAds Popunder · 日预算$5 · Worldwide+Android+Chrome47+ · 频率1/24",
        stages: [
          {
            title: "准备",
            params: [
              "BeMob 免费版",
              "Mobipium 联盟账号（免费）",
              "PopAds 预存 $10",
              "拿到 bemob 的 postback URL",
            ],
          },
          {
            title: "追踪",
            params: [
              "命名 Country_Device_OS_Browser（如 WW_android_chrome）",
              "Traffic Source=PopAds；Destination=Built-in flow",
              "LANDINGS 关闭（直链）",
              "5 个 Offer 各 weight=100；Cost=Auto；uniqueness=24h；USD",
            ],
          },
          {
            title: "Postback",
            params: [
              "BeMob → Affiliate Network → Mobipium 点 Edit 复制预设 postback",
              "粘贴到 Mobipium Pixel 的 “Configure your Callback URL”",
              "自己点一次做测试转化，确认报表能看到",
            ],
          },
          {
            title: "建组",
            params: [
              "日预算 $5；Adv type=Popunder",
              "Worldwide + Android + Chrome 47+ + Smartphone",
              "频率 1/24；排除 Adult 类目",
              "Name 与 BeMob 一致；URL 粘贴 BeMob Campaign URL",
            ],
          },
          {
            title: "速测",
            params: [
              "花 $5–$10 后再分析",
              "Offer 按转化排序，持续零转化暂停",
              "⚠️ exclude www.google.com 的 bot referrer（成本虚高）",
            ],
          },
          {
            title: "放量",
            params: [
              "日预算 $5 → $10",
              "GEO 收窄到盈利国家（德 / 瑞 / 韩 / 泰）",
              "一次只改一个变量",
            ],
          },
        ],
      },
      {
        id: "intermediate",
        badge: "🚀 中级",
        title: "PropellerAds CPA Goal 2.0 · $100 档",
        budget: "$100",
        desc: "跑通初级链路后升级：CPA 出价模型 + 调查类 Offer，算法帮你调价，优化维度更多。",
        note: "PropellerAds CPA Goal 2.0 · 出价=佣金×0.7 · 测试预算=100×佣金",
        stages: [
          {
            title: "准备",
            params: [
              "Zeydoo 联盟账号（免费）",
              "PropellerAds 最低预存 $100",
              "BeMob 免费版继续用",
            ],
          },
          {
            title: "追踪",
            params: [
              "沿用初级的 BeMob 规范（命名 / 5 offer / weight=100）",
              "Zeydoo 的 postback 同样从 BeMob 模板复制",
            ],
          },
          {
            title: "建组",
            params: [
              "格式 OnClick（Popunder）；定价 CPA Goal 2.0",
              "CPA 出价 = 佣金 × 0.7",
              "测试预算 = 100 × 佣金",
              "GEO 问 AM 哪个表现好，别无脑选美国",
              "排除已转化用户受众",
            ],
          },
          {
            title: "速测",
            params: [
              "优化维度：OS Version / Device / Browser / Language / Connection / ISP / Carrier",
              "wifi 和 3G 分开建组（方便禁用坏运营商）",
              "只用流量源 token 做优化",
            ],
          },
          {
            title: "放量",
            params: [
              "v1 定向放宽 → 优化明显项 → 复制为 v2 重启",
              "优化要慢，避免不必要地限制量",
              "zeydoo 调查类 Offer 用 CPA Goal 2.0 容易盈利",
            ],
          },
        ],
      },
      {
        id: "advanced",
        badge: "🎯 高级",
        title: "Zeropark 推送 · $1000+ 档",
        budget: "$1000+",
        desc: "推送通知推 CC 抽奖 Offer：5 创意 + 5 lander 起测，RON 定位 + 黑名单开路，$5000 后才谈白名单。",
        note: "Zeropark 推送 · RON · 5创意+5 lander · 1x payout 零转化暂停 target",
        stages: [
          {
            title: "准备",
            params: [
              "ClickDealer（抽奖 Offer 联盟）",
              "Zeropark 推送流量（预算至少 $1000）",
              "工具费约 $100–300/月；lander 用 S3 + CloudFront",
            ],
          },
          {
            title: "建组",
            params: [
              "5 个创意 + 5 个着陆页 + 1–2 个 Offer",
              "定位 RON（全网络），有数据后再白名单",
              "Bid 略高于建议出价（如 0.056 → 0.06）",
              "移动 / 桌面分开建活动；频率 24h；语言定位",
            ],
          },
          {
            title: "速测",
            params: [
              "每个创意/lander 给 1–2x 佣金的测试花费",
              "1x payout 零转化 → 暂停该 target",
              "按 target 优化，不按 source",
              "只用找到有效漏斗之后的数据",
            ],
          },
          {
            title: "放量",
            params: [
              "垂直扩展优先：删无利部分 + 敢提价，win ratio → 100%",
              "白名单：10–20 个转化打底、$5000 花费后",
              "创意 2–3 天耗尽，持续加新素材",
              "水平扩展：榨干一个源再开下一个",
            ],
          },
        ],
      },
    ],
  },
  scale: {
    pageTitle: "放量记录",
    pageDesc:
      "每个放量动作记一笔：加预算 / 加白 / 暂停 / 复制，参数和结果都写下来，复盘时才知道哪一步赚的钱。",
    add: "＋ 记录一次放量",
    date: "日期",
    combo: "组合",
    action: "动作",
    params: "参数",
    note: "结果备注",
    paramsPlaceholder: "如：日预算 $5→$10；GEO 收窄到德/瑞",
    notePlaceholder: "如：3 天 ROI 35%，继续观察",
    save: "保存",
    cancel: "取消",
    edit: "编辑",
    remove: "删除",
    removeConfirm: "确定删除这条放量记录吗？",
    empty: "还没有放量记录——先在速测看板跑出 🚀 加量的组合。",
    actionOptions: ["加预算", "加白", "暂停", "复制"],
    rulesTitle: "📌 放量铁律",
    rules: [
      "垂直扩展优先：先把一个组合 / 一个源榨干，再开新的",
      "先黑名单再白名单：白名单要 10–20 个转化打底、$5000 花费之后",
      "创意 2–3 天耗尽：素材停了等于利润停了，持续加新素材",
      "一次只改一个变量：预算和 GEO / 出价不要同时动",
      "ROI 掉下 20% 的组合降预算或停，别用感情做决策",
    ],
  },
};

export const en: ArbCoachDict = {
  pageTitle: "⚡Arbitrage Coach",
  pageDesc:
    "Mediabuy arbitrage, step by step: cheap pop/push traffic → high-converting offers (sweepstakes / CC submit) → $5 per combo test → hourly kill/scale calls. No fake clicks, no bought accounts — win on offer picking and kill speed. Follow the 6 phases to your first ROI-positive combo.",
  progress: "Progress",
  reset: "Reset",
  resetConfirm: "Clear all checklist progress and test data?",
  phaseLabel: "Phase {n}",
  goalLabel: "Goal",
  checklistLabel: "Checklist",
  coachTipLabel: "🎯 Coach says",
  toolsLabel: "Tools",
  complete: "🎉 All 6 phases done! You've run the full arbitrage loop — keep cloning winning combos and scale the profit.",
  arbitrageNoteTitle: "⚠️ Read first: arbitrage does NOT use the $8 commission gate",
  arbitrageNoteBody:
    "The $8 commission floor is for the Google Search game (high-ticket, slow decisions). Arbitrage plays small, high-frequency conversions ($1–5 sweepstakes payouts) — judge only on EPC vs CPC: EPC > CPC means money. Don't mix the two games.",
  phases: [
    {
      id: "prepare",
      title: "Setup: the three accounts",
      goal: "Network + traffic + tracker ready — beginners start at the $10 tier",
      checks: [
        "Pick your tier: beginner (~$10 total) / intermediate (~$100) / advanced ($1000+); beginners start at beginner",
        "Register with networks: beginner Mobipium (free), intermediate adds Zeydoo (free), advanced adds ClickDealer",
        "Register with a traffic source and top up: beginner PopAds $10, intermediate PropellerAds $100 minimum, advanced Zeropark with $1000+ budget",
        "Register bemob (free plan is enough) and grab your postback URL",
        "Connect a payout method (Payoneer or PayPal for network payouts)",
      ],
      coachTip:
        "The three tiers, spelled out: beginner = free BeMob + free Mobipium + $10 PopAds top-up, about $10 all-in; intermediate = free BeMob + free Zeydoo + PropellerAds $100 minimum; advanced = $100–300/month in tools + at least $1000 traffic budget (Zeropark push + ClickDealer). Beginners start at the $10 tier — week one's goal is to learn the loop cheaply, not to profit. Higher tiers mean more expensive tuition; don't skip grades.",
      links: [
        { label: "Mobipium (network · beginner)", href: "https://mobipium.com", external: true },
        { label: "Zeydoo (network · intermediate)", href: "https://zeydoo.com", external: true },
        { label: "Popads (traffic · beginner)", href: "https://www.popads.net", external: true },
        { label: "PropellerAds (traffic · intermediate)", href: "https://propellerads.com", external: true },
        { label: "bemob (tracker · free)", href: "https://bemob.com", external: true },
      ],
    },
    {
      id: "offer",
      title: "Pick offers: high-converting types",
      goal: "Shortlist 3–5 offers worth a $10 test",
      checks: [
        "Filter by vertical in the network panel: sweepstakes / CC submit / pin submit / SOI",
        "Beginners start with SOI (single opt-in) — easiest conversions, learn the loop first",
        "Record payout, geo and daily cap for each candidate",
        "Exclude: prepay required, vague terms, abnormally low CR",
        "Create the offer record in AdLinkLab (save link / payout / geo for review)",
      ],
      coachTip:
        "Arbitrage picking is about EPC, not feelings: $1–5 payouts are normal — what matters is conversion rate. Ask your AM for “3 offers running well this week” — beats an afternoon of solo research. Skip tiny caps: running out of volume right when data arrives is wasted work.",
      links: [{ label: "Create offer →", href: "/offers/new" }],
    },
    {
      id: "tracking",
      title: "Tracking: wire up BeMob",
      goal: "Campaign built to spec, test conversion fires back",
      checks: [
        "Create the campaign in BeMob with naming format Country_Device_OS_Browser (e.g. WW_android_chrome)",
        "Traffic Source = PopAds; Destination = Built-in flow; LANDINGS off (direct link, no lander)",
        "Add 5 offers, each weight=100; Cost model=Auto; uniqueness=24 hours; currency USD",
        "Grab BeMob's campaign URL (this is what you run traffic to)",
        "Postback setup: BeMob → Affiliate Network → in Mobipium click Edit to copy the preset postback link → paste it into Mobipium Pixel's “Configure your Callback URL”",
        "Click your campaign URL once as a test conversion and confirm it shows in BeMob reports",
      ],
      coachTip:
        "The Country_Device_OS_Browser naming (e.g. WW_android_chrome) costs 10 seconds now and saves 10 minutes per report later — once you're running, you'll have dozens of campaigns and a graveyard of random names helps nobody. Broken postback = burning money blind, the #1 beginner money pit; the test conversion step is mandatory.",
      links: [{ label: "bemob (tracker · free)", href: "https://bemob.com", external: true }],
    },
    {
      id: "launch",
      title: "Launch: start at $5 on PopAds",
      goal: "$5/day per combo, 1 offer × 1 angle — name matches BeMob",
      checks: [
        "Create the PopAds campaign with the same name as in BeMob (Country_Device_OS_Browser)",
        "Paste BeMob's campaign URL as the destination (the tracker link, not the raw offer link)",
        "Daily budget $5; Ad type = Popunder; frequency 1/24; exclude the Adult category",
        "Targeting: Worldwide + Android + Chrome 47+ + Smartphone",
        "Start bidding at the low-middle of the platform's suggested range",
        "1 combo = 1 offer × 1 angle; change one variable at a time",
      ],
      coachTip:
        "$5/day is the beginner stop-loss — when it's gone with zero conversions, pause; don't add money to “wait and see”. Targeting Worldwide + Android + Chrome 47+ + Smartphone, frequency 1/24, Adult excluded: this is the course-tested opening — copy it before inventing your own. Intermediate CPA Goal 2.0 note: bid = payout × 0.7, test budget = 100 × payout — save that for the intermediate tier; at beginner level just run the $5.",
      links: [
        { label: "Popads (traffic)", href: "https://www.popads.net", external: true },
        { label: "PropellerAds (traffic)", href: "https://propellerads.com", external: true },
      ],
    },
    {
      id: "dashboard",
      title: "Test board: hourly kill / keep",
      goal: "Spend $5–$10 to get the first conversions, then judge — verdict per combo within 24h",
      checks: [
        "Spend $5–$10 first: don't judge before the first conversions arrive — thin data only ever shows “watch”",
        "Sort the offer report by conversions: pause offers with sustained zero conversions (reference: 4 offers in, 3 profitable kept)",
        "⚠️ BeMob free-plan bot-traffic bug: referrer www.google.com traffic is bots and inflates cost (e.g. real $5 shows as $15) — exclude that referrer in reports before reading numbers",
        "Kill line (advanced, universal): a single target / creative / lander spending 1× offer payout with zero conversions → pause; give each creative/lander 1–2× payout in test spend",
        "Optimize by target, not by source — good and bad targets inside one source differ wildly",
        "🔪 Kill: pause the campaign the moment the board says kill; 🚀 Scale: ROI > 20% goes to Phase 6",
      ],
      coachTip:
        "The kill math: one target/creative/lander burning 1 payout with zero conversions — no offer can save it, kill it; each creative only deserves 1–2× payout in test spend. But don't touch anything before $5 is spent — no conversions might mean too little volume, not a bad offer. And the BeMob free-plan bot trap: www.google.com referrer traffic is fake and turns $5 into $15 on screen; exclude it or you'll murder winning combos. Optimize by target, not source — the course repeats this because source-level averages lie and target-level truth pays.",
      links: [],
    },
    {
      id: "scale",
      title: "Scale: clone winning combos",
      goal: "Daily budget $5 → $10, narrow GEO to profitable countries",
      checks: [
        "Beginner scale: daily budget $5 → $10; narrow GEO to profitable countries (course cases: Germany / Sweden / Korea / Thailand)",
        "Keep bids stable — change one variable at a time (never budget and GEO together)",
        "Advanced · vertical scaling first: cut unprofitable parts + dare to raise bids, push win ratio toward 100%",
        "Whitelist threshold: 10–20 conversions minimum and $5000 spend before building a whitelist",
        "Creatives burn out in 2–3 days: keep adding fresh material — when creatives stop, profit stops",
        "Daily review: cut budget or pause any combo whose ROI drops below 20%",
      ],
      coachTip:
        "Scaling step one does two things only: budget $5 → $10 and GEO narrowed to profitable countries (Germany/Sweden/Korea/Thailand are the real course cases) — don't touch bids, one variable at a time. Advanced numbers to remember: whitelists need 10–20 conversions minimum and $5000 spend first; creative lifespan is 2–3 days, so fresh material is the actual paycheck. Vertical scaling first: cut what doesn't profit, raise bids on what does, push win ratio toward 100%.",
      links: [],
    },
  ],
  board: {
    title: "🧪 Test board",
    desc: "One row per test combo: enter spend / clicks / conversions / payout — CPC / EPC / ROI and the verdict are computed automatically. Data stays in your browser only.",
    addCombo: "＋ Add test combo",
    name: "Combo",
    namePlaceholder: "e.g. sweep-US-lander1-angleA",
    spend: "Spend $",
    clicks: "Clicks",
    conversions: "Conversions",
    payout: "Payout $",
    cpc: "CPC",
    epc: "EPC",
    roi: "ROI",
    verdict: "Verdict",
    actions: "Actions",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Delete",
    removeConfirm: "Delete this combo?",
    empty: "No test combos yet — click “＋ Add test combo” to start logging.",
    verdictKill: "🔪 Kill",
    verdictScale: "🚀 Scale",
    verdictWatch: "👀 Watch",
    reasonKillNoConv: "Burned 1 payout with zero conversions",
    reasonKillRoi: "ROI ≤ -50% with $10+ spent",
    reasonScale: "ROI > 20%, worth scaling",
    reasonWatch: "Not enough data, keep watching",
    reasonNoSpend: "No spend yet",
    reasonNoPayout: "Payout unknown, can't judge",
    newComboDefault: "New combo",
  },
  nav: {
    overview: "Walkthrough",
    templates: "Templates",
    board: "Test board",
    scale: "Scale log",
  },
  templates: {
    pageTitle: "Combo template library",
    pageDesc:
      "Full launch templates for three tiers, parameters from the course playbook. Pick one, hit “Apply template” — a combo is created on the board, ready to test.",
    apply: "Apply template",
    applied: "Applied — start testing on the board →",
    appliedToast: "Template applied to the test board",
    paramsTitle: "Stage parameters",
    budget: "Budget",
    items: [
      {
        id: "beginner",
        badge: "🌱 Beginner",
        title: "PopAds Popunder · $10 tier",
        budget: "$10",
        desc: "Week one for total beginners: run the full network → tracker → traffic → postback loop. The goal is learning the loop cheaply, not profit.",
        note: "PopAds Popunder · $5/day budget · Worldwide+Android+Chrome47+ · freq 1/24",
        stages: [
          {
            title: "Setup",
            params: [
              "BeMob free plan",
              "Mobipium network account (free)",
              "PopAds $10 top-up",
              "Grab your bemob postback URL",
            ],
          },
          {
            title: "Tracking",
            params: [
              "Naming Country_Device_OS_Browser (e.g. WW_android_chrome)",
              "Traffic Source=PopAds; Destination=Built-in flow",
              "LANDINGS off (direct link)",
              "5 offers, each weight=100; Cost=Auto; uniqueness=24h; USD",
            ],
          },
          {
            title: "Postback",
            params: [
              "BeMob → Affiliate Network → in Mobipium click Edit to copy the preset postback",
              "Paste it into Mobipium Pixel's “Configure your Callback URL”",
              "Click once yourself as a test conversion and confirm it shows in reports",
            ],
          },
          {
            title: "Launch",
            params: [
              "$5/day budget; Ad type=Popunder",
              "Worldwide + Android + Chrome 47+ + Smartphone",
              "Frequency 1/24; exclude the Adult category",
              "Name matches BeMob; URL = BeMob campaign URL",
            ],
          },
          {
            title: "Test",
            params: [
              "Analyze only after $5–$10 spent",
              "Sort offers by conversions, pause sustained zero-converters",
              "⚠️ Exclude the www.google.com bot referrer (inflated cost)",
            ],
          },
          {
            title: "Scale",
            params: [
              "$5 → $10/day budget",
              "Narrow GEO to profitable countries (DE / SE / KR / TH)",
              "Change one variable at a time",
            ],
          },
        ],
      },
      {
        id: "intermediate",
        badge: "🚀 Intermediate",
        title: "PropellerAds CPA Goal 2.0 · $100 tier",
        budget: "$100",
        desc: "After the beginner loop works: CPA bidding + survey offers — the algorithm tunes bids for you, with more optimization dimensions.",
        note: "PropellerAds CPA Goal 2.0 · bid = payout × 0.7 · test budget = 100 × payout",
        stages: [
          {
            title: "Setup",
            params: [
              "Zeydoo network account (free)",
              "PropellerAds $100 minimum top-up",
              "Keep using BeMob free plan",
            ],
          },
          {
            title: "Tracking",
            params: [
              "Same BeMob spec as beginner (naming / 5 offers / weight=100)",
              "Zeydoo postback also copied from the BeMob template",
            ],
          },
          {
            title: "Launch",
            params: [
              "Format OnClick (Popunder); pricing = CPA Goal 2.0",
              "CPA bid = payout × 0.7",
              "Test budget = 100 × payout",
              "Ask your AM which GEO performs — don't default to the US",
              "Exclude converted-user audiences",
            ],
          },
          {
            title: "Test",
            params: [
              "Dimensions: OS Version / Device / Browser / Language / Connection / ISP / Carrier",
              "Split wifi and 3G into separate campaigns (to kill bad carriers)",
              "Optimize only on traffic-source tokens",
            ],
          },
          {
            title: "Scale",
            params: [
              "v1 loose targeting → optimize clear winners → duplicate as v2 and relaunch",
              "Optimize slowly — don't throttle volume unnecessarily",
              "Zeydoo survey offers profit easily on CPA Goal 2.0",
            ],
          },
        ],
      },
      {
        id: "advanced",
        badge: "🎯 Advanced",
        title: "Zeropark push · $1000+ tier",
        budget: "$1000+",
        desc: "Push notifications for CC sweepstakes: 5 creatives + 5 landers to start, RON targeting with blacklist first — whitelists only after $5000.",
        note: "Zeropark push · RON · 5 creatives + 5 landers · pause target at 1x payout zero conversions",
        stages: [
          {
            title: "Setup",
            params: [
              "ClickDealer (sweepstakes network)",
              "Zeropark push traffic ($1000+ budget)",
              "Tools ~$100–300/month; landers on S3 + CloudFront",
            ],
          },
          {
            title: "Launch",
            params: [
              "5 creatives + 5 landers + 1–2 offers",
              "RON targeting; whitelists only after data",
              "Bid slightly above suggested (e.g. 0.056 → 0.06)",
              "Separate mobile / desktop campaigns; 24h frequency; language targeting",
            ],
          },
          {
            title: "Test",
            params: [
              "Give each creative/lander 1–2× payout in test spend",
              "1× payout with zero conversions → pause that target",
              "Optimize by target, not by source",
              "Use only data after a working funnel is found",
            ],
          },
          {
            title: "Scale",
            params: [
              "Vertical first: cut losers + dare to raise bids, win ratio → 100%",
              "Whitelist: 10–20 conversions minimum, after $5000 spend",
              "Creatives burn out in 2–3 days — keep adding fresh ones",
              "Horizontal: max out one source before opening the next",
            ],
          },
        ],
      },
    ],
  },
  scale: {
    pageTitle: "Scale log",
    pageDesc:
      "Log every scale move — budget up / whitelist / pause / duplicate — with parameters and results, so reviews show which step made the money.",
    add: "＋ Log a scale move",
    date: "Date",
    combo: "Combo",
    action: "Action",
    params: "Params",
    note: "Result note",
    paramsPlaceholder: "e.g. daily budget $5→$10; GEO narrowed to DE/SE",
    notePlaceholder: "e.g. 3-day ROI 35%, keep watching",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Delete",
    removeConfirm: "Delete this scale record?",
    empty: "No scale records yet — get a 🚀 Scale combo on the test board first.",
    actionOptions: ["Raise budget", "Whitelist", "Pause", "Duplicate"],
    rulesTitle: "📌 Scale rules",
    rules: [
      "Vertical first: max out one combo / one source before opening new ones",
      "Blacklist before whitelist: whitelists need 10–20 conversions and $5000 spend first",
      "Creatives burn out in 2–3 days: when creatives stop, profit stops — keep adding fresh ones",
      "One variable at a time: never change budget and GEO / bid together",
      "Cut budget or pause any combo whose ROI drops below 20% — no emotional decisions",
    ],
  },
};
