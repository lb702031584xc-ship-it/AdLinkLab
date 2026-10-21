/**
 * OfferTestPriorityCell 渲染 + 测试优先分 dict 新键：
 * - 分数醒目、第一条理由小字、全部理由进 title
 * - 「先测」徽标仅在 rank ≤ 5 时出现（rank 缺失/>5 不显示）
 * - 无 testPriority 时显示 —
 * - dict 新键 zh/en 均存在且为纯字符串（不许放函数）
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfferTestPriorityCell } from "@/components/offers/offer-test-priority-cell";
import { getDictionary } from "@/i18n/dictionaries";

const dict = { testFirst: "先测" };
const priority = {
  score: 87,
  reasons: ["广告稳定投放（甜蜜点）", "初筛通过", "单笔佣金 $60.00"],
};

function render(props: Parameters<typeof OfferTestPriorityCell>[0]): string {
  return renderToStaticMarkup(createElement(OfferTestPriorityCell, props));
}

describe("OfferTestPriorityCell", () => {
  it("渲染分数、第一条理由，全部理由进 title", () => {
    const html = render({ priority, dict });
    expect(html).toContain("87");
    expect(html).toContain("广告稳定投放（甜蜜点）");
    expect(html).toContain('title="广告稳定投放（甜蜜点）；初筛通过；单笔佣金 $60.00"');
  });

  it("rank ≤ 5 显示「先测」徽标；rank > 5 或未传不显示", () => {
    expect(render({ priority, rank: 1, dict })).toContain("先测");
    expect(render({ priority, rank: 5, dict })).toContain("先测");
    expect(render({ priority, rank: 6, dict })).not.toContain("先测");
    expect(render({ priority, rank: null, dict })).not.toContain("先测");
    expect(render({ priority, dict })).not.toContain("先测");
  });

  it("无 testPriority → 显示 —", () => {
    expect(render({ priority: null, dict })).toContain("—");
    expect(render({ priority: undefined, dict })).toContain("—");
  });
});

describe("dict 测试优先分新键", () => {
  it("zh/en 均有新键且为纯字符串", () => {
    for (const lang of ["zh", "en"] as const) {
      const offers = getDictionary(lang).entities.offers;
      for (const key of [
        "testPriorityColumn",
        "sortDefault",
        "sortPriority",
        "testFirstBadge",
      ] as const) {
        expect(typeof offers[key]).toBe("string");
        expect((offers[key] as string).length).toBeGreaterThan(0);
      }
    }
    expect(getDictionary("zh").entities.offers.testPriorityColumn).toBe("测试优先分");
    expect(getDictionary("zh").entities.offers.testFirstBadge).toBe("先测");
    expect(getDictionary("en").entities.offers.testPriorityColumn).toBe("Test priority");
  });
});
