/**
 * P1-23：失败分类（Web 侧纯函数，与 API apps/api/src/ai/failure.ts 同一口径）。
 *
 * classifyFailure(message) → { category, retryable, suggestedAction, backoffSeconds }
 * - network：30s；timeout：60s；rate_limit：300s；internal_error：120s；
 * - invalid_url：不可重试，退避 0。
 * 没有 content_policy 类别（条款判定由 terms verdict 覆盖）。
 */
export type FailureCategory =
  | "network"
  | "timeout"
  | "rate_limit"
  | "invalid_url"
  | "internal_error";

export interface FailureClassification {
  category: FailureCategory;
  retryable: boolean;
  suggestedAction: string;
  backoffSeconds: number;
}

const PATTERNS: Array<{
  category: FailureCategory;
  retryable: boolean;
  suggestedAction: string;
  backoffSeconds: number;
  test: RegExp;
}> = [
  {
    category: "invalid_url",
    retryable: false,
    suggestedAction: "请检查 URL 是否为合法 http(s) 地址后重试。",
    backoffSeconds: 0,
    test: /invalid\s*url|malformed|unsupported protocol|must start with https?|url parse|not a valid url/i,
  },
  {
    category: "rate_limit",
    retryable: true,
    suggestedAction: "已触发限流/配额，请等待后重试；如频繁出现请降低调用频率。",
    backoffSeconds: 300,
    test: /429|rate limit|too many requests|quota exceeded|rate_limit|temporarily blocked/i,
  },
  {
    category: "timeout",
    retryable: true,
    suggestedAction: "请求超时，请等待后重试；目标站响应慢时可改用粘贴页面文字。",
    backoffSeconds: 60,
    test: /timeout|timed out|ETIMEDOUT|aborted|abort/i,
  },
  {
    category: "network",
    retryable: true,
    suggestedAction: "网络异常，请检查网络后重试；如目标站反爬，请改用粘贴页面文字。",
    backoffSeconds: 30,
    test: /network|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|DNS|ENETUNREACH|EHOSTUNREACH/i,
  },
];

export function classifyFailure(message: unknown): FailureClassification {
  const text =
    typeof message === "string"
      ? message
      : message instanceof Error
        ? message.message
        : String(message ?? "");
  for (const p of PATTERNS) {
    if (p.test.test(text)) {
      return {
        category: p.category,
        retryable: p.retryable,
        suggestedAction: p.suggestedAction,
        backoffSeconds: p.backoffSeconds,
      };
    }
  }
  return {
    category: "internal_error",
    retryable: true,
    suggestedAction: "服务端内部错误，请稍后重试；如持续出现请查看错误报告。",
    backoffSeconds: 120,
  };
}

/** 退避秒数 → 友好文案（30s / 1min / 2min / 5min）。 */
export function formatBackoff(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}
