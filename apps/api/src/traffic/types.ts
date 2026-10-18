/**
 * 流量需求门（Traffic Gate）—— 数据源层类型契约。
 *
 * 数据源现实（已核实，不许编造数据）：
 * - 官网检测：DuckDuckGo HTML 搜索全自动（免费、无需 key）→ 域名提取 →
 *   平台/社媒过滤 → 品牌匹配 → 首页抓取验证。
 * - 品牌/关键词相对热度：Google Trends 免费、无需 key；返回 0-100 相对值，
 *   绝不是访问量/搜索量，展示时必须注明"免费相对值"。
 * - 官网绝对流量：SimilarWeb Official API v1（付费 key，用户自备）。
 * - 关键词绝对搜索量：DataForSEO Labs（付费 login/password，用户自备）。
 *
 * 三态语义：TrafficSignal.passed / TrafficGateResult.passed 为 null 表示
 * unknown（暂无数据），绝不直接判 fail。
 */

/** 信号数据源：免费（trends）/ 付费（similarweb、dataforseo）/ 用户手动输入（manual） */
export type TrafficSignalSource = "trends" | "similarweb" | "dataforseo" | "manual";

/** 单个流量信号 */
export interface TrafficSignal {
  source: TrafficSignalSource;
  /**
   * 展示用标签，必须说明数据来源是免费还是付费、以及指标口径，
   * 例如"品牌搜索热度（Google Trends 免费相对值，非访问量）"。
   */
  label: string;
  /** 信号值；null 表示暂无数据 */
  value: number | null;
  /** 判定阈值；null 表示只展示、不参与判定 */
  threshold: number | null;
  /** true=通过，false=未通过，null=unknown（暂无数据） */
  passed: boolean | null;
  note?: string;
}

/** 官网检测结果 */
export interface OfficialSiteInfo {
  found: boolean;
  domain: string | null;
  confidence: "high" | "medium" | "low";
  /**
   * 补充说明（可选）：例如"链接是电商平台，平台域名不视为品牌官网"。
   * found=false 时解释原因，UI 可直接展示。
   */
  reason?: string;
}

/** 流量门评估结果 */
export interface TrafficGateResult {
  /** true=通过，false=未通过，null=unknown（暂无数据，不直接判 fail） */
  passed: boolean | null;
  /** 判定说明：必须写清数据来源是免费还是付费 */
  reason: string;
  officialSite: OfficialSiteInfo | null;
  signals: TrafficSignal[];
  /**
   * 警告（非否决）：有数据支撑的 caution 档说明，null 表示无警告。
   * 例如付费流量极少（>0 但 < 自然流量 × paidTrafficWarnRatio）→
   * 谨慎测试、小预算验证。caution 不改变 passed（不 kill）。
   */
  caution: string | null;
}

/** 流量门阈值（AiSetting `traffic.thresholds` 明文 JSON 存储） */
export interface TrafficThresholds {
  /** 官网月访问量阈值（SimilarWeb 付费数据） */
  officialSiteMonthlyVisits: number;
  /** 品牌搜索热度阈值（Google Trends 免费 0-100 相对值） */
  brandInterest: number;
  /** 核心关键词热度阈值（Google Trends 免费 0-100 相对值） */
  keywordInterest: number;
  /**
   * 自然流量门槛（SEMrush 域名概览"自然流量"，用户手动输入）。
   * 付费为零规则用：自然流量 >= 该值 且 付费流量 == 0 → 流量门直接判 fail
   * （同行已验证付费跑不正）。默认 1000。
   */
  organicTrafficMin: number;
  /**
   * 付费流量预警比例（0,1）：自然流量达标时，
   * 0 < 付费流量 < 自然流量 × 该比例 → caution 档（不 kill），
   * reason 提示"付费流量极少，谨慎测试、小预算验证"。默认 0.05。
   */
  paidTrafficWarnRatio: number;
}

export const DEFAULT_TRAFFIC_THRESHOLDS: TrafficThresholds = {
  officialSiteMonthlyVisits: 50000,
  brandInterest: 25,
  keywordInterest: 25,
  organicTrafficMin: 1000,
  paidTrafficWarnRatio: 0.05,
};

/**
 * 付费数据源 provider 契约。
 *
 * - getMonthlyVisits：域名月访问量（SimilarWeb）；无 key / 失败 → null。
 * - getKeywordVolume：关键词月均搜索量（DataForSEO）；无 key / 失败 → 逐项 null。
 */
export interface TrafficProvider {
  readonly name: "similarweb" | "dataforseo";
  getMonthlyVisits(domain: string): Promise<number | null>;
  getKeywordVolume(
    keywords: string[]
  ): Promise<Array<{ keyword: string; volume: number | null }>>;
}
