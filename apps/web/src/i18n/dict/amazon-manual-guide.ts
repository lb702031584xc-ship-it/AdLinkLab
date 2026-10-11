export interface ManualGuideCategory {
  id: string;
  name: string;
  desc: string;
}

export interface ManualGuideStep {
  id: string;
  dayLabel: string;
  title: string;
  intro: string[];
  checklist: string[];
  tools: { label: string; href: string; external?: boolean }[];
  /** 可跳过：卡片上显示"跳过这步"按钮，一键勾选全部事项 */
  skippable?: boolean;
}

export interface AmazonManualGuideDict {
  title: string;
  description: string;
  progressLabel: string;
  progressText: string; // "{done}/{total}"
  stepDone: string;
  stepTodo: string;
  skipStep: string;
  expand: string;
  collapse: string;
  categoriesTitle: string;
  categoriesHint: string;
  selectedCount: string; // "已选 {n}/2"
  candidateTitle: string;
  candidateHint: string;
  scanCountryLabel: string;
  pasteUrlPlaceholder: string;
  addFromUrl: string;
  parseUrlNoAsin: string;
  colName: string;
  colAsin: string;
  colRank: string;
  colNote: string;
  colAction: string;
  colNo: string;
  viewProduct: string;
  duplicateAsin: string;
  unnamedProduct: string;
  keepaManualTitle: string;
  keepaManualHint: string;
  keepaManualProgress: string; // "已核查 {done}/{total}"
  visionButton: string;
  visionNoLlm: string;
  visionNoLlmHint: string;
  visionModalTitle: string;
  visionPriceLabel: string;
  visionRankLabel: string;
  visionSubmit: string;
  visionRunning: string;
  visionClose: string;
  visionNeedOne: string;
  visionConfidence: string;
  visionConfidenceHigh: string;
  visionConfidenceMedium: string;
  visionConfidenceLow: string;
  visionTabScreenshot: string;
  visionTabManual: string;
  manualPriceGroup: string;
  manualRankGroup: string;
  manualReviewGroup: string;
  mAmazonPriceNow: string;
  mAmazonPrice30dAgo: string;
  mPriceLow90d: string;
  mPriceHigh90d: string;
  mRankNow: string;
  mRankBest90d: string;
  mRankWorst90d: string;
  mReviewsNow: string;
  mReviews90dAgo: string;
  manualInvalidNumber: string;
  manualFieldEmpty: string;
  manualFieldInvalid: string;
  manualLowGtHigh: string;
  manualRankPartial: string;
  addRow: string;
  removeRow: string;
  namePlaceholder: string;
  asinPlaceholder: string;
  rankPlaceholder: string;
  notePlaceholder: string;
  candidateEmpty: string;
  keepaPassTitle: string;
  keepaFailTitle: string;
  keepaPass: string[];
  keepaFail: string[];
  keepaAutoTitle: string;
  keepaAutoHint: string;
  keepaAutoButton: string;
  keepaAutoRunning: string;
  keepaNoKey: string;
  keepaNoKeyHint: string;
  keepaNoAsin: string;
  keepaVerdictPass: string;
  keepaVerdictKill: string;
  keepaVerdictUnknown: string;
  keepaApplyButton: string;
  keepaApplyConfirm: string;
  keepaApplied: string;
  keepaConfirmYes: string;
  keepaConfirmNo: string;
  keepaMetricDrop: string;
  keepaMetricRank: string;
  keepaMetricReviews: string;
  keepaMetricStockout: string;
  keepaMetricNa: string;
  keepaReasons: Record<string, string>;
  finalPickTitle: string;
  finalPickHint: string;
  goPipeline: string;
  congratsTitle: string;
  congratsBody: string;
  nextStepsTitle: string;
  nextSteps: string[];
  categories: ManualGuideCategory[];
  steps: ManualGuideStep[];
}

