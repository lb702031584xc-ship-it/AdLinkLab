/**
 * 第十六批：类目关键词启动包字典。
 */
export interface KeywordStarterDict {
  pageTitle: string;
  pageSubtitle: string;
  pickCategory: string;
  templateNames: Record<"best" | "review" | "vs", string>;
  templateHints: Record<"best" | "review" | "vs", string>;
  copyAll: string;
  copied: string;
  goDiscover: string;
  goAds: string;
  importNote: string;
  /* 双 Tab */
  tabs: Record<"research" | "launch", string>;
  researchSubtitle: string;
  launchSubtitle: string;
  /* 需求验证 */
  importSeeds: string;
  demandTitle: string;
  demandSubtitle: string;
  kwPlaceholder: string;
  addKeyword: string;
  importKeywords: string;
  bulkPlaceholder: string;
  doImport: string;
  cancel: string;
  thVolume: string;
  thTrend: string;
  thCompetition: string;
  thIntent: string;
  trendOptions: Record<"up" | "flat" | "down", string>;
  competitionOptions: Record<"low" | "medium" | "high", string>;
  intentOptions: Record<"buy" | "review" | "compare" | "info", string>;
  verdictOptions: Record<"good" | "caution" | "bad", string>;
  demandLevels: Record<"strong" | "weak" | "none", string>;
  beatableLevels: Record<"yes" | "caution" | "no", string>;
  demandLabel: string;
  beatableLabel: string;
  summaryTitle: string;
  summaryLine: string;
  importValidatedBtn: string;
  emptyDemand: string;
  remove: string;
  openPlanner: string;
  openTrends: string;
  openSemrush: string;
  /* AI 推荐关键词 */
  aiRecommendTitle: string;
  aiRecommendHint: string;
  aiProductPlaceholder: string;
  aiRecommendBtn: string;
  aiRecommending: string;
  aiScore: string;
  aiImportAll: string;
  aiImportOne: string;
  aiFailed: string;
  aiNoScoreHint: string;
  sourceCapture: string;
  sourceAi: string;
  /* P1-10：规则生成关键词（无 LLM，无假搜索量） */
  ruleTitle: string;
  ruleHint: string;
  ruleSeeds: string;
  ruleBrand: string;
  ruleDomain: string;
  ruleGenerate: string;
  ruleGenerating: string;
  ruleImportAll: string;
  ruleImportOne: string;
  ruleFailed: string;
  ruleCoverageWarn: string;
  ruleNoVolume: string;
  ruleKindLabels: Record<"brand-suffix" | "seed-combo" | "token-suffix", string>;
  ruleSourceLabel: string;
  captureKwFrom: string;
  captureKwPage: string;
  captureKwVolume: string;
  captureKwExtracting: string;
  captureFillAll: string;
  captureFillRow: string;
  captureFilling: string;
  captureFillDone: string;
  captureFillNone: string;
  captureFillRowDone: string;
  captureFillRowNone: string;
  /* 投放选词 */
  planTitle: string;
  history: string;
  historyEmpty: string;
  historyUntitled: string;
  restoredNote: string;
  autosaveHint: string;
  planSubtitle: string;
  thKeyword: string;
  thAdGroup: string;
  thMatchType: string;
  thBid: string;
  thRefCpc: string;
  matchOptions: Record<"exact" | "phrase" | "broad", string>;
  addRow: string;
  bulkImportTitle: string;
  bulkPlanPlaceholder: string;
  copyPlan: string;
  bidHint: string;
  autoGroup: string;
  fillBids: string;
  nextStepTitle: string;
  nextStepHint: string;
  goAutoAds: string;
  negativesTitle: string;
  negativesSubtitle: string;
  negPlaceholder: string;
  addNegative: string;
  universalLibrary: string;
  addAllNegatives: string;
  copyNegatives: string;
  emptyNegatives: string;
}

