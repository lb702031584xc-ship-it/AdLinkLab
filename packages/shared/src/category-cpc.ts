/**
 * 品类 CPC 基准表（补强 #5）。
 *
 * 数值来自课程参考（讲师经验值），不是实时竞价数据：仅供选品/出价时
 * 做量级参考（例如判断某品类的点击成本大致区间），绝不能当作实时
 * CPC 或真实账户数据使用。展示侧必须同时带上来源标注常量
 * CATEGORY_CPC_SOURCE_NOTE。
 */

export interface CategoryCpcBenchmark {
  /** 稳定键（程序引用用，不随语言变化）。 */
  key: string;
  labelZh: string;
  labelEn: string;
  /** 中位 CPC（USD）。课程参考值，非实时数据。 */
  medianCpcUsd: number;
}

/** 来源标注（展示时必须与数值同屏出现）。 */
export const CATEGORY_CPC_SOURCE_NOTE =
  "课程参考值·非实时 / Course reference — not live data";

export const CATEGORY_CPC_BENCHMARKS: readonly CategoryCpcBenchmark[] = [
  {
    key: "electronics",
    labelZh: "电子",
    labelEn: "Electronics",
    medianCpcUsd: 1.01,
  },
  {
    key: "apparel",
    labelZh: "服装",
    labelEn: "Apparel",
    medianCpcUsd: 0.76,
  },
  {
    key: "saas",
    labelZh: "SaaS",
    labelEn: "SaaS",
    medianCpcUsd: 2.94,
  },
  {
    key: "finance_insurance",
    labelZh: "金融保险",
    labelEn: "Finance & Insurance",
    medianCpcUsd: 4.62,
  },
] as const;

/** 按 key 查品类 CPC 基准；未知 key → null（不编造）。 */
export function findCategoryCpc(
  key: string | null | undefined
): CategoryCpcBenchmark | null {
  if (!key) return null;
  return CATEGORY_CPC_BENCHMARKS.find((b) => b.key === key) ?? null;
}
