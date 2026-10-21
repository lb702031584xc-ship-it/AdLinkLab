/**
 * 商品级测试优先分单测：
 * - 初筛腿：screenVerdict（pass/review/kill/无记录）→ Offer 语义映射与计分
 * - 广告腿：分档、长尾地板、疑似停投封顶（与 offer-priority 同构）
 * - 佣金腿：estimateCommissionFigure 口径（金额优先 / 费率换算 / 未知中性）
 * - 同构对照：同一物理商品经商品路径与 Offer 路径算出的 score/reasons 完全一致
 * - catalogPriorityInputFromRow：Decimal/字符串/垃圾值的归一
 */
import { describe, expect, it } from "vitest";
import { computeTestPriority } from "./offer-priority.js";
import {
  catalogPriorityInputFromRow,
  catalogScreenVerdictToPrescreen,
  computeCatalogTestPriority,
  type CatalogPriorityInput,
} from "./catalog-priority.js";

/** 广告未计算（12）+ 佣金未知（8）的中性基线，便于单腿验算。 */
const neutral: CatalogPriorityInput = {
  screenVerdict: null,
  price: null,
  commissionAmount: null,
  commissionRate: null,
  adCount: null,
  adCountLongtail: null,
  lastAdCount: null,
};

describe("初筛腿：screenVerdict 映射与计分", () => {
  it("映射：pass→go / review→caution / kill→stop / 其余→null", () => {
    expect(catalogScreenVerdictToPrescreen("pass")).toBe("go");
    expect(catalogScreenVerdictToPrescreen("review")).toBe("caution");
    expect(catalogScreenVerdictToPrescreen("kill")).toBe("stop");
    expect(catalogScreenVerdictToPrescreen(null)).toBeNull();
    expect(catalogScreenVerdictToPrescreen(undefined)).toBeNull();
    expect(catalogScreenVerdictToPrescreen("weird")).toBeNull();
  });

  it("计分：pass=30 / review=18 / kill=0 / 无记录=5（+广告 12 +佣金 8）", () => {
    expect(computeCatalogTestPriority({ ...neutral, screenVerdict: "pass" }).score).toBe(30 + 12 + 8);
    expect(computeCatalogTestPriority({ ...neutral, screenVerdict: "review" }).score).toBe(18 + 12 + 8);
    expect(computeCatalogTestPriority({ ...neutral, screenVerdict: "kill" }).score).toBe(0 + 12 + 8);
    expect(computeCatalogTestPriority({ ...neutral }).score).toBe(5 + 12 + 8);
    expect(computeCatalogTestPriority({ ...neutral, screenVerdict: "pass" }).reasons).toContain("初筛通过");
    expect(computeCatalogTestPriority({ ...neutral, screenVerdict: "review" }).reasons).toContain("初筛谨慎");
    expect(computeCatalogTestPriority({ ...neutral, screenVerdict: "kill" }).reasons).toContain("初筛不建议投放");
    expect(computeCatalogTestPriority({ ...neutral }).reasons).toContain("未做初筛");
  });
});

describe("广告腿：分档 / 长尾地板 / 趋势", () => {
  it("分档：sweet=40 / small=30 / hot=28 / redocean=14 / none=4 / 未计算=12", () => {
    const base = { ...neutral, screenVerdict: "pass" as const }; // 初筛 30 + 佣金 8
    expect(computeCatalogTestPriority({ ...base, adCount: 10 }).score).toBe(30 + 40 + 8);
    expect(computeCatalogTestPriority({ ...base, adCount: 3 }).score).toBe(30 + 30 + 8);
    expect(computeCatalogTestPriority({ ...base, adCount: 30 }).score).toBe(30 + 28 + 8);
    expect(computeCatalogTestPriority({ ...base, adCount: 60 }).score).toBe(30 + 14 + 8);
    expect(computeCatalogTestPriority({ ...base, adCount: 0 }).score).toBe(30 + 4 + 8);
    expect(computeCatalogTestPriority({ ...base, adCount: null }).score).toBe(30 + 12 + 8);
    expect(computeCatalogTestPriority({ ...base, adCount: null }).reasons).toContain("广告数未计算");
  });

  it("长尾地板：裸词 0 / 未算但长尾 ≥1 → 按 small（30）计", () => {
    const base = { ...neutral, screenVerdict: "pass" as const };
    expect(
      computeCatalogTestPriority({ ...base, adCount: 0, adCountLongtail: 3 }).score
    ).toBe(30 + 30 + 8);
    expect(
      computeCatalogTestPriority({ ...base, adCount: null, adCountLongtail: 2 }).score
    ).toBe(30 + 30 + 8);
    // 长尾也是 0 → 不抬地板，仍按 none 计。
    expect(
      computeCatalogTestPriority({ ...base, adCount: 0, adCountLongtail: 0 }).score
    ).toBe(30 + 4 + 8);
  });

  it("疑似停投封顶 4（上次 >0、本次 0），文案替换为「疑似停投」", () => {
    const r = computeCatalogTestPriority({
      ...neutral,
      screenVerdict: "pass",
      commissionAmount: 60,
      adCount: 0,
      lastAdCount: 5,
    });
    expect(r.score).toBe(30 + 4 + 30);
    expect(r.reasons).toContain("疑似停投");
    expect(r.reasons).not.toContain("暂无广告在投");
  });

  it("趋势加分：new +3 / active +2", () => {
    const base = { ...neutral, screenVerdict: "pass" as const };
    // adCount=5 → small 30；上次 0 → new +3。
    expect(computeCatalogTestPriority({ ...base, adCount: 5, lastAdCount: 0 }).score).toBe(30 + 33 + 8);
    // 上次 3 → active +2。
    expect(computeCatalogTestPriority({ ...base, adCount: 5, lastAdCount: 3 }).score).toBe(30 + 32 + 8);
  });
});

