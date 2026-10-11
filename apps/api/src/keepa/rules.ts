/**
 * Keepa 自动筛选规则（Day5 Keepa 验证的量化版）。
 *
 * 文案规则来源：manual-guide keepa 步骤的 keepaPass / keepaFail。
 * csv 下标依据：https://keepa.com/api-docs/product-object.html
 *   0=AMAZON（亚马逊自营价）, 1=NEW（第三方最低新品价）, 3=SALES（类目排名）,
 *   17=COUNT_REVIEWS（评论数历史；文档要求带 offers 参数）。
 * Keepa 时间换算：(keepaTime + 21564000) * 60000 = Unix 毫秒。
 * 价格 -1 = 该时段无货/无报价；排名只取 >0 的值。
 */
import { ValidationError } from "@adlinklab/shared";

// ===== 阈值（对应文案规则）=====
/** kill：30 天跌幅 > 25%（文案："价格 30 天内跌幅超过 25%（利润守不住）"） */
const KILL_PRICE_DROP_30D_PCT = 25;
/** kill：90 天排名 max/min > 10 倍（文案："排名大起大落"） */
const KILL_RANK_MAX_MIN_RATIO_90D = 10;
/** kill：90 天断货 > 30 天（文案："长期断货（供应链不稳，测了也白测）"） */
const KILL_STOCKOUT_DAYS_90D = 30;
/** pass：90 天价格波动 < 15%（文案："价格曲线过去 90 天平稳，没有频繁跳水"） */
const PASS_PRICE_SWING_90D_PCT = 15;
/** pass：排名中位数 < 100（文案："类目排名长期稳定在前 100"） */
const PASS_RANK_MEDIAN_90D = 100;
/** pass：90 天评论增长 > 0（文案："评论数稳步增长（说明持续出单）"） */
const PASS_REVIEW_GROWTH_90D = 0;
/** pass：90 天断货 ≤ 7 天（文案："没有长期断货记录"） */
const PASS_MAX_STOCKOUT_DAYS_90D = 7;

/** csv 下标（官方文档）。 */
const CSV_AMAZON = 0;
const CSV_NEW = 1;
const CSV_SALES = 3;
const CSV_COUNT_REVIEWS = 17;

const KEEPA_EPOCH_OFFSET_MIN = 21564000;
const DAY_MS = 86400000;

export type KeepaVerdict = "pass" | "kill" | "unknown";

export interface KeepaMetrics {
  priceDrop30dPct: number | null;
  rankMaxMinRatio90d: number | null;
  reviewGrowth90d: number | null;
  stockoutDays90d: number | null;
}

/** 稳定 code 供前端 i18n；detail 为中文（与现有 API reason 文案惯例一致）。 */
export interface KeepaReason {
  code:
    | "price_drop"
    | "rank_swing"
    | "stockout"
    | "pass"
    | "no_data"
    | "insufficient"
    | "rate_limited"
    | "tokens_exhausted"
    | "fetch_failed";
  detail: string;
}

export interface KeepaEvaluation {
  verdict: KeepaVerdict;
  reasons: KeepaReason[];
  metrics: KeepaMetrics;
}

interface Point {
  t: number;
  v: number;
}

