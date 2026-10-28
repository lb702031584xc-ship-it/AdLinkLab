/**
 * 点击对账（2026-10-28，纯函数）。
 *
 * 解决的问题：Google Ads 报了 N 次点击，联盟后台只收到 M 次。
 * 中间的差额（点击流失）是最容易被忽略、也最贵的漏洞——
 * 它不花钱，但让每一分广告费都打折。
 *
 * 判定：
 *   ≤15%  ok       正常损耗（误点、跳转、去重）
 *   ≤30%  warning  偏高，需要排查
 *   >30%  critical 结构性损耗，先修再投
 *
 * 时区检测：如果某天联盟点击数 > Google 点击数，说明两边按不同时区分桶，
 * 按天对比会失真——只应看区间总量。这不是「偷流量」，别误判。
 */
export interface DailyClicks {
  date: string;
  googleClicks: number;
  networkClicks: number;
}

export interface ClickReconcileInput {
  /** 按天数据（可选）：给了就能检测时区错位。 */
  days?: DailyClicks[];
  /** 区间总量（days 缺失时使用）。 */
  googleClicks?: number;
  networkClicks?: number;
}

export type ClickLossVerdict = "ok" | "warning" | "critical" | "unknown";

export interface ClickCause {
  cause: string;
  likelihood: "high" | "medium" | "low";
  /** 怎么验证这一条。 */
  check: string;
}

export interface ClickReconcileResult {
  googleClicks: number;
  networkClicks: number;
  /** 流失率（%）；Google 点击为 0 时为 null。 */
  lossRatePct: number | null;
  verdict: ClickLossVerdict;
  /** 是否检测到按天口径不一致（时区错位）。 */
  timezoneSuspected: boolean;
  causes: ClickCause[];
  actions: string[];
  notes: string[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

export const LOSS_OK_PCT = 15;
export const LOSS_WARNING_PCT = 30;

export function reconcileClicks(
  input: ClickReconcileInput
): ClickReconcileResult {
  const days = input.days ?? [];
  const google = days.length
    ? days.reduce((s, d) => s + num(d.googleClicks), 0)
    : num(input.googleClicks);
  const network = days.length
    ? days.reduce((s, d) => s + num(d.networkClicks), 0)
    : num(input.networkClicks);

  // 时区错位：某天联盟比 Google 还多，说明两边分桶不同。
  const timezoneSuspected = days.some(
    (d) => num(d.networkClicks) > num(d.googleClicks) && num(d.googleClicks) >= 0
  );

  const notes: string[] = [];
  if (timezoneSuspected) {
    notes.push(
      "检测到某天联盟点击多于 Google 点击：两边时区不同，按天对比会失真，只看区间总量"
    );
  }

  if (google === 0) {
    return {
      googleClicks: 0,
      networkClicks: network,
      lossRatePct: null,
      verdict: "unknown",
      timezoneSuspected,
      causes: [],
      actions: ["Google 侧没有点击数据，无法对账"],
      notes,
    };
  }

  const lossRatePct = round1(((google - network) / google) * 100);
  const verdict: ClickLossVerdict =
    lossRatePct <= LOSS_OK_PCT
      ? "ok"
      : lossRatePct <= LOSS_WARNING_PCT
        ? "warning"
        : "critical";

  const causes: ClickCause[] = [];
  if (verdict === "critical") {
    causes.push(
      {
        cause: "跳转链路失败或追踪没触发（手机最常见）",
        likelihood: "high",
        check: "手机关 WiFi 用 4G 点一次广告链接，看联盟后台点击数是否 +1",
      },
      {
        cause: "联盟侧把点击判为无效（同 IP / 代理 / 重复）",
        likelihood: "medium",
        check: "找联盟后台的「无效点击 / Invalid Clicks」报表，看过滤量",
      },
      {
        cause: "最终到达网址中间还有别的跳转，每跳都掉人",
        likelihood: "medium",
        check: "看广告的最终到达网址，是不是联盟链接本身（而不是再套一层短链）",
      }
    );
  } else if (verdict === "warning") {
    causes.push(
      {
        cause: "移动端加载慢，用户在跳转完成前离开",
        likelihood: "high",
        check: "分设备看到达率：手机 vs 电脑差多少",
      },
      {
        cause: "联盟的点击去重（同一用户重复点击只算一次）",
        likelihood: "medium",
        check: "看联盟的点击统计口径是否含重复",
      }
    );
  } else {
    causes.push({
      cause: "正常损耗：误点、点了又退、页面未完全加载",
      likelihood: "high",
      check: "无需处理",
    });
  }

  const actions = [
    "手机 4G 自测 3 次，确认联盟后台点击数 +1",
    "确认最终到达网址是联盟链接本身，中间没有多余跳转",
    `当前损耗 ${lossRatePct}%，${
      verdict === "critical"
        ? "先修链路，再谈优化出价"
        : verdict === "warning"
          ? "检查移动端加载，再继续观察"
          : "在正常范围，不用管"
    }`,
  ];

  return {
    googleClicks: google,
    networkClicks: network,
    lossRatePct,
    verdict,
    timezoneSuspected,
    causes,
    actions,
    notes,
  };
}
