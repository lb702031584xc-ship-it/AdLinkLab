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
  /* DataForSEO 实测流水线（扩词 → 筛选 → 勾选 → 测算 → 导入投放） */
  dfs: {
    title: string;
    subtitle: string;
    steps: Record<"expand" | "filter" | "pick" | "measure" | "import", string>;
    seedLabel: string;
    seedPlaceholder: string;
    countryLabel: string;
    languageLabel: string;
    langAuto: string;
    expandLimitLabel: string;
    expandLimitHint: string;
    expandBtn: string;
    expanding: string;
    expandedLine: string;
    cachedNote: string;
    /** 扩词缓存说明（14 天内同种子重跑免费）。 */
    expandCacheNote: string;
    filterTitle: string;
    minVolumeLabel: string;
    minVolumeHint: string;
    competitionLabel: string;
    competitionModes: Record<"lowPlusMedium" | "lowOnly" | "all", string>;
    intentToggle: string;
    filterBtn: string;
    filtering: string;
    filterLine: string;
    filterStageLine: string;
    intentUnverified: string;
    pickLine: string;
    selectAll: string;
    selectNone: string;
    /** 被过滤词展开/收起开关。 */
    showFiltered: string;
    hideFiltered: string;
    /** 被过滤原因（按 outcome）。 */
    outcomeReasons: Record<"out-volume" | "out-competition" | "out-intent", string>;
    /** 人工勾选了被过滤词的行标记。 */
    keptBadge: string;
    /** 已购用户风险标记（启发式）。 */
    ownedRiskBadge: string;
    /** 型号特征标记（启发式）。 */
    modelBadge: string;
    /** 标记口径说明小字（标明启发式、非事实）。 */
    marksNote: string;
    thCpc: string;
    thBidRange: string;
    thCompIndex: string;
    competitionLevels: Record<"LOW" | "MEDIUM" | "HIGH", string>;
    intentLabels: Record<"informational" | "navigational" | "commercial" | "transactional", string>;
    emptyCandidates: string;
    needFilterFirst: string;
    measureLimitLabel: string;
    measureLimitHint: string;
    measureBtn: string;
    measuring: string;
    measureNeedPick: string;
    estimateNote: string;
    measuredLine: string;
    importBtn: string;
    failed: string;
    /** 付费数据网关计费路径标注（付费按钮旁）。 */
    billing: {
      platform: string;
      platformNoLimit: string;
      tenantOwn: string;
      owner: string;
      denied: string;
      loading: string;
    };
  };
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
  /* #13 意图分组 */
  intentGroupsTitle: string;
  intentGroupsRule: string;
  intentGroupsEmpty: string;
  intentGroupChange: string;
  intentGroupLanding: string;
  /* #14 否定词预置 + 承接页类型 */
  landingKindLabel: string;
  landingKindUnset: string;
  landingKinds: Record<"homepage" | "product" | "review" | "compare" | "guide" | "landing", string>;
  presetBaseNegatives: string;
  reviewLandingNote: string;
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
  dfs: {
    title: "实测长尾流水线（DataForSEO）",
    subtitle: "真实搜索数据扩词 → 多轮筛选 → 人工勾选 → 广告测算。付费数据只花在扩词、幸存词的意图过滤和你勾选的词上，不为不会投的词花钱。",
    steps: {
      expand: "① 输入种子词，点「扩词」",
      filter: "② 设筛选参数，点「筛选」（看条数变化）",
      pick: "③ 勾选要投的词",
      measure: "④ 点「广告测算」看估算 CPC 与页首出价",
      import: "⑤ 点「导入投放」，把勾选词送进投放选词",
    },
    seedLabel: "种子词",
    seedPlaceholder: "如 robot vacuum（可从上方 Offer 带入）",
    countryLabel: "国家",
    languageLabel: "语言",
    langAuto: "跟随国家",
    expandLimitLabel: "每种子返回上限",
    expandLimitHint: "推荐 100（范围 10–200；Labs 按返回条数计费，这里就是省钱阀门）",
    expandBtn: "扩词",
    expanding: "扩词中…",
    expandedLine: "已扩 {n} 条候选",
    cachedNote: "来自 14 天内缓存，未重复收费",
    expandCacheNote: "扩词结果在服务器缓存 14 天：同一种子（同国家 / 语言 / 上限）重跑免费，不重复计费。",
    filterTitle: "多轮筛选（本地过滤不花钱；意图过滤只对幸存词调用）",
    minVolumeLabel: "搜索量下限",
    minVolumeHint: "推荐：核心词 1000 / 长尾 100（一刀切 1000 会误杀长尾）；搜索量未知的词不拦",
    competitionLabel: "竞争度上限",
    competitionModes: { lowPlusMedium: "低 + 中", lowOnly: "只留低", all: "不限" },
    intentToggle: "购买意图过滤（只留商业 / 交易意图）",
    filterBtn: "筛选",
    filtering: "筛选中…",
    filterLine: "筛选：{x} 条 → 通过 {y} 条（被过滤 {k} 条）",
    filterStageLine: "本地过滤（搜索量+竞争度）后 {a} 条 → 意图过滤后 {b} 条",
    intentUnverified: "意图未验证：DataForSEO 未能确认意图，已保留全部词（不丢词）",
    pickLine: "已勾 {n} 条",
    selectAll: "全选",
    selectNone: "全不选",
    showFiltered: "显示被过滤的 {k} 条",
    hideFiltered: "隐藏被过滤的词",
    outcomeReasons: { "out-volume": "搜索量低于下限", "out-competition": "竞争度超出上限", "out-intent": "意图非购买向" },
    keptBadge: "人工保留",
    ownedRiskBadge: "疑似已购用户",
    modelBadge: "含型号特征",
    marksNote: "标记说明（启发式，不是事实）：「含型号特征」= 词里有字母+数字组合（如 s8、q7），通常更接近购买；「疑似已购用户」= 命中 app / 登录 / 支持等词，搜的人多半已经买过。被过滤的词不会消失，展开后可以人工勾选保留。",
    thCpc: "估算 CPC",
    thBidRange: "页首出价区间",
    thCompIndex: "竞争指数",
    competitionLevels: { LOW: "低", MEDIUM: "中", HIGH: "高" },
    intentLabels: { informational: "信息", navigational: "导航", commercial: "商业", transactional: "交易" },
    emptyCandidates: "还没有候选词。先在第 ① 步输入种子词点「扩词」。",
    needFilterFirst: "先点「筛选」，再勾选要投的词。",
    measureLimitLabel: "测算返回条数",
    measureLimitHint: "推荐 10–30（一个 Offer 首轮 1–3 个广告组 × 5–15 词就够）",
    measureBtn: "广告测算",
    measuring: "测算中…",
    measureNeedPick: "先勾选要测算的词才能点（测算只为勾选词付费）",
    estimateNote: "以下为 DataForSEO 估算数据 · 仅供参考，不参与出价计算（出价仍按投流页盈利测算）",
    measuredLine: "测算完成：勾选 {x} 条，返回前 {y} 条（按搜索量降序）",
    importBtn: "把已勾 {n} 个词导入投放 →",
    failed: "操作失败，请稍后重试",
    billing: {
      platform: "使用平台额度·剩余 {n} 次",
      platformNoLimit: "使用平台额度",
      tenantOwn: "使用我的 DataForSEO",
      owner: "站长直通",
      denied: "付费数据未授权：请向管理员申请 paid-data 授权，或在设置里填自己的 DataForSEO",
      loading: "计费路径确认中…",
    },
  },
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
  intentGroupsTitle: "关键词意图分组（建议）",
  intentGroupsRule: "判断法：看自然搜索第一名是什么页面，就用什么页面承接。",
  intentGroupsEmpty: "计划里还没有关键词，导入或添加后这里会按意图自动分组（可人工改组）。",
  intentGroupChange: "改组",
  intentGroupLanding: "承接页",
  landingKindLabel: "承接页类型",
  landingKindUnset: "未指定",
  landingKinds: {
    homepage: "官网首页",
    product: "产品页",
    review: "评测页",
    compare: "对比页",
    guide: "攻略/内容页",
    landing: "引导页",
  },
  presetBaseNegatives: "一键预置基础否定词",
  reviewLandingNote: "评测页承接时 review 类词是核心词，已自动排除",
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
  dfs: {
    title: "Measured long-tail pipeline (DataForSEO)",
    subtitle: "Expand from real search data → filter in rounds → hand-pick → ad measurement. Paid data is spent only on expansion, intent checks for survivors, and the keywords you pick — never on words you won't run.",
    steps: {
      expand: "1. Enter a seed keyword and hit “Expand”",
      filter: "2. Set filter params and hit “Filter” (watch the counts)",
      pick: "3. Pick the keywords you want to run",
      measure: "4. Hit “Ad measurement” for estimated CPC and top-of-page bids",
      import: "5. Hit “Import to launch” to send picked keywords to launch planning",
    },
    seedLabel: "Seed keyword",
    seedPlaceholder: "e.g. robot vacuum (or pick an offer above)",
    countryLabel: "Country",
    languageLabel: "Language",
    langAuto: "Follow country",
    expandLimitLabel: "Max results per seed",
    expandLimitHint: "Recommended 100 (range 10–200; Labs bills per returned item — this is the cost valve)",
    expandBtn: "Expand",
    expanding: "Expanding…",
    expandedLine: "{n} candidates expanded",
    cachedNote: "Served from the 14-day cache — no repeat charge",
    expandCacheNote: "Expansion results are cached on the server for 14 days: re-running the same seed (same country / language / limit) is free — no repeat charge.",
    filterTitle: "Filter rounds (local filters are free; intent check only calls the API for survivors)",
    minVolumeLabel: "Min. search volume",
    minVolumeHint: "Recommended: 1000 for core terms / 100 for long-tail (a flat 1000 kills long-tail); unknown volume is never blocked",
    competitionLabel: "Max. competition",
    competitionModes: { lowPlusMedium: "Low + Medium", lowOnly: "Low only", all: "Any" },
    intentToggle: "Buying-intent filter (keep commercial / transactional only)",
    filterBtn: "Filter",
    filtering: "Filtering…",
    filterLine: "Filter: {x} → {y} passed ({k} filtered out)",
    filterStageLine: "After local filters (volume + competition): {a} → after intent filter: {b}",
    intentUnverified: "Intent unverified: DataForSEO could not confirm intent — all keywords kept (nothing dropped)",
    pickLine: "{n} picked",
    selectAll: "Select all",
    selectNone: "Clear",
    showFiltered: "Show {k} filtered out",
    hideFiltered: "Hide filtered-out keywords",
    outcomeReasons: { "out-volume": "Below min. volume", "out-competition": "Above competition limit", "out-intent": "Non-buying intent" },
    keptBadge: "Kept manually",
    ownedRiskBadge: "Likely existing user",
    modelBadge: "Model-like token",
    marksNote: "Marks are heuristics, not facts: “Model-like token” = a letter+digit combo in the word (e.g. s8, q7), usually closer to buying; “Likely existing user” = hits app / login / support type words — the searcher most likely already owns the product. Filtered-out keywords never disappear: expand the list and tick them to keep them manually.",
    thCpc: "Est. CPC",
    thBidRange: "Top-of-page bid range",
    thCompIndex: "Competition index",
    competitionLevels: { LOW: "Low", MEDIUM: "Medium", HIGH: "High" },
    intentLabels: { informational: "Informational", navigational: "Navigational", commercial: "Commercial", transactional: "Transactional" },
    emptyCandidates: "No candidates yet. Enter a seed keyword in step 1 and hit “Expand”.",
    needFilterFirst: "Hit “Filter” first, then pick keywords.",
    measureLimitLabel: "Measurement result count",
    measureLimitHint: "Recommended 10–30 (one offer's first round = 1–3 ad groups × 5–15 keywords)",
    measureBtn: "Ad measurement",
    measuring: "Measuring…",
    estimateNote: "DataForSEO estimates · for reference only — never used in bid calculation (bids still come from the launch-page profit model)",
    measuredLine: "Measured: {x} picked, top {y} returned (by search volume)",
    measureNeedPick: "Pick keywords first (measurement only pays for picked ones)",
    importBtn: "Import {n} picked keywords to launch →",
    failed: "Something failed, please try again",
    billing: {
      platform: "Platform quota · {n} left",
      platformNoLimit: "Platform quota",
      tenantOwn: "Using my DataForSEO",
      owner: "Owner direct",
      denied: "Paid data not authorized: ask an admin for a paid-data grant, or add your own DataForSEO in Settings",
      loading: "Checking billing path…",
    },
  },
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
  intentGroupsTitle: "Keyword intent groups (suggested)",
  intentGroupsRule: "Rule of thumb: see what page ranks #1 organically, and use that page type to receive the click.",
  intentGroupsEmpty: "No keywords in the plan yet. Import or add keywords and they will be grouped by intent here (you can reassign groups).",
  intentGroupChange: "Group",
  intentGroupLanding: "Landing",
  landingKindLabel: "Landing page type",
  landingKindUnset: "Not specified",
  landingKinds: {
    homepage: "Official homepage",
    product: "Product page",
    review: "Review page",
    compare: "Comparison page",
    guide: "Guide / content page",
    landing: "Landing page",
  },
  presetBaseNegatives: "Preset base negatives",
  reviewLandingNote: "With a review landing page, review-class words are core keywords and were excluded automatically",
};
