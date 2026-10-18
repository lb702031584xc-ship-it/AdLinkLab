export interface AmazonDiscoveryDict {
  title: string;
  description: string;
  noCredentials: string;
  criteriaTitle: string;
  keywordsLabel: string;
  keywordsPlaceholder: string;
  keywordsHint: string;
  priceRangeLabel: string;
  minRatingLabel: string;
  minReviewsLabel: string;
  opportunityTitle: string;
  opportunityDesc: string;
  opportunityMinReviewsLabel: string;
  opportunityRatingRangeLabel: string;
  opportunityBadge: string;
  opportunityNote: string;
  watch: string;
  watching: string;
  watched: string;
  regionLabel: string;
  discover: string;
  discovering: string;
  resultsTitle: string;
  scoreLabel: string;
  commissionLabel: string;
  import: string;
  importSelected: string;
  importing: string;
  imported: string;
  historyTitle: string;
  totalFound: string;
  totalKept: string;
  paidTrafficWarningTitle: string;
  paidTrafficWarningBody: string;
  brandLabel: string;
  trafficGateTitle: string;
  officialSiteFoundLabel: string;
  officialSiteNone: string;
  gatePassed: string;
  gateFailed: string;
  gateNoData: string;
  thresholdLabel: string;
  signalCaption: string;
  manualTitle: string;
  manualBrandPlaceholder: string;
  manualVisitsPlaceholder: string;
  manualHint: string;
  recheck: string;
  rechecking: string;
  manualInvalid: string;
  thresholdsTitle: string;
  thresholdsHint: string;
  officialSiteVisitsLabel: string;
  brandInterestLabel: string;
  keywordInterestLabel: string;
  saveThresholds: string;
  savingThresholds: string;
  thresholdsSaved: string;
  thresholdsSaveFailed: string;
  expand: string;
  collapse: string;
  sendToPipeline: string;
  tabDiscovery: string;
  tabTrends: string;
  tabWatch: string;
}

export const zh: AmazonDiscoveryDict = {
  title: "Amazon 自动选品",
  description:
    "配置选品条件，系统通过 Amazon PA-API 抓取产品，按评分算法推荐高潜力 Offer，一键导入投放流程。",
  noCredentials:
    "未配置 Amazon PA-API 凭证。请先在 AI 设置中配置 amazon_paapi_key（格式：AccessKey|SecretKey|PartnerTag|Region），或设置环境变量 AMAZON_PAAPI_KEY。",
  criteriaTitle: "选品条件",
  keywordsLabel: "关键词（每行一个，最多 10 个）",
  keywordsPlaceholder: "wireless earbuds\nmechanical keyboard",
  keywordsHint: "每个关键词会单独搜索一次，结果合并去重。",
  priceRangeLabel: "价格区间（USD）",
  minRatingLabel: "最低评分",
  minReviewsLabel: "最低评论数",
  opportunityTitle: "机会品模式",
  opportunityDesc: "筛出评论数多但评分偏低的产品（高需求 + 低满意度），适合推高口碑替代品。",
  opportunityMinReviewsLabel: "最低评论数（机会品）",
  opportunityRatingRangeLabel: "评分区间（机会品）",
  opportunityBadge: "高需求 + 低满意度",
  opportunityNote:
    "评分被拉低，适合推高口碑替代品。此为基于评分分布的推断，未读取评论原文。", 
  watch: "跟踪",
  watching: "跟踪中…",
  watched: "已跟踪",
  regionLabel: "站点",
  discover: "开始选品",
  discovering: "抓取中…",
  resultsTitle: "推荐产品",
  scoreLabel: "评分",
  commissionLabel: "预估佣金",
  import: "导入为 Offer",
  importSelected: "导入选中",
  importing: "导入中…",
  imported: "导入成功",
  historyTitle: "历史选品",
  totalFound: "抓取到",
  totalKept: "推荐",
  paidTrafficWarningTitle: "⚠️ 付费流量不计佣金",
  paidTrafficWarningBody:
    "Amazon Associates 协议（2026 年 4 月更新）：来自付费广告（包括 Google Ads）的流量不计佣金。用 Google Ads 直链 Amazon 商品页 = 广告费白花、佣金为零。正确做法：先把流量引到自己的内容落地页（评测 / 对比文章），再从落地页链到 Amazon。",
  brandLabel: "品牌",
  trafficGateTitle: "流量门",
  officialSiteFoundLabel: "有官网",
  officialSiteNone: "无官网",
  gatePassed: "通过",
  gateFailed: "不通过",
  gateNoData: "暂无数据",
  thresholdLabel: "阈值",
  signalCaption:
    "数据口径：Google Trends = 热度（0-100 相对值，免费）· SimilarWeb = 月访问量（付费 key）· DataForSEO = 月搜索量（付费 key）",
  manualTitle: "手动输入流量值",
  manualBrandPlaceholder: "品牌名（可选），如：Anker；亚马逊商品页可填品牌名查品牌官网",
  manualVisitsPlaceholder: "手动输入月访问量（可选），如：80000（正整数）",
  manualHint:
    "数字来源建议去 SimilarWeb 免费版查该品牌官网；这是你手动提供的值，只对比“官网月访问量”阈值这一档，绝不记作实测流量。",
  recheck: "用该值重判",
  rechecking: "重判中…",
  manualInvalid: "请至少填写品牌名或有效的手动月访问量（正整数，≤ 1e12）。",
  thresholdsTitle: "流量门阈值",
  thresholdsHint:
    "免费自动：Google Trends 热度、官网检测；付费 key：SimilarWeb 月访问量、DataForSEO 月搜索量，在“系统设置 → AI 设置”中配置。",
  officialSiteVisitsLabel: "官网月访问量阈值",
  brandInterestLabel: "品牌热度阈值（0-100 相对值）",
  keywordInterestLabel: "关键词热度阈值（0-100 相对值）",
  saveThresholds: "保存阈值",
  savingThresholds: "保存中…",
  thresholdsSaved: "阈值已保存。",
  thresholdsSaveFailed: "保存失败，请检查输入后重试。",
  expand: "展开",
  collapse: "收起",
  sendToPipeline: "送入流水线",
  tabDiscovery: "选品",
  tabTrends: "趋势",
  tabWatch: "监控",
};

