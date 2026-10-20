export interface AmazonPipelineDict {
  title: string;
  description: string;
  noviceMode: string;
  inputTitle: string;
  inputHint: string;
  inputPlaceholder: string;
  importFromDiscovery: string;
  imported: string;
  noImported: string;
  optionsTitle: string;
  minRating: string;
  minReviews: string;
  minMetricsScore: string;
  estimatedCpc: string;
  commission: string;
  maxBreakEvenCvrPct: string;
  riskCheck: string;
  country: string;
  run: string;
  running: string;
  runName: string;
  runNamePlaceholder: string;
  resultsTitle: string;
  worthIndex: string;
  killed: string;
  killedReason: string;
  weightsNote: string;
  gateQuality: string;
  gateDemand: string;
  gateMetrics: string;
  gateProfit: string;
  gateRisk: string;
  gateDenylist: string;
  comboButton: string;
  comboHint: string;
  watch: string;
  watching: string;
  watched: string;
  createOffer: string;
  surgeBadge: string;
  clickProfit: {
    recommendedBid: string;
    profitPerClick: string;
    perClick: string;
    formulaTitle: string;
    formulaBody: string;
    calibrateNote: string;
    notViable: string;
    commissionRateLabel: string;
    cvrLabel: string;
    cvrHint: string;
    priceLabel: string;
    fixedCommissionLabel: string;
    fixedCommissionHint: string;
    breakEvenCpc: string;
    commissionPerSale: string;
  };
  combo: {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    testDaysLabel: string;
    targetClicksLabel: string;
    create: string;
    creating: string;
    cancel: string;
    itemsCount: string;
    methodTitle: string;
    methodBody: string;
  };
  statusPass: string;
  statusFail: string;
  statusUnknown: string;
  historyTitle: string;
  historyEmpty: string;
  viewDetail: string;
  backToList: string;
  itemsCount: string;
  formulaNote: string;
  opportunityBonus: string;
  denyLowRating: string;
  denyBrandWord: string;
  denyPolicyCategory: string;
  denylist: {
    title: string;
    desc: string;
    typeLabel: string;
    valueLabel: string;
    valuePlaceholder: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    add: string;
    adding: string;
    delete: string;
    empty: string;
    loadError: string;
    types: Record<string, string>;
  };
  novice: {
    title: string;
    description: string;
    qBudget: string;
    qBudgetHint: string;
    qCategory: string;
    qCountry: string;
    start: string;
    starting: string;
    mathTitle: string;
    mathLine1: string;
    mathLine2: string;
    mathLine3: string;
    mathLine4: string;
    rateNote: string;
    top3Title: string;
    testPackage: string;
    landerTitle: string;
    landerBody: string;
    adCopyTitle: string;
    adCopyNote: string;
    stopLossTitle: string;
    stopLossBody: string;
    discoverFailed: string;
    pipelineFailed: string;
    noProducts: string;
  };
}