export const zh: KeywordStarterDict = {
  pageTitle: "关键词启动包",
  pageSubtitle: "选类目 → 按模板生成种子词 → 复制去投放或做 AI 扩词。",
  pickCategory: "选类目",
  templateNames: { best: "best X", review: "X review", vs: "X vs Y" },
  templateHints: {
    best: "购买意向最强，直接冲转化",
    review: "评测意向，适合评测落地页",
    vs: "对比意向，适合对比落地页",
  },
  copyAll: "复制全部",
  copied: "已复制，去粘贴吧",
  goDiscover: "去选品",
  goAds: "去广告创建",
  importNote:
    "导入方式：点“复制全部”粘贴到 Google Ads 关键词规划师或 AI 扩词；也可逐个去选品验证需求。",
  tabs: { research: "需求验证", launch: "投放选词" },
  researchSubtitle: "选品用：先确认有没有人搜、竞争打不打得过，再决定跟不跟进。",
  launchSubtitle: "投流用：把词分组、定匹配方式、加否定词、定出价，直接开投。",
  importSeeds: "↓ 导入需求验证",
  demandTitle: "需求验证清单",
  demandSubtitle:
    "给每个词填月搜索量、趋势、竞争度、意图，自动给出结论。数据去关键词规划师 / SEMrush / Google Trends 查，一键直达。",
  kwPlaceholder: "输入关键词，如 best robot vacuum",
  addKeyword: "添加关键词",
  importKeywords: "批量导入",
  bulkPlaceholder: "每行一个关键词，批量粘贴：\nbest robot vacuum\nrobot vacuum review\n...",
  doImport: "导入",
  cancel: "取消",
  thVolume: "月搜索量",
  thTrend: "趋势",
  thCompetition: "竞争度",
  thIntent: "搜索意图",
  trendOptions: { up: "上升", flat: "平稳", down: "下降" },
  competitionOptions: { low: "低", medium: "中", high: "高" },
  intentOptions: { buy: "购买", review: "评测", compare: "对比", info: "纯信息" },
  verdictOptions: { good: "值得跟进", caution: "谨慎测试", bad: "建议放弃" },
  demandLevels: { strong: "需求强", weak: "需求弱", none: "几乎无需求" },
  beatableLevels: { yes: "可打", caution: "难打", no: "打不过" },
  demandLabel: "需求",
  beatableLabel: "竞争",
  summaryTitle: "验证小结",
  summaryLine: "共 {total} 个关键词：{good} 个值得跟进 · {caution} 个谨慎测试 · {bad} 个建议放弃",
  importValidatedBtn: "把 {n} 个值得跟进/谨慎测试的词导入投放选词 →",
  emptyDemand: "还没有关键词。先在上方按类目生成种子词，一键导入；或手动添加。",
  remove: "删除",
  openPlanner: "规划师",
  openTrends: "Trends",
  openSemrush: "SEMrush",
  aiRecommendTitle: "AI 推荐关键词",
  aiRecommendHint: "输入产品/品类，AI 按搜索需求×商业意图×竞争可打性打分推荐",
  aiProductPlaceholder: "例如：robot vacuum",
  aiRecommendBtn: "AI 推荐",
  aiRecommending: "推荐中…",
  aiScore: "评分",
  aiImportAll: "全部导入",
  aiImportOne: "导入",
  aiFailed: "AI 推荐失败，请稍后重试",
  aiNoScoreHint: "💡 以下为 AI 选词思路（未打分）。导入后去 SEMRUSH/规划师查真实数据填入下方，系统按真实数据算分。",
  sourceCapture: "抓取",
  sourceAi: "AI",
  /* P1-10：规则生成关键词（无 LLM，无假搜索量） */
  ruleTitle: "规则生成关键词",
  ruleHint: "种子词 × 意图后缀 / 品牌词 × 后缀 / 种子两两组合，规则分与 AI 无关；搜索量/竞争度未连接 Keyword Planner 时显示 —，不编造。",
  ruleSeeds: "种子词（逗号分隔）",
  ruleBrand: "品牌词（逗号分隔，可空）",
  ruleDomain: "域名（用于规则分加成，可空）",
  ruleGenerate: "规则生成",
  ruleGenerating: "生成中…",
  ruleImportAll: "全部导入",
  ruleImportOne: "导入",
  ruleFailed: "规则生成失败，请稍后重试",
  ruleCoverageWarn: "品牌覆盖低",
  ruleNoVolume: "未连接 Keyword Planner，搜索量/竞争度为 —",
  ruleKindLabels: { "brand-suffix": "品牌+后缀", "seed-combo": "种子组合", "token-suffix": "词+后缀" },
  ruleSourceLabel: "规则生成",
  captureKwFrom: "抓取自",
  captureKwPage: "抓取页",
  captureKwVolume: "月搜索量",
  captureKwExtracting: "🤖 AI 正在读取抓取页面，提取里面的真实关键词…",
  captureFillAll: "📥 抓取填充参数（全部）",
  captureFillRow: "📥 抓取填充",
  captureFilling: "🤖 AI 正在读取抓取页面，提取参数…",
  captureFillDone: "已从抓取页填充 {n} 个词的参数",
  captureFillNone: "抓取页里没找到这些词，未覆盖",
  captureFillRowDone: "已从抓取页填充参数",
  captureFillRowNone: "抓取页里没找到这个词，未覆盖",
  planTitle: "投放关键词计划",
  history: "历史记录",
  historyEmpty: "还没有保存的关键词进度。",
  historyUntitled: "未命名计划",
  restoredNote: "已恢复 {time} 的进度，继续吧",
  autosaveHint: "进度会自动保存，刷新或隔天回来可继续",
  planSubtitle:
    "逐词定分组、匹配方式和出价。匹配方式新手建议从“词组”起步，跑出数据再放宽到广泛。",
  thKeyword: "关键词",
  thAdGroup: "广告组",
  thMatchType: "匹配方式",
  thBid: "出价",
  thRefCpc: "参考 CPC",
  matchOptions: { exact: "完全匹配", phrase: "词组匹配", broad: "广泛匹配" },
  addRow: "加一行",
  bulkImportTitle: "批量导入",
  bulkPlanPlaceholder:
    "CSV 格式，每行一个词：关键词, 广告组, 匹配方式(exact/phrase/broad), 出价, 参考CPC\nbest robot vacuum, 通用组, phrase, 1.2, 0.9\nrobot vacuum review, 评测组, exact, 1.5,",
  copyPlan: "复制投放计划",
  bidHint: "出价建议：不超过“目标 CPA × 预期转化率”。比如目标 CPA $20、预期转化率 2%，出价上限就是 $0.4。",
  autoGroup: "一键自动分组",
  fillBids: "一键填建议出价",
  nextStepTitle: "计划定稿，下一步",
  nextStepHint: "复制计划去 Google Ads 后台建组，或去自动化广告让 AI 生成广告系列结构和 RSA 文案。",
  goAutoAds: "去自动化广告",
  negativesTitle: "否定关键词",
  negativesSubtitle: "把不带来转化的搜索词提前排除，省预算。先一键加入通用否定词库，再按你的行业补充。",
  negPlaceholder: "输入否定词，如 免费",
  addNegative: "添加",
  universalLibrary: "通用否定词库",
  addAllNegatives: "一键全加",
  copyNegatives: "复制否定词",
  emptyNegatives: "还没有否定词。",
};