export const en: AmazonDiscoveryDict = {
  title: "Amazon Product Discovery",
  description:
    "Configure criteria, fetch products via Amazon PA-API, get scored recommendations, and import as offers in one click.",
  noCredentials:
    "Amazon PA-API credentials not configured. Set amazon_paapi_key in AI settings (format: AccessKey|SecretKey|PartnerTag|Region) or the AMAZON_PAAPI_KEY env var.",
  criteriaTitle: "Discovery Criteria",
  keywordsLabel: "Keywords (one per line, max 10)",
  keywordsPlaceholder: "wireless earbuds\nmechanical keyboard",
  keywordsHint: "Each keyword is searched separately; results are merged and deduped.",
  priceRangeLabel: "Price range (USD)",
  minRatingLabel: "Min rating",
  minReviewsLabel: "Min reviews",
  opportunityTitle: "Opportunity mode",
  opportunityDesc: "Find products with many reviews but below-average ratings (high demand + low satisfaction) — ideal for a better-rated alternative.",
  opportunityMinReviewsLabel: "Min reviews (opportunity)",
  opportunityRatingRangeLabel: "Rating range (opportunity)",
  opportunityBadge: "High demand + low satisfaction",
  opportunityNote:
    "Ratings are dragged down — a higher-quality alternative can win. This is an inference from the rating distribution, not a reading of actual reviews.", 
  watch: "Track",
  watching: "Tracking…",
  watched: "Tracked",
  regionLabel: "Marketplace",
  discover: "Start Discovery",
  discovering: "Fetching…",
  resultsTitle: "Recommended Products",
  scoreLabel: "Score",
  commissionLabel: "Est. commission",
  import: "Import as Offer",
  importSelected: "Import selected",
  importing: "Importing…",
  imported: "Imported",
  historyTitle: "Discovery History",
  totalFound: "Found",
  totalKept: "Recommended",
  paidTrafficWarningTitle: "⚠️ Paid traffic earns no commission",
  paidTrafficWarningBody:
    "Per the Amazon Associates agreement (April 2026 update), traffic from paid ads (including Google Ads) is disqualified from commissions. Direct-linking Google Ads to Amazon product pages means paying for clicks and earning zero. The compliant path: send traffic to your own content landing page (review / comparison article) first, then link out to Amazon.",
  brandLabel: "Brand",
  trafficGateTitle: "Traffic gate",
  officialSiteFoundLabel: "Official site",
  officialSiteNone: "No official site",
  gatePassed: "Passed",
  gateFailed: "Failed",
  gateNoData: "No data",
  thresholdLabel: "Threshold",
  signalCaption:
    "Data sources: Google Trends = interest (0–100 relative, free) · SimilarWeb = monthly visits (paid key) · DataForSEO = monthly search volume (paid key)",
  manualTitle: "Enter traffic manually",
  manualBrandPlaceholder: "Brand name (optional), e.g. Anker — detects the brand's official site",
  manualVisitsPlaceholder: "Manual monthly visits (optional), e.g. 80000 (positive integer)",
  manualHint:
    "Suggestion: look up the brand's official site on the free SimilarWeb plan. This is a value you provide manually; it is only compared against the official-site monthly-visits threshold and is never presented as measured traffic.",
  recheck: "Re-evaluate with this value",
  rechecking: "Re-evaluating…",
  manualInvalid: "Please fill in a brand name or a valid manual monthly-visit number (positive integer, ≤ 1e12).",
  thresholdsTitle: "Traffic gate thresholds",
  thresholdsHint:
    "Free & automatic: Google Trends interest, official-site detection; paid keys: SimilarWeb monthly visits, DataForSEO monthly search volume — configure under Settings → AI settings.",
  officialSiteVisitsLabel: "Official-site monthly visits threshold",
  brandInterestLabel: "Brand interest threshold (0–100 relative)",
  keywordInterestLabel: "Keyword interest threshold (0–100 relative)",
  saveThresholds: "Save thresholds",
  savingThresholds: "Saving…",
  thresholdsSaved: "Thresholds saved.",
  thresholdsSaveFailed: "Save failed, please check your input and retry.",
  expand: "Expand",
  collapse: "Collapse",
  sendToPipeline: "Send to pipeline",
  tabDiscovery: "Discovery",
  tabTrends: "Trends",
  tabWatch: "Watch",
};