export const zh: AmazonPipelineDict = {
  title: "选品流水线",
  description:
    "5 道自动门逐项评估候选品，算出 0-100 值得测试指数并排序。unknown 只降权不杀；数学上打不平的直接杀。",
  noviceMode: "新手模式",
  inputTitle: "候选品输入",
  inputHint:
    "每行一个：ASIN（如 B0XXXXXX）或关键词。从选品发现页可一键送入已选结果。",
  inputPlaceholder: "B0XXXXXX\nwireless earbuds",
  importFromDiscovery: "从选品发现导入",
  imported: "已导入",
  noImported: "暂无可导入（请先去选品发现页点“送入流水线”）",
  optionsTitle: "门阈值设置",
  minRating: "最低评分",
  minReviews: "最低评论数",
  minMetricsScore: "指标门最低分",
  estimatedCpc: "预估 CPC（$）",
  commission: "单均佣金（$）",
  maxBreakEvenCvrPct: "盈亏平衡 CVR 上限 %",
  riskCheck: "开启 AI 风险门",
  country: "国家",
  run: "开始评估",
  running: "评估中（约需几十秒）…",
  runName: "本次运行名称（可选）",
  runNamePlaceholder: "如：2026-10-耳机类",
  resultsTitle: "评估结果",
  worthIndex: "值得测试指数",
  killed: "直接杀",
  killedReason: "数学上打不平（CPC 大于佣金），不建议测试",
  weightsNote:
    "权重：基础质量 20% / 需求 25% / 指标 20% / 盈亏 20% / 风险 15%；门得分 pass=100、unknown=50、fail=0，加权平均即指数。",
  gateQuality: "基础质量",
  gateDemand: "需求",
  gateMetrics: "指标",
  gateProfit: "盈亏",
  gateRisk: "风险",
  gateDenylist: "否定清单",
  comboButton: "生成组合测试页",
  comboHint: "勾选 5-10 个候选品，生成一个榜单页 + 各自跟踪链接，用一份预算测出点击最高的品。",
  watch: "跟踪",
  watching: "跟踪中…",
  watched: "已跟踪",
  createOffer: "建 Offer",
  surgeBadge: "需求异动",
  clickProfit: {
    recommendedBid: "推荐出价",
    profitPerClick: "期望盈亏",
    perClick: "/点击",
    formulaTitle: "公式",
    formulaBody:
      "公式：单次转化佣金 = 固定佣金 ?? 价格 × 佣金率；盈亏平衡出价 = 佣金 × 预估转化率；推荐出价 = 盈亏平衡出价 × 0.7（留 30% 安全边际）；期望盈亏/点击 = 佣金 × 预估转化率 − 出价。",
    calibrateNote:
      "推荐出价基于预估转化率（默认 2%），真实投放后请用实际转化数据回校；这只是起点不是终点。",
    notViable: "数学上不可投",
    commissionRateLabel: "佣金率（%，估算值）",
    cvrLabel: "预估转化率（%）",
    cvrHint: "预估值，投放后回校",
    priceLabel: "价格（$）",
    fixedCommissionLabel: "固定佣金（$，可选）",
    fixedCommissionHint: "有则优先",
    breakEvenCpc: "盈亏平衡出价",
    commissionPerSale: "单次转化佣金",
  },
  combo: {
    title: "生成组合测试页",
    nameLabel: "测试名称",
    namePlaceholder: "如：厨房小家电组合测试",
    testDaysLabel: "测试天数",
    targetClicksLabel: "目标点击数",
    create: "生成",
    creating: "生成中…",
    cancel: "取消",
    itemsCount: "已选产品",
    methodTitle: "方法论：一份预算、一个页面、数据排序",
    methodBody:
      "5-10 个候选品放进同一个榜单页，每个品带各自的跟踪链接，用同一份广告预算引流。跑满天数或点击数后按出站点击排名，点击最高者值得单独深入测试。",
  },
  statusPass: "通过",
  statusFail: "未通过",
  statusUnknown: "未知",
  historyTitle: "历史运行",
  historyEmpty: "暂无历史运行。",
  viewDetail: "查看",
  backToList: "返回",
  itemsCount: "个产品",
  formulaNote:
    "公式：指数 = Σ(门权重 × 门得分)，权重：质量 15% / 需求 20% / 指标 15% / 盈亏 20% / 风险 15% / 否定清单 15%；否定清单命中直接杀；机会品额外 +10（上限 100）；盈亏平衡转化率 = CPC ÷ 佣金 × 100%。",
  opportunityBonus: "机会品 +10",
  denyLowRating: "内置：评分<3.5 直接杀",
  denyBrandWord: "内置：品牌词风险直接杀",
  denyPolicyCategory: "内置：政策风险品类直接杀",
  denylist: {
    title: "别碰清单",
    desc: "“不测什么”比“测什么”更重要：命中清单的产品在第 6 道门直接淘汰，不进测试。",
    typeLabel: "类型",
    valueLabel: "值",
    valuePlaceholder: "如：B0XXXX / 品牌词 / 关键词",
    reasonLabel: "原因（可选）",
    reasonPlaceholder: "为什么不测",
    add: "加入清单",
    adding: "加入中…",
    delete: "删除",
    empty: "清单为空。把踩过坑的 ASIN、品牌词、关键词加进来，省下测试预算。",
    loadError: "加载失败",
    types: { asin: "ASIN", keyword: "关键词", brand: "品牌词", category: "品类" },
  },
  novice: {
    title: "新手模式：一键选品",
    description: "只回答 3 个问题，系统按预算反推可行价格带，自动跑流水线并输出 top 3 测试包。",
    qBudget: "每日测试预算（$）",
    qBudgetHint: "如 30（美元/天）",
    qCategory: "类目",
    qCountry: "国家",
    start: "一键选品",
    starting: "选品评估中…",
    mathTitle: "预算数学（公式透明）",
    mathLine1: "按 $1 CPC：每日约 {clicks} 次点击",
    mathLine2: "盈亏平衡转化率 ≤15% → 单均佣金需 ≥ ${commission}",
    mathLine3: "按佣金率估算值 {rate}% → 建议价格 ≥ ${price}",
    mathLine4: "已按 {category} 类目关键词自动选品",
    rateNote: "佣金率为 Amazon 估算值，实际以类目政策为准；CPC $1 为假设，真实投放后请用实际数据回校。",
    top3Title: "Top 3 测试包",
    testPackage: "测试包",
    landerTitle: "落地页",
    landerBody: "建议用评测模板建草稿",
    adCopyTitle: "广告文案草稿",
    adCopyNote: "确定性模板生成，非 AI 撰写，投放前请人工优化。",
    stopLossTitle: "建议止损线",
    stopLossBody: "花费 ≥ ${amount} 且 0 转化 → 暂停",
    discoverFailed: "自动选品失败",
    pipelineFailed: "流水线评估失败",
    noProducts: "该条件下未找到候选品，试试调低价格或换类目。",
  },
};