export const en: KeywordStarterDict = {
  pageTitle: "Keyword Starter Pack",
  pageSubtitle: "Pick a category → generate seed keywords from templates → copy to use.",
  pickCategory: "Category",
  templateNames: { best: "best X", review: "X review", vs: "X vs Y" },
  templateHints: {
    best: "Strongest buying intent — go for conversions",
    review: "Review intent — fits review landing pages",
    vs: "Comparison intent — fits comparison pages",
  },
  copyAll: "Copy all",
  copied: "Copied — go paste them",
  goDiscover: "Discover",
  goAds: "Create ads",
  importNote:
    "Import: hit “Copy all” and paste into Google Ads Keyword Planner or AI expansion; or validate demand per keyword in discovery.",
  tabs: { research: "Demand check", launch: "Launch keywords" },
  researchSubtitle: "For product selection: confirm real search demand and beatable competition before pursuing.",
  launchSubtitle: "For paid traffic: group keywords, set match types, add negatives, set bids — ready to launch.",
  importSeeds: "↓ Import to demand check",
  demandTitle: "Demand checklist",
  demandSubtitle:
    "Fill monthly volume, trend, competition and intent per keyword for an automatic verdict. Look data up in Keyword Planner / SEMrush / Google Trends via one-click links.",
  kwPlaceholder: "Enter a keyword, e.g. best robot vacuum",
  addKeyword: "Add keyword",
  importKeywords: "Bulk import",
  bulkPlaceholder: "One keyword per line:\nbest robot vacuum\nrobot vacuum review\n...",
  doImport: "Import",
  cancel: "Cancel",
  thVolume: "Monthly volume",
  thTrend: "Trend",
  thCompetition: "Competition",
  thIntent: "Search intent",
  trendOptions: { up: "Rising", flat: "Flat", down: "Declining" },
  competitionOptions: { low: "Low", medium: "Medium", high: "High" },
  intentOptions: { buy: "Buy", review: "Review", compare: "Compare", info: "Informational" },
  verdictOptions: { good: "Worth pursuing", caution: "Test cautiously", bad: "Drop" },
  demandLevels: { strong: "Strong demand", weak: "Weak demand", none: "Almost no demand" },
  beatableLevels: { yes: "Beatable", caution: "Tough", no: "Not beatable" },
  demandLabel: "Demand",
  beatableLabel: "Competition",
  summaryTitle: "Summary",
  summaryLine: "{total} keywords: {good} worth pursuing · {caution} test cautiously · {bad} drop",
  importValidatedBtn: "Import {n} worth-pursuing/cautious keywords to launch →",
  emptyDemand: "No keywords yet. Generate seed keywords by category above and import them, or add manually.",
  remove: "Remove",
  openPlanner: "Planner",
  openTrends: "Trends",
  openSemrush: "SEMrush",
  aiRecommendTitle: "AI keyword suggestions",
  aiRecommendHint: "Enter a product/niche; AI scores by demand × intent × beatability",
  aiProductPlaceholder: "e.g. robot vacuum",
  aiRecommendBtn: "Recommend",
  aiRecommending: "Recommending…",
  aiScore: "Score",
  aiImportAll: "Import all",
  aiImportOne: "Import",
  aiFailed: "Recommendation failed, please try again",
  aiNoScoreHint: "💡 Keyword ideas from AI (not scored). Import them, fill in real SEMRUSH/Planner data below, and the system scores from real data.",
  sourceCapture: "Captured",
  sourceAi: "AI",
  /* P1-10：rule-generated keywords (no LLM, no invented volumes) */
  ruleTitle: "Rule-generated keywords",
  ruleHint: "Seeds × intent suffixes / brand × suffix / seed pairs. Rule score is independent of AI; volume/competition show — when Keyword Planner is not connected, never invented.",
  ruleSeeds: "Seeds (comma-separated)",
  ruleBrand: "Brand terms (comma-separated, optional)",
  ruleDomain: "Domain (rule-score bonus, optional)",
  ruleGenerate: "Generate by rules",
  ruleGenerating: "Generating…",
  ruleImportAll: "Import all",
  ruleImportOne: "Import",
  ruleFailed: "Rule generation failed, please try again",
  ruleCoverageWarn: "Low brand coverage",
  ruleNoVolume: "Keyword Planner not connected — volume/competition shown as —",
  ruleKindLabels: { "brand-suffix": "Brand+suffix", "seed-combo": "Seed combo", "token-suffix": "Token+suffix" },
  ruleSourceLabel: "Rule-generated",
  captureKwFrom: "Captured from",
  captureKwPage: "captured page",
  captureKwVolume: "Volume",
  captureKwExtracting: "🤖 AI is reading the captured page, extracting its real keywords…",
  captureFillAll: "📥 Fill params from capture (all)",
  captureFillRow: "📥 Fill from capture",
  captureFilling: "🤖 AI is reading the captured page, extracting params…",
  captureFillDone: "Filled params for {n} keywords from the captured page",
  captureFillNone: "No matching keywords found on the captured page; nothing overwritten",
  captureFillRowDone: "Params filled from the captured page",
  captureFillRowNone: "This keyword was not found on the captured page; nothing overwritten",
  planTitle: "Launch keyword plan",
  history: "History",
  historyEmpty: "No saved keyword progress yet.",
  historyUntitled: "Untitled plan",
  restoredNote: "Restored progress from {time} — carry on",
  autosaveHint: "Progress auto-saves; refresh or come back tomorrow to continue",
  planSubtitle:
    "Set ad group, match type and bid per keyword. Beginners: start with “Phrase”, loosen to “Broad” after data comes in.",
  thKeyword: "Keyword",
  thAdGroup: "Ad group",
  thMatchType: "Match type",
  thBid: "Bid",
  thRefCpc: "Ref. CPC",
  matchOptions: { exact: "Exact", phrase: "Phrase", broad: "Broad" },
  addRow: "Add row",
  bulkImportTitle: "Bulk import",
  bulkPlanPlaceholder:
    "CSV, one keyword per line: keyword, ad group, match type (exact/phrase/broad), bid, ref CPC\nbest robot vacuum, General, phrase, 1.2, 0.9\nrobot vacuum review, Review, exact, 1.5,",
  copyPlan: "Copy launch plan",
  bidHint: "Bid rule of thumb: stay under “target CPA × expected CVR”. E.g. target CPA $20 × 2% CVR = max bid $0.4.",
  autoGroup: "Auto-group",
  fillBids: "Fill suggested bids",
  nextStepTitle: "Plan ready — next step",
  nextStepHint: "Copy the plan into Google Ads, or head to Automated Ads for AI-generated campaign structure and RSA copy.",
  goAutoAds: "Automated Ads",
  negativesTitle: "Negative keywords",
  negativesSubtitle: "Exclude searches that never convert to save budget. Add the universal library first, then your niche terms.",
  negPlaceholder: "Enter a negative, e.g. free",
  addNegative: "Add",
  universalLibrary: "Universal negative library",
  addAllNegatives: "Add all",
  copyNegatives: "Copy negatives",
  emptyNegatives: "No negatives yet.",
};