export const zh: AmazonManualGuideDict = {
  title: "手动选品 SOP",
  description:
    "没有 PA-API 也能跑起来的 7 天手动选品流程：定类目 → 扫榜单 → Keepa 验证 → 差评挖掘，最后产出 3 个测试品送入选品流水线。进度自动保存在本机浏览器。",
  progressLabel: "7 天进度",
  progressText: "{done}/{total}",
  stepDone: "已完成",
  stepTodo: "进行中",
  skipStep: "跳过这步",
  expand: "展开",
  collapse: "收起",
  categoriesTitle: "选择你的 2 个类目",
  categoriesHint: "点选 2 个你最熟悉、或最有供应链/内容优势的方向。贪多嚼不烂。",
  selectedCount: "已选 {n}/2",
  candidateTitle: "候选清单",
  candidateHint: "扫榜时把有潜力的产品记下来，目标 20 个。数据先粗记，后面 Keepa 验证时再细化。",
  scanCountryLabel: "榜单站点",
  pasteUrlPlaceholder: "粘贴 Amazon 产品链接，自动填产品名和 ASIN（类目排名需手填）",
  addFromUrl: "从链接添加",
  parseUrlNoAsin: "链接里没找到 ASIN，请确认是 Amazon 产品页链接",
  colName: "产品名",
  colAsin: "ASIN",
  colRank: "类目排名",
  colNote: "备注",
  colAction: "操作",
  colNo: "#",
  viewProduct: "查看",
  duplicateAsin: "该 ASIN 已在候选清单中",
  unnamedProduct: "未命名产品",
  keepaManualTitle: "手动逐个核查",
  keepaManualHint: "点「查看」去亚马逊看 Keepa 曲线，查完打勾，就不会搞混哪个查过了",
  keepaManualProgress: "已核查 {done}/{total}",
  visionButton: "AI 看图",
  visionNoLlm: "未配置 LLM",
  visionNoLlmHint: "去 管理 → AI 设置 配置 LLM（需要支持 vision 的模型，如 GPT-4o）后可用。",
  visionModalTitle: "AI 看图判断",
  visionPriceLabel: "价格历史图（Keepa 切到 90 天范围，勾选 Amazon 价格 + New 价格曲线）",
  visionRankLabel: "Sales Rank 曲线（同样切 90 天）",
  visionSubmit: "开始判断",
  visionRunning: "AI 看图中…",
  visionClose: "关闭",
  visionNeedOne: "请至少上传一张截图。",
  visionConfidence: "把握度",
  visionConfidenceHigh: "高",
  visionConfidenceMedium: "中",
  visionConfidenceLow: "低",
  visionTabScreenshot: "截图 AI 判断",
  visionTabManual: "手动输入数字",
  manualPriceGroup: "价格（对着价格历史图 90 天抄）",
  manualRankGroup: "排名（可选，Keepa 排名历史需付费；对着 Sales Rank 图 90 天抄）",
  manualReviewGroup: "评论（Keepa 面板抄数字，不用截图）",
  mAmazonPriceNow: "当前 Amazon 价格",
  mAmazonPrice30dAgo: "30 天前 Amazon 价格",
  mPriceLow90d: "90 天内最低价",
  mPriceHigh90d: "90 天内最高价",
  mRankNow: "当前 Sales Rank",
  mRankBest90d: "90 天内最好排名（数字最小）",
  mRankWorst90d: "90 天内最差排名（数字最大）",
  mReviewsNow: "当前评论数",
  mReviews90dAgo: "90 天前评论数（可选）",
  manualInvalidNumber: "请输入有效数字（≥0），最低价不能高于最高价",
  manualFieldEmpty: "请填写「{label}」",
  manualFieldInvalid: "「{label}」请输入有效数字（≥0）",
  manualLowGtHigh: "90天内最低价不能高于最高价",
  manualRankPartial: "排名三个框要么都填，要么都空",
  addRow: "添加一行",
  removeRow: "删除",
  namePlaceholder: "如：降噪蓝牙耳机",
  asinPlaceholder: "B0XXXXXX",
  rankPlaceholder: "如 #12",
  notePlaceholder: "第一印象",
  candidateEmpty: "还没有候选品，点“添加一行”开始记录。",
  keepaPassTitle: "通过标准（留）",
  keepaFailTitle: "淘汰标准（杀）",
  keepaPass: [
    "价格曲线过去 90 天平稳，没有频繁跳水",
    "类目排名长期稳定在前 100",
    "评论数稳步增长（说明持续出单）",
    "没有长期断货记录",
  ],
  keepaFail: [
    "价格 30 天内跌幅超过 25%（利润守不住）",
    "排名大起大落（多半是刷单或短期促销）",
    "评论区出现大量“质量差”“与描述不符”",
    "长期断货（供应链不稳，测了也白测）",
  ],
  keepaAutoTitle: "一键自动筛选",
  keepaAutoHint:
    "已配置 Keepa API Key？点一下，系统逐个查候选清单的 ASIN，按上面的标准自动判通过/淘汰（每次验证消耗 Keepa token）。",
  keepaAutoButton: "一键自动筛选",
  keepaAutoRunning: "筛选中…（逐个查询，请稍候）",
  keepaNoKey: "未配置 Keepa API Key",
  keepaNoKeyHint:
    "去 管理 → AI 设置 → Keepa API Key 配置（keepa.com 申请付费 key 后填入）。",
  keepaNoAsin: "候选清单里没有 ASIN，先在扫榜单步骤把 ASIN 记下来。",
  keepaVerdictPass: "通过",
  keepaVerdictKill: "淘汰",
  keepaVerdictUnknown: "未知",
  keepaApplyButton: "应用结果：移除淘汰项",
  keepaApplyConfirm: "确定移除 {n} 个淘汰项吗？",
  keepaApplied: "已移除 {n} 个淘汰项。",
  keepaConfirmYes: "确认移除",
  keepaConfirmNo: "取消",
  keepaMetricDrop: "30 天跌幅",
  keepaMetricRank: "90 天排名 max/min",
  keepaMetricReviews: "90 天评论增长",
  keepaMetricStockout: "90 天断货",
  keepaMetricNa: "无数据",
  keepaReasons: {
    price_drop: "30 天跌幅 {v}%（>25%，利润守不住）",
    rank_swing: "90 天排名 max/min {v} 倍（>10 倍，大起大落）",
    stockout: "90 天断货 {v} 天（>30 天，供应链不稳）",
    pass: "价格/排名/评论/库存四项均达标",
    no_data: "Keepa 无此产品数据",
    insufficient: "历史数据不足，无法判定",
    rate_limited: "Keepa 限流，稍后重试",
    tokens_exhausted: "Keepa token 不足",
    fetch_failed: "Keepa 请求失败",
  },
  finalPickTitle: "最终 3 个测试品",
  finalPickHint:
    "从候选清单里挑出综合评分最高的 3 个，记下 ASIN，然后一键送入选品流水线跑 6 道门评估。",
  goPipeline: "送入选品流水线 →",
  congratsTitle: "7 天 SOP 完成！",
  congratsBody:
    "你已经走完手动选品全流程：类目聚焦、榜单扫描、Keepa 验证、差评挖掘。把 3 个测试品送入流水线，让 6 道门再筛一遍，然后就可以小预算实测了。",
  nextStepsTitle: "下一步",
  nextSteps: [
    "在选品流水线中跑完 6 道门评估，拿到值得测试指数",
    "用组合测试页一份预算同时测 3 个品，看真实点击数据",
    "出单后把数据沉淀到需求监控，跟踪排名异动",
    "30 天 10 单后申请 PA-API，把这套手动流程自动化",
  ],
  categories: [
    {
      id: "audio",
      name: "耳机音频",
      desc: "蓝牙耳机、头戴式耳机、音箱。复购高、差评点集中（续航/延迟），改进款机会多。",
    },
    {
      id: "smarthome",
      name: "智能家居",
      desc: "智能插座、感应灯、门铃。单价适中，安装类差评是切入点，和博客内容联动好。",
    },
    {
      id: "charging",
      name: "充电配件",
      desc: "充电头、充电宝、数据线。刚需高频，但价格战激烈，重点看差异化（功率/体积）。",
    },
    {
      id: "computer",
      name: "电脑配件",
      desc: "键鼠、扩展坞、支架。客单价高，评论专业度高，适合做深度内容。",
    },
    {
      id: "kitchen",
      name: "厨房小家电",
      desc: "空气炸锅配件、咖啡器具、收纳。视觉化强，适合短视频/图文带货，季节性明显。",
    },
  ],
  steps: [
    {
      id: "categories",
      dayLabel: "Day 1–2",
      title: "定类目：从 5 个方向选 2 个",
      intro: [
        "新手最大的坑是类目跳来跳去，今天看耳机明天看灯具，哪个都没做深。先定 2 个类目，7 天内只看这 2 个。",
        "选择标准：你用过、有体感（能写出真实评测）；供应链/内容有优势（比如你博客已经有相关文章）；客单价 $20–$80（佣金和转化率最平衡的区间）。",
      ],
      checklist: [
        "读完 5 个类目的说明",
        "选定 2 个类目（下方点选）",
        "在纸上写下选择理由（一句话）",
      ],
      tools: [],
    },
    {
      id: "scan",
      dayLabel: "Day 3–4",
      title: "扫榜单：从公开榜单找候选",
      intro: [
        "Amazon 的 Best Sellers、Movers & Shakers、New Releases 三个榜单完全公开，不需要任何 API。每天花 30 分钟扫一遍你定的 2 个类目。",
        "重点看 Movers & Shakers（排名上升榜）——这里藏着正在起量的产品，比 Best Sellers 前排大牌更容易切入。New Releases 适合找新品红利。",
        "扫榜时不要纠结，先把顺眼的记下来，目标 20 个候选。宁可多记，后面 Keepa 会帮你杀掉一半。",
      ],
      checklist: [
        "打开 Best Sellers，记录类目 Top 50 里顺眼的产品",
        "打开 Movers & Shakers，找排名上升最快的 5 个",
        "打开 New Releases，看有没有新品机会",
        "候选清单记满 20 个（下方表格）",
      ],
      tools: [
        { label: "Amazon Best Sellers", href: "https://www.amazon.com/Best-Sellers/zgbs", external: true },
        { label: "Movers & Shakers", href: "https://www.amazon.com/gp/movers-and-shakers", external: true },
        { label: "New Releases", href: "https://www.amazon.com/gp/new-releases", external: true },
      ],
    },
    {
      id: "keepa",
      dayLabel: "Day 5",
      title: "Keepa 验证：价格与排名稳定性",
      intro: [
        "Keepa 免费版就能看价格历史和排名曲线。把 20 个候选逐个查一遍，按下面的标准杀——这一步通常能砍掉一半。",
        "核心逻辑：价格频繁跳水的品利润守不住，排名大起大落的品需求不真实。我们要的是“平稳赚钱”的品，不是“刺激”的品。",
      ],
      checklist: [
        "给 Keepa 浏览器插件装好（keepa.com 免费注册）",
        "20 个候选逐个查价格曲线，淘汰跳水品",
        "查排名曲线，淘汰大起大落的品",
        "候选清单缩减到 8 个以内",
      ],
      tools: [
        { label: "Keepa（免费版）", href: "https://keepa.com", external: true },
        { label: "去热销日历看季节性", href: "/amazon/trends" },
      ],
    },
    {
      id: "reviews",
      dayLabel: "Day 6–7",
      title: "差评挖掘：找切入点，定 3 个测试品",
      skippable: true,
      intro: [
        "最后一步：看剩下候选品的差评。重点看 3.5–4.2 星的产品——评分太高没改进空间，太低是质量问题碰不得。",
        "差评分类：如果集中吐槽“质量差”“与描述不符”→ 避开；如果吐槽“缺某个功能”“尺寸不对”“说明书看不懂”→ 这就是切入点，找有改进款的品。",
        "定出 3 个测试品，记下 ASIN，送入选品流水线跑 6 道门。手动流程到此结束，后面交给数据。",
        "赶时间可以直接点下方“跳过这步”——Keepa 验证过的品基本盘已经够稳，差评挖掘是加分项不是必答题。",
      ],
      checklist: [
        "每个候选品读 20 条以上差评",
        "按“质量问题避开 / 功能缺口机会”分类",
        "定出最终 3 个测试品并记下 ASIN",
        "把 3 个 ASIN 送入选品流水线",
      ],
      tools: [
        { label: "去选品流水线评估", href: "/amazon/pipeline" },
        { label: "去选品发现找更多候选", href: "/amazon/discovery" },
      ],
    },
  ],
};