function decodeSeries(raw: unknown): Point[] {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const t = raw[i];
    const v = raw[i + 1];
    if (
      typeof t !== "number" ||
      typeof v !== "number" ||
      !Number.isFinite(t) ||
      !Number.isFinite(v)
    ) {
      continue;
    }
    pts.push({ t: (t + KEEPA_EPOCH_OFFSET_MIN) * 60000, v });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

/** 取时间戳 ts 处的值：ts 之前最后一个点；没有则 null。 */
function valueAt(pts: Point[], ts: number): number | null {
  let val: number | null = null;
  for (const p of pts) {
    if (p.t <= ts) val = p.v;
    else break;
  }
  return val;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function median(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 选价格序列：优先 AMAZON，无足够有效点时用 NEW 兜底。 */
function pickPriceSeries(csv: Array<number[] | null>): { pts: Point[]; label: string } {
  const amazon = decodeSeries(csv.length > CSV_AMAZON ? csv[CSV_AMAZON] : null);
  const amazonValid = amazon.filter((p) => p.v > 0);
  if (amazonValid.length >= 2) return { pts: amazon, label: "AMAZON" };
  const mkt = decodeSeries(csv.length > CSV_NEW ? csv[CSV_NEW] : null);
  return { pts: mkt, label: "NEW" };
}

export function computeKeepaMetrics(
  csv: Array<number[] | null>,
  nowMs: number = Date.now()
): KeepaMetrics {
  const { pts: pricePts } = pickPriceSeries(csv);
  const salesPts = decodeSeries(csv.length > CSV_SALES ? csv[CSV_SALES] : null).filter(
    (p) => p.v > 0
  );
  const reviewPts = decodeSeries(
    csv.length > CSV_COUNT_REVIEWS ? csv[CSV_COUNT_REVIEWS] : null
  ).filter((p) => p.v >= 0);

  // --- 30 天跌幅（只看有效价格，-1 无货点跳过） ---
  let priceDrop30dPct: number | null = null;
  {
    const w0 = nowMs - 30 * DAY_MS;
    const valid = pricePts.filter((p) => p.v > 0 && p.t >= w0 - DAY_MS);
    const start = valueAt(valid, w0) ?? (valid.length > 0 ? valid[0].v : null);
    const end = valid.length > 0 ? valid[valid.length - 1].v : null;
    if (start !== null && end !== null && start > 0) {
      priceDrop30dPct = round1(((start - end) / start) * 100);
    }
  }

  // --- 90 天排名 max/min（文档警告：csv 首维长度不固定，已做下标守卫） ---
  // 注：排名中位数由 rankMedian90d() 单独计算（pass 门用），避免重复遍历。
  let rankMaxMinRatio90d: number | null = null;
  {
    const w0 = nowMs - 90 * DAY_MS;
    const inWin = salesPts.filter((p) => p.t >= w0).map((p) => p.v);
    if (inWin.length >= 2) {
      const min = Math.min(...inWin);
      const max = Math.max(...inWin);
      if (min > 0) rankMaxMinRatio90d = round1(max / min);
    }
  }

  // --- 90 天评论增长 ---
  let reviewGrowth90d: number | null = null;
  {
    const w0 = nowMs - 90 * DAY_MS;
    const valid = reviewPts.filter((p) => p.t >= w0 - DAY_MS);
    if (valid.length >= 2) {
      const start = valueAt(valid, w0) ?? valid[0].v;
      const end = valid[valid.length - 1].v;
      reviewGrowth90d = Math.round(end - start);
    }
  }

  // --- 90 天断货天数（价格 -1 的区间累计；含窗口起点处的 -1 状态） ---
  let stockoutDays90d: number | null = null;
  {
    const w0 = nowMs - 90 * DAY_MS;
    if (pricePts.length >= 1) {
      let days = 0;
      for (let i = 0; i < pricePts.length; i++) {
        const cur = pricePts[i];
        const nextT = i + 1 < pricePts.length ? pricePts[i + 1].t : nowMs;
        if (cur.v === -1) {
          const s = Math.max(cur.t, w0);
          const e = Math.min(nextT, nowMs);
          if (e > s) days += (e - s) / DAY_MS;
        }
      }
      stockoutDays90d = round1(days);
    }
  }

  return { priceDrop30dPct, rankMaxMinRatio90d, reviewGrowth90d, stockoutDays90d };
}

export function evaluateKeepa(
  csv: Array<number[] | null> | null,
  fetchError: "rate_limited" | "tokens_exhausted" | "no_data" | "fetch_failed" | null,
  nowMs: number = Date.now()
): KeepaEvaluation {
  const unknown = (
    code: KeepaReason["code"],
    detail: string
  ): KeepaEvaluation => ({
    verdict: "unknown",
    reasons: [{ code, detail }],
    metrics: { priceDrop30dPct: null, rankMaxMinRatio90d: null, reviewGrowth90d: null, stockoutDays90d: null },
  });

  if (fetchError === "rate_limited")
    return unknown("rate_limited", "Keepa 限流（429），稍后重试");
  if (fetchError === "tokens_exhausted")
    return unknown("tokens_exhausted", "Keepa token 不足，请充值或稍后重试");
  if (fetchError === "no_data" || !csv)
    return unknown("no_data", "Keepa 无此产品数据");
  if (fetchError === "fetch_failed")
    return unknown("fetch_failed", "Keepa 请求失败（网络），稍后重试");

  const m = computeKeepaMetrics(csv, nowMs);
  const reasons: KeepaReason[] = [];

  // kill 门：任一触发即淘汰（只用非空指标，不编数）
  if (m.priceDrop30dPct !== null && m.priceDrop30dPct > KILL_PRICE_DROP_30D_PCT) {
    reasons.push({
      code: "price_drop",
      detail: `30 天跌幅 ${m.priceDrop30dPct}%（>25%，利润守不住）`,
    });
  }
  if (
    m.rankMaxMinRatio90d !== null &&
    m.rankMaxMinRatio90d > KILL_RANK_MAX_MIN_RATIO_90D
  ) {
    reasons.push({
      code: "rank_swing",
      detail: `90 天排名 max/min ${m.rankMaxMinRatio90d} 倍（>10 倍，大起大落）`,
    });
  }
  if (m.stockoutDays90d !== null && m.stockoutDays90d > KILL_STOCKOUT_DAYS_90D) {
    reasons.push({
      code: "stockout",
      detail: `90 天断货 ${m.stockoutDays90d} 天（>30 天，供应链不稳）`,
    });
  }
  if (reasons.length > 0) {
    return { verdict: "kill", reasons, metrics: m };
  }

  // pass 门：四项全部达标（任一缺数据 → unknown，不编数）
  const swing = priceSwing90d(csv, nowMs);
  const rankMed = rankMedian90d(csv, nowMs);
  if (
    swing !== null &&
    swing < PASS_PRICE_SWING_90D_PCT &&
    rankMed !== null &&
    rankMed < PASS_RANK_MEDIAN_90D &&
    m.reviewGrowth90d !== null &&
    m.reviewGrowth90d > PASS_REVIEW_GROWTH_90D &&
    m.stockoutDays90d !== null &&
    m.stockoutDays90d <= PASS_MAX_STOCKOUT_DAYS_90D
  ) {
    return {
      verdict: "pass",
      reasons: [
        {
          code: "pass",
          detail: `90 天价格波动 ${swing}%、排名中位数 ${rankMed}、评论增长 ${m.reviewGrowth90d}、断货 ${m.stockoutDays90d} 天，均达标`,
        },
      ],
      metrics: m,
    };
  }

  return {
    verdict: "unknown",
    reasons: [{ code: "insufficient", detail: "历史数据不足，无法判定（不编数）" }],
    metrics: m,
  };
}

/** 90 天价格波动 (max-min)/min*100（pass 门用）。 */
function priceSwing90d(csv: Array<number[] | null>, nowMs: number): number | null {
  const { pts } = pickPriceSeries(csv);
  const w0 = nowMs - 90 * DAY_MS;
  const vals = pts.filter((p) => p.v > 0 && p.t >= w0).map((p) => p.v);
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  if (min <= 0) return null;
  return round1(((Math.max(...vals) - min) / min) * 100);
}

/** 90 天排名中位数（pass 门用）。 */
function rankMedian90d(csv: Array<number[] | null>, nowMs: number): number | null {
  const pts = decodeSeries(csv.length > CSV_SALES ? csv[CSV_SALES] : null).filter(
    (p) => p.v > 0
  );
  const w0 = nowMs - 90 * DAY_MS;
  const vals = pts.filter((p) => p.t >= w0).map((p) => p.v);
  if (vals.length < 2) return null;
  const med = median(vals);
  return med === null ? null : round1(med);
}

/* ============================================================
 * 手动输入数字判定（"AI 看图"弹窗的手动模式）。
 * 用户对着 Keepa 图抄几个关键数字，映射成与 evaluateKeepa 相同的
 * verdict 结构。断货天数手动无法得知，该项恒为 unknown（不参与判定）。
 * ============================================================ */

export interface ManualNumbersInput {
  amazonPriceNow: number;
  amazonPrice30dAgo: number;
  priceLow90d: number;
  priceHigh90d: number;
  /** 可选；Keepa 排名历史是付费功能，不填则排名相关规则记 unknown，不参与判定 */
  rankNow: number | null;
  rankBest90d: number | null;
  rankWorst90d: number | null;
  reviewsNow: number;
  /** 可选；不填则评论增长记 unknown，不参与 pass 判定 */
  reviews90dAgo: number | null;
}

export interface ManualMetrics {
  priceDrop30dPct: number | null;
  priceVolatility90dPct: number | null;
  rankRatio90d: number | null;
  reviewGrowth90d: number | null;
}

export interface ManualEvaluation {
  verdict: KeepaVerdict;
  reasons: KeepaReason[];
  metrics: ManualMetrics;
}

const MANUAL_REQUIRED_FIELDS = [
  "amazonPriceNow",
  "amazonPrice30dAgo",
  "priceLow90d",
  "priceHigh90d",
  "reviewsNow",
] as const;

const MANUAL_FIELD_LABELS: Record<string, string> = {
  amazonPriceNow: "当前 Amazon 价格",
  amazonPrice30dAgo: "30 天前 Amazon 价格",
  priceLow90d: "90 天内最低价",
  priceHigh90d: "90 天内最高价",
  rankNow: "当前 Sales Rank",
  rankBest90d: "90 天内最好排名",
  rankWorst90d: "90 天内最差排名",
  reviewsNow: "当前评论数",
  reviews90dAgo: "90 天前评论数",
};

function asNonNegNumber(v: unknown, label: string): number {
  // 兼容中文输入法全角数字（１９９．５ → 199.5）
  const normalized =
    typeof v === "string"
      ? v.replace(/[０-９．。]/g, (ch) =>
          ch === "．" || ch === "。" ? "." : String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
        )
      : v;
  const n =
    typeof normalized === "number"
      ? normalized
      : typeof normalized === "string" && normalized.trim() !== ""
        ? Number(normalized)
        : NaN;
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${label}：请输入有效数字（≥0）`);
  }
  return n;
}

/** 校验并解析手动输入；非法直接抛 ValidationError（路由转 400）。 */
export function parseManualNumbers(body: unknown): ManualNumbersInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("请求体格式错误");
  }
  const b = body as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const f of MANUAL_REQUIRED_FIELDS) {
    out[f] = asNonNegNumber(b[f], MANUAL_FIELD_LABELS[f]);
  }
  let reviews90dAgo: number | null = null;
  const rawOpt = b["reviews90dAgo"];
  if (rawOpt !== undefined && rawOpt !== null && String(rawOpt).trim() !== "") {
    reviews90dAgo = asNonNegNumber(rawOpt, MANUAL_FIELD_LABELS["reviews90dAgo"]);
  }
  // 排名三项可选（Keepa 排名历史需付费）：要么三项都填，要么都空；填一半 → 400
  const rankFields = ["rankNow", "rankBest90d", "rankWorst90d"] as const;
  const rankVals = rankFields.map((f) => {
    const v = b[f];
    return v === undefined || v === null || String(v).trim() === ""
      ? null
      : asNonNegNumber(v, MANUAL_FIELD_LABELS[f]);
  });
  const rankFilled = rankVals.filter((v) => v !== null).length;
  if (rankFilled > 0 && rankFilled < 3) {
    throw new ValidationError("排名三个框要么都填，要么都空（Keepa 排名历史需付费，可空着）");
  }
  if (out["priceLow90d"] > out["priceHigh90d"]) {
    throw new ValidationError("最低价不能高于最高价");
  }
  return {
    amazonPriceNow: out["amazonPriceNow"],
    amazonPrice30dAgo: out["amazonPrice30dAgo"],
    priceLow90d: out["priceLow90d"],
    priceHigh90d: out["priceHigh90d"],
    rankNow: rankVals[0],
    rankBest90d: rankVals[1],
    rankWorst90d: rankVals[2],
    reviewsNow: out["reviewsNow"],
    reviews90dAgo,
  };
}

/**
 * 手动数字映射判定。阈值与 evaluateKeepa 完全一致：
 * kill = 30 天跌幅>25% 或（有排名数据时）排名最差/最好>10 倍；
 * pass = 90 天价格波动<15% 且（有排名数据时）最差排名<100 且（填了 90 天前评论数时）评论增长>0；
 * 两头不靠 → unknown。断货手动无法得知，不参与判定。
 * 排名历史是 Keepa 付费功能，缺失时相关规则记 unknown，不硬判。
 */
export function evaluateManualNumbers(input: ManualNumbersInput): ManualEvaluation {
  const hasRank =
    input.rankNow !== null && input.rankBest90d !== null && input.rankWorst90d !== null;
  const m: ManualMetrics = {
    priceDrop30dPct:
      input.amazonPrice30dAgo > 0
        ? round1(((input.amazonPrice30dAgo - input.amazonPriceNow) / input.amazonPrice30dAgo) * 100)
        : null,
    priceVolatility90dPct:
      input.priceHigh90d + input.priceLow90d > 0
        ? round1(
            ((input.priceHigh90d - input.priceLow90d) /
              ((input.priceHigh90d + input.priceLow90d) / 2)) *
              100
          )
        : null,
    rankRatio90d:
      hasRank && input.rankBest90d! > 0 ? round1(input.rankWorst90d! / input.rankBest90d!) : null,
    reviewGrowth90d:
      input.reviews90dAgo !== null ? Math.round(input.reviewsNow - input.reviews90dAgo) : null,
  };

  const reasons: KeepaReason[] = [];
  if (m.priceDrop30dPct !== null && m.priceDrop30dPct > KILL_PRICE_DROP_30D_PCT) {
    reasons.push({
      code: "price_drop",
      detail: `30 天跌幅 ${m.priceDrop30dPct}%（>25%，利润守不住）`,
    });
  }
  if (m.rankRatio90d !== null && m.rankRatio90d > KILL_RANK_MAX_MIN_RATIO_90D) {
    reasons.push({
      code: "rank_swing",
      detail: `90 天排名最差/最好 ${m.rankRatio90d} 倍（>10 倍，大起大落）`,
    });
  }
  if (reasons.length > 0) {
    return { verdict: "kill", reasons, metrics: m };
  }

  const rankOk = !hasRank || input.rankWorst90d! < PASS_RANK_MEDIAN_90D;
  const reviewOk = m.reviewGrowth90d === null || m.reviewGrowth90d > PASS_REVIEW_GROWTH_90D;
  if (
    m.priceVolatility90dPct !== null &&
    m.priceVolatility90dPct < PASS_PRICE_SWING_90D_PCT &&
    rankOk &&
    reviewOk
  ) {
    const parts = [`90 天价格波动 ${m.priceVolatility90dPct}%`];
    if (hasRank) parts.push(`最差排名 ${input.rankWorst90d}`);
    else parts.push(`排名数据缺失（Keepa 付费功能），未参与判定`);
    if (m.reviewGrowth90d !== null) parts.push(`评论增长 ${m.reviewGrowth90d}`);
    return {
      verdict: "pass",
      reasons: [
        {
          code: "pass",
          detail: `${parts.join("、")}，均达标（断货情况手动无法得知，未计入）`,
        },
      ],
      metrics: m,
    };
  }

  const missing: string[] = [];
  if (!hasRank) missing.push("排名数据缺失（Keepa 付费功能）");
  if (m.reviewGrowth90d === null) missing.push("90 天前评论数未填");
  return {
    verdict: "unknown",
    reasons: [
      {
        code: "insufficient",
        detail: `介于通过与淘汰之间，建议人工复核${
          missing.length > 0 ? `（${missing.join("；")}）` : "（断货情况手动无法得知）"
        }`,
      },
    ],
    metrics: m,
  };
}
