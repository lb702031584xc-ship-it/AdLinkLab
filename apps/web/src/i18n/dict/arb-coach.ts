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
};
