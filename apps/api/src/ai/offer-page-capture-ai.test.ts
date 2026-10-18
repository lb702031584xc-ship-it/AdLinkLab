import { describe, expect, it } from "vitest";
import {
  buildOfferPageExtractPrompt,
  buildOfferPageSummaryText,
  normalizeOfferPage,
} from "./offer-page-capture-ai.js";

describe("offer-page-capture-ai", () => {
  it("prompt 含任务与防混淆规则（% 是佣金、$ 是 payout）", () => {
    const { user } = buildOfferPageExtractPrompt(
      "Commission: 13% Est. Payout: $23.4",
      "zh"
    );
    expect(user).toContain("绝不把 payout 的 $ 金额当成佣金");
    expect(user).toContain("不许用佣金率 × 价格自己算");
    expect(user).toContain("Commission: 13% Est. Payout: $23.4");
  });

  it("normalize：截图口径（13% + $23.4）正确分流", () => {
    const p = normalizeOfferPage({
      offerName: "  Some Offer  ",
      network: "PartnerBoost",
      commission: { value: 13, type: "percentage" },
      estimatedPayout: 23.4,
      averageOrderValue: 180,
      currency: "USD",
      cookieDays: 30,
      evidence: {
        commission: "Commission: 13%",
        payout: "Est. Payout: $23.4",
        price: "Average order value: $180",
      },
      extra: "ignored",
    });
    expect(p).toEqual({
      offerName: "Some Offer",
      network: "PartnerBoost",
      commissionValue: 13,
      commissionType: "percentage",
      estimatedPayout: 23.4,
      averageOrderValue: 180,
      currency: "USD",
      cookieDays: 30,
      evidence: {
        commission: "Commission: 13%",
        payout: "Est. Payout: $23.4",
        price: "Average order value: $180",
      },
    });
  });

  it("normalize：固定佣金与非法百分比", () => {
    const fixed = normalizeOfferPage({
      commission: { value: "25", type: "fixed" },
      estimatedPayout: 25,
    });
    expect(fixed.commissionValue).toBe(25);
    expect(fixed.commissionType).toBe("fixed");
    // 百分比 >100 几乎一定是把 payout 金额误认成 %，丢弃
    const bad = normalizeOfferPage({
      commission: { value: 2340, type: "percentage" },
    });
    expect(bad.commissionValue).toBeNull();
    expect(bad.commissionType).toBeNull();
  });

  it("normalize：非对象返回空", () => {
    expect(normalizeOfferPage(null)).toEqual({
      offerName: null,
      network: null,
      commissionValue: null,
      commissionType: null,
      estimatedPayout: null,
      averageOrderValue: null,
      currency: null,
      cookieDays: null,
      evidence: { commission: null, payout: null, price: null },
    });
  });

  it("summary：按佣金/payout/均价格式化", () => {
    const text = buildOfferPageSummaryText(
      {
        offerName: "Some Offer",
        network: null,
        commissionValue: 13,
        commissionType: "percentage",
        estimatedPayout: 23.4,
        averageOrderValue: 180,
        currency: "USD",
        cookieDays: null,
        evidence: { commission: null, payout: null, price: null },
      },
      "zh"
    );
    expect(text).toContain("佣金：13%（按比例）");
    expect(text).toContain("预估 payout：USD23.4");
    expect(text).toContain("均价：USD180");
  });
});