export const en: AmazonPipelineDict = {
  title: "Product pipeline",
  description:
    "Evaluate candidates through 5 automated gates and rank them by a 0–100 worth-testing index. Unknown only demotes, never kills; mathematically impossible ones are killed outright.",
  noviceMode: "Beginner mode",
  inputTitle: "Candidates",
  inputHint:
    "One per line: an ASIN (e.g. B0XXXXXX) or a keyword. You can also send results from Product Discovery.",
  inputPlaceholder: "B0XXXXXX\nwireless earbuds",
  importFromDiscovery: "Import from Discovery",
  imported: "imported",
  noImported: "Nothing to import (use “Send to pipeline” on the Discovery page first)",
  optionsTitle: "Gate thresholds",
  minRating: "Min rating",
  minReviews: "Min reviews",
  minMetricsScore: "Min metrics score",
  estimatedCpc: "Est. CPC ($)",
  commission: "Commission per sale ($)",
  maxBreakEvenCvrPct: "Max break-even CVR %",
  riskCheck: "Enable AI risk gate",
  country: "Country",
  run: "Evaluate",
  running: "Evaluating (takes tens of seconds)…",
  runName: "Run name (optional)",
  runNamePlaceholder: "e.g. 2026-10-earbuds",
  resultsTitle: "Results",
  worthIndex: "Worth-testing index",
  killed: "Killed",
  killedReason: "Mathematically impossible (CPC exceeds commission) — do not test",
  weightsNote:
    "Weights: quality 20% / demand 25% / metrics 20% / profit 20% / risk 15%; gate scores pass=100, unknown=50, fail=0; weighted average = index.",
  gateQuality: "Quality",
  gateDemand: "Demand",
  gateMetrics: "Metrics",
  gateProfit: "Profit",
  gateRisk: "Risk",
  gateDenylist: "Denylist",
  comboButton: "Create combo test page",
  comboHint: "Select 5-10 candidates to generate one listicle page with per-product tracking links; one budget reveals the top click-getter.",
  watch: "Track",
  watching: "Tracking…",
  watched: "Tracked",
  createOffer: "Create Offer",
  surgeBadge: "Demand surges",
  clickProfit: {
    recommendedBid: "Recommended bid",
    profitPerClick: "Expected profit",
    perClick: "/click",
    formulaTitle: "Formula",
    formulaBody:
      "Formula: commission per sale = fixed commission ?? price × rate; break-even CPC = commission × estimated CVR; recommended bid = break-even CPC × 0.7 (30% safety margin); expected profit/click = commission × CVR − bid.",
    calibrateNote:
      "The recommended bid is based on an estimated conversion rate (default 2%). Calibrate with real conversion data after launch — this is a starting point, not the finish line.",
    notViable: "Not viable mathematically",
    commissionRateLabel: "Commission rate (%, estimate)",
    cvrLabel: "Estimated CVR (%)",
    cvrHint: "Estimate — calibrate after launch",
    priceLabel: "Price ($)",
    fixedCommissionLabel: "Fixed commission ($, optional)",
    fixedCommissionHint: "Takes precedence if set",
    breakEvenCpc: "Break-even CPC",
    commissionPerSale: "Commission per sale",
  },
  combo: {
    title: "Create combo test page",
    nameLabel: "Test name",
    namePlaceholder: "e.g. Kitchen gadgets combo test",
    testDaysLabel: "Test days",
    targetClicksLabel: "Target clicks",
    create: "Create",
    creating: "Creating…",
    cancel: "Cancel",
    itemsCount: "Selected products",
    methodTitle: "Method: one budget, one page, data-ranked",
    methodBody:
      "Put 5-10 candidates on one listicle page, each with its own tracking link, driven by a single ad budget. After the set days or clicks, rank by outbound clicks — the top one deserves a dedicated deep test.",
  },
  statusPass: "Pass",
  statusFail: "Fail",
  statusUnknown: "Unknown",
  historyTitle: "History",
  historyEmpty: "No past runs.",
  viewDetail: "View",
  backToList: "Back",
  itemsCount: "items",
  formulaNote:
    "Formula: index = Σ(gate weight × gate score); weights: quality 15% / demand 20% / metrics 15% / profit 20% / risk 15% / denylist 15%; denylist hits kill directly; opportunity items get +10 (capped at 100); break-even CVR = CPC ÷ commission × 100%.",
  opportunityBonus: "Opportunity +10",
  denyLowRating: "Built-in: rating<3.5 kills",
  denyBrandWord: "Built-in: brand-word risk kills",
  denyPolicyCategory: "Built-in: policy-risk category kills",
  denylist: {
    title: "Denylist",
    desc: "\"What not to test\" matters more than what to test: items matching the list are killed at gate 6.",
    typeLabel: "Type",
    valueLabel: "Value",
    valuePlaceholder: "e.g. B0XXXX / brand word / keyword",
    reasonLabel: "Reason (optional)",
    reasonPlaceholder: "Why skip it",
    add: "Add",
    adding: "Adding…",
    delete: "Delete",
    empty: "List is empty. Add ASINs, brand words or keywords you have learned to avoid.",
    loadError: "Load failed",
    types: { asin: "ASIN", keyword: "Keyword", brand: "Brand", category: "Category" },
  },
  novice: {
    title: "Beginner mode: one-click picking",
    description: "Answer 3 questions; the system derives a viable price band from your budget, runs the pipeline and outputs top 3 test packages.",
    qBudget: "Daily test budget ($)",
    qBudgetHint: "e.g. 30 (USD/day)",
    qCategory: "Category",
    qCountry: "Country",
    start: "Pick for me",
    starting: "Picking & evaluating…",
    mathTitle: "Budget math (transparent)",
    mathLine1: "At $1 CPC: ~{clicks} clicks/day",
    mathLine2: "Break-even CVR ≤15% → commission per sale ≥ ${commission}",
    mathLine3: "At estimated {rate}% commission rate → suggested price ≥ ${price}",
    mathLine4: "Auto-discovered with {category} keywords",
    rateNote: "Commission rates are Amazon estimates; actual rates follow category policy. $1 CPC is an assumption — calibrate with real data after launch.",
    top3Title: "Top 3 test packages",
    testPackage: "Test package",
    landerTitle: "Landing page",
    landerBody: "Draft with the review template",
    adCopyTitle: "Ad copy draft",
    adCopyNote: "Deterministic template, not AI-written — refine manually before launch.",
    stopLossTitle: "Suggested stop-loss",
    stopLossBody: "Spend ≥ ${amount} with 0 conversions → pause",
    discoverFailed: "Auto-discovery failed",
    pipelineFailed: "Pipeline evaluation failed",
    noProducts: "No candidates under these conditions — try lowering the price or another category.",
  },
};