describe("佣金腿：estimateCommissionFigure 口径进同一分档", () => {
  it("金额优先：有 amount 时不看费率", () => {
    const r = computeCatalogTestPriority({
      ...neutral,
      screenVerdict: "pass",
      price: 1000,
      commissionAmount: 10,
      commissionRate: 90,
    });
    // figure=10 → 佣金腿 16（若误用费率会是 900 → 30，分数会更高）。
    expect(r.score).toBe(30 + 12 + 16);
    expect(r.reasons).toContain("单笔佣金 $10.00");
  });

  it("只有费率：价格×费率÷100 换算（1209.9 × 10% = 120.99 → 30 分档）", () => {
    const r = computeCatalogTestPriority({
      ...neutral,
      screenVerdict: "pass",
      price: 1209.9,
      commissionAmount: null,
      commissionRate: 10,
    });
    expect(r.score).toBe(30 + 12 + 30);
    expect(r.reasons).toContain("单笔佣金 $120.99");
  });

  it("分档边界：≥50→30 / ≥25→24 / ≥8→16 / >0→8 / 0→0", () => {
    const base = { ...neutral, screenVerdict: "pass" as const }; // 初筛 30 + 广告 12
    expect(computeCatalogTestPriority({ ...base, commissionAmount: 50 }).score).toBe(30 + 12 + 30);
    expect(computeCatalogTestPriority({ ...base, commissionAmount: 25 }).score).toBe(30 + 12 + 24);
    expect(computeCatalogTestPriority({ ...base, commissionAmount: 8 }).score).toBe(30 + 12 + 16);
    expect(computeCatalogTestPriority({ ...base, commissionAmount: 0.5 }).score).toBe(30 + 12 + 8);
  });

  it("未知 → 中性 8（费率脏数据 >100% 也按未知）", () => {
    const unknown = computeCatalogTestPriority({ ...neutral, screenVerdict: "pass" });
    expect(unknown.score).toBe(30 + 12 + 8);
    expect(unknown.reasons).toContain("佣金未知");
    const dirty = computeCatalogTestPriority({
      ...neutral,
      screenVerdict: "pass",
      price: 100,
      commissionRate: 150,
    });
    expect(dirty.score).toBe(30 + 12 + 8);
    expect(dirty.reasons).toContain("佣金未知");
  });
});

describe("与 offer-priority 同构对照（同输入同分同理由）", () => {
  it("费率型商品：商品路径 vs Offer 路径（go + 116.87 + sweet）", () => {
    const fromProduct = computeCatalogTestPriority({
      screenVerdict: "pass",
      price: 899,
      commissionAmount: null,
      commissionRate: 13,
      adCount: 10,
      adCountLongtail: null,
      lastAdCount: null,
    });
    const fromOffer = computeTestPriority({
      prescreenVerdict: "go",
      commissionPerSaleUsd: 116.87,
      adCount: 10,
      adCountLongtail: null,
      lastAdCount: null,
      hasProductLink: true,
    });
    expect(fromProduct.score).toBe(100);
    expect(fromProduct.score).toBe(fromOffer.score);
    expect(fromProduct.reasons).toEqual(fromOffer.reasons);
  });

  it("停投商品：商品路径 vs Offer 路径（caution + 金额佣金 + stopped）", () => {
    const fromProduct = computeCatalogTestPriority({
      screenVerdict: "review",
      price: 80,
      commissionAmount: 20,
      commissionRate: null,
      adCount: 0,
      adCountLongtail: 0,
      lastAdCount: 6,
    });
    const fromOffer = computeTestPriority({
      prescreenVerdict: "caution",
      commissionPerSaleUsd: 20,
      adCount: 0,
      adCountLongtail: 0,
      lastAdCount: 6,
      hasProductLink: true,
    });
    expect(fromProduct.score).toBe(18 + 4 + 16);
    expect(fromProduct.score).toBe(fromOffer.score);
    expect(fromProduct.reasons).toEqual(fromOffer.reasons);
  });

  it("未筛 + 广告未算 + 佣金未知：两边都是中性组合 5+12+8", () => {
    const fromProduct = computeCatalogTestPriority({ ...neutral });
    const fromOffer = computeTestPriority({
      prescreenVerdict: null,
      commissionPerSaleUsd: null,
      adCount: null,
      lastAdCount: null,
      hasProductLink: true,
    });
    expect(fromProduct.score).toBe(25);
    expect(fromProduct.score).toBe(fromOffer.score);
    expect(fromProduct.reasons).toEqual(fromOffer.reasons);
  });
});

describe("catalogPriorityInputFromRow 归一", () => {
  it("Decimal 形态 / 字符串数字 / 垃圾值", () => {
    const input = catalogPriorityInputFromRow({
      screenVerdict: "pass",
      price: { toNumber: () => 42.5 },
      commissionAmount: "13.5",
      commissionRate: 10,
      adCount: 7,
      adCountLongtail: "x",
      lastAdCount: undefined,
    });
    expect(input.screenVerdict).toBe("pass");
    expect(input.price).toBe(42.5);
    expect(input.commissionAmount).toBe(13.5);
    expect(input.commissionRate).toBe(10);
    expect(input.adCount).toBe(7);
    expect(input.adCountLongtail).toBeNull();
    expect(input.lastAdCount).toBeNull();
  });
});