export const en: AmazonManualGuideDict = {
  title: "Manual Picking SOP",
  description:
    "A 7-day manual product-picking flow that works without PA-API: pick categories → scan best-seller lists → Keepa validation → review mining, ending with 3 test products sent to the product pipeline. Progress is auto-saved in your browser.",
  progressLabel: "7-day progress",
  progressText: "{done}/{total}",
  stepDone: "Done",
  stepTodo: "In progress",
  skipStep: "Skip this step",
  expand: "Expand",
  collapse: "Collapse",
  categoriesTitle: "Pick your 2 categories",
  categoriesHint: "Select the 2 directions you know best or have supply/content advantages in. Don't spread thin.",
  selectedCount: "{n}/2 selected",
  candidateTitle: "Candidate list",
  candidateHint: "Jot down promising products while scanning. Aim for 20 — record roughly now, refine during Keepa validation.",
  scanCountryLabel: "Ranking site",
  pasteUrlPlaceholder: "Paste an Amazon product link to auto-fill name and ASIN (rank needs manual entry)",
  addFromUrl: "Add from link",
  parseUrlNoAsin: "No ASIN found in the link — make sure it's an Amazon product page URL",
  colName: "Product",
  colAsin: "ASIN",
  colRank: "Category rank",
  colNote: "Note",
  colAction: "Action",
  colNo: "#",
  viewProduct: "View",
  duplicateAsin: "This ASIN is already in the candidate list",
  unnamedProduct: "Unnamed product",
  keepaManualTitle: "Manual check",
  keepaManualHint: "Open each product on Amazon to check its Keepa chart, then tick it off",
  keepaManualProgress: "Checked {done}/{total}",
  visionButton: "AI Judge",
  visionNoLlm: "LLM not configured",
  visionNoLlmHint: "Configure an LLM in Admin → AI Settings first (needs a vision-capable model, e.g. GPT-4o).",
  visionModalTitle: "AI Chart Judgment",
  visionPriceLabel: "Price history chart (set Keepa to 90 days, enable Amazon price + New price curves)",
  visionRankLabel: "Sales Rank chart (also 90 days)",
  visionSubmit: "Judge",
  visionRunning: "Judging…",
  visionClose: "Close",
  visionNeedOne: "Please upload at least one screenshot.",
  visionConfidence: "Confidence",
  visionConfidenceHigh: "High",
  visionConfidenceMedium: "Medium",
  visionConfidenceLow: "Low",
  visionTabScreenshot: "Screenshot AI",
  visionTabManual: "Manual numbers",
  manualPriceGroup: "Price (copy from 90-day price history chart)",
  manualRankGroup: "Rank (optional, Keepa paywalled; copy from 90-day Sales Rank chart)",
  manualReviewGroup: "Reviews (numbers from Keepa panel, no screenshot needed)",
  mAmazonPriceNow: "Current Amazon price",
  mAmazonPrice30dAgo: "Amazon price 30 days ago",
  mPriceLow90d: "90-day low",
  mPriceHigh90d: "90-day high",
  mRankNow: "Current sales rank",
  mRankBest90d: "90-day best rank (lowest number)",
  mRankWorst90d: "90-day worst rank (highest number)",
  mReviewsNow: "Current review count",
  mReviews90dAgo: "Review count 90 days ago (optional)",
  manualInvalidNumber: "Enter valid numbers (≥0); low must not exceed high",
  manualFieldEmpty: "Please fill in '{label}'",
  manualFieldInvalid: "'{label}' must be a valid number (≥0)",
  manualLowGtHigh: "90-day low must not exceed 90-day high",
  manualRankPartial: "Fill all three rank fields, or leave all empty",
  addRow: "Add row",
  removeRow: "Delete",
  namePlaceholder: "e.g. noise-cancelling earbuds",
  asinPlaceholder: "B0XXXXXX",
  rankPlaceholder: "e.g. #12",
  notePlaceholder: "First impression",
  candidateEmpty: "No candidates yet — click “Add row” to start recording.",
  keepaPassTitle: "Pass criteria (keep)",
  keepaFailTitle: "Kill criteria (drop)",
  keepaPass: [
    "Price curve stable over the past 90 days, no frequent drops",
    "Category rank stably in the top 100 long-term",
    "Review count growing steadily (consistent sales)",
    "No long out-of-stock history",
  ],
  keepaFail: [
    "Price dropped over 25% in 30 days (margin won't hold)",
    "Rank swings wildly (likely review manipulation or short promos)",
    "Many reviews complaining about “poor quality” / “not as described”",
    "Long out-of-stock periods (unstable supply — testing is wasted)",
  ],
  keepaAutoTitle: "Auto-screen with Keepa",
  keepaAutoHint:
    "Keepa API key configured? One click checks each candidate ASIN against the criteria above (each validation consumes Keepa tokens).",
  keepaAutoButton: "Auto-screen now",
  keepaAutoRunning: "Screening… (querying one by one, please wait)",
  keepaNoKey: "Keepa API key not configured",
  keepaNoKeyHint:
    "Go to Admin → AI Settings → Keepa API key (get a paid key at keepa.com).",
  keepaNoAsin: "No ASINs in the candidate list — record ASINs in the list-scanning step first.",
  keepaVerdictPass: "Pass",
  keepaVerdictKill: "Drop",
  keepaVerdictUnknown: "Unknown",
  keepaApplyButton: "Apply: remove dropped items",
  keepaApplyConfirm: "Remove {n} dropped items?",
  keepaApplied: "Removed {n} dropped items.",
  keepaConfirmYes: "Confirm",
  keepaConfirmNo: "Cancel",
  keepaMetricDrop: "30d price drop",
  keepaMetricRank: "90d rank max/min",
  keepaMetricReviews: "90d review growth",
  keepaMetricStockout: "90d out-of-stock",
  keepaMetricNa: "no data",
  keepaReasons: {
    price_drop: "30-day drop {v}% (>25% — margin won't hold)",
    rank_swing: "90-day rank max/min {v}x (>10x — unstable)",
    stockout: "Out of stock {v} days in 90d (>30 — unstable supply)",
    pass: "Price, rank, reviews and stock all passed",
    no_data: "No Keepa data for this product",
    insufficient: "Insufficient history — cannot judge",
    rate_limited: "Keepa rate limited, retry later",
    tokens_exhausted: "Keepa tokens exhausted",
    fetch_failed: "Keepa request failed",
  },
  finalPickTitle: "Final 3 test products",
  finalPickHint:
    "Pick the top 3 from your candidate list, note their ASINs, then send them to the product pipeline for the 6-gate evaluation.",
  goPipeline: "Send to product pipeline →",
  congratsTitle: "7-day SOP complete!",
  congratsBody:
    "You've finished the full manual flow: category focus, list scanning, Keepa validation, review mining. Send the 3 test products to the pipeline for the 6 gates, then start small-budget live testing.",
  nextStepsTitle: "Next steps",
  nextSteps: [
    "Run the 6-gate evaluation in the product pipeline to get worth-testing scores",
    "Test all 3 with one budget via a combo test page and compare real click data",
    "Track ranking movements in Demand monitor once you have sales",
    "After 10 sales in 30 days, apply for PA-API and automate this manual flow",
  ],
  categories: [
    {
      id: "audio",
      name: "Audio & headphones",
      desc: "Earbuds, headphones, speakers. High repurchase; complaints cluster on battery/latency — lots of improved-model opportunities.",
    },
    {
      id: "smarthome",
      name: "Smart home",
      desc: "Smart plugs, sensor lights, doorbells. Mid-range prices; installation complaints are entry points; pairs well with blog content.",
    },
    {
      id: "charging",
      name: "Charging accessories",
      desc: "Chargers, power banks, cables. High-frequency essentials, but price wars are fierce — focus on differentiation (wattage/size).",
    },
    {
      id: "computer",
      name: "Computer accessories",
      desc: "Keyboards, mice, docks, stands. Higher tickets, knowledgeable reviewers — good for in-depth content.",
    },
    {
      id: "kitchen",
      name: "Kitchen gadgets",
      desc: "Air-fryer accessories, coffee gear, organizers. Very visual, great for short video/image posts; strong seasonality.",
    },
  ],
  steps: [
    {
      id: "categories",
      dayLabel: "Day 1–2",
      title: "Pick categories: choose 2 of 5",
      intro: [
        "The biggest beginner trap is jumping between categories — earbuds today, lamps tomorrow, mastering none. Fix 2 categories and look at nothing else for 7 days.",
        "Selection criteria: you've used the products (can write real reviews); you have supply or content advantages (e.g. your blog already covers them); price $20–$80 (the sweet spot for commission vs conversion).",
      ],
      checklist: [
        "Read all 5 category descriptions",
        "Select 2 categories (tap below)",
        "Write down your reason in one sentence (on paper)",
      ],
      tools: [],
    },
    {
      id: "scan",
      dayLabel: "Day 3–4",
      title: "Scan lists: find candidates on public rankings",
      intro: [
        "Amazon's Best Sellers, Movers & Shakers and New Releases are fully public — no API needed. Spend 30 minutes a day scanning your 2 categories.",
        "Focus on Movers & Shakers (rising rank) — it hides products gaining traction, easier to enter than Best Sellers' big brands. New Releases is good for new-product windows.",
        "Don't overthink while scanning — jot down anything promising, aim for 20 candidates. Record more; Keepa will kill half later.",
      ],
      checklist: [
        "Open Best Sellers, record promising products in category Top 50",
        "Open Movers & Shakers, find the 5 fastest risers",
        "Open New Releases for new-product opportunities",
        "Fill the candidate list to 20 (table below)",
      ],
      tools: [
        { label: "Amazon Best Sellers", href: "https://www.amazon.com/Best-Sellers/zgbs", external: true },
        { label: "Movers & Shakers", href: "https://www.amazon.com/gp/movers-and-shakers", external: true },
        { label: "New Releases", href: "https://www.amazon.com/gp/new-releases", external: true },
      ],
    },
    {
      id: "keepa",
      dayLabel: "Day 5",
      title: "Keepa validation: price & rank stability",
      intro: [
        "Keepa's free tier shows price history and rank curves. Check all 20 candidates against the criteria below — this step usually cuts half.",
        "Core logic: products with frequently crashing prices can't hold margin; products with wildly swinging ranks have unreal demand. We want “boringly profitable”, not “exciting”.",
      ],
      checklist: [
        "Install the Keepa browser extension (free signup at keepa.com)",
        "Check price curves for all 20, drop the divers",
        "Check rank curves, drop the roller-coasters",
        "Narrow the candidate list to 8 or fewer",
      ],
      tools: [
        { label: "Keepa (free)", href: "https://keepa.com", external: true },
        { label: "Check seasonality in Hot-selling calendar", href: "/amazon/trends" },
      ],
    },
    {
      id: "reviews",
      dayLabel: "Day 6–7",
      title: "Review mining: find entry points, lock 3 test products",
      skippable: true,
      intro: [
        "Final step: read the bad reviews of remaining candidates. Focus on 3.5–4.2 star products — higher ratings leave no improvement room, lower ones mean quality problems to avoid.",
        "Classify complaints: “poor quality” / “not as described” → avoid; “missing feature” / “wrong size” / “confusing manual” → that's your entry point, find improved versions.",
        "Lock in 3 test products, note their ASINs, and send them to the product pipeline for the 6 gates. The manual flow ends here — data takes over.",
        "Short on time? Hit “Skip this step” below — products validated by Keepa are already solid; review mining is a bonus, not a must.",
      ],
      checklist: [
        "Read 20+ bad reviews per candidate",
        "Classify: quality problems (avoid) vs feature gaps (opportunity)",
        "Lock in the final 3 test products with ASINs",
        "Send the 3 ASINs to the product pipeline",
      ],
      tools: [
        { label: "Evaluate in product pipeline", href: "/amazon/pipeline" },
        { label: "Find more candidates in Discovery", href: "/amazon/discovery" },
      ],
    },
  ],
};
