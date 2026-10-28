/**
 * 关键词闸门测试：用真实失败案例反向验证规则。
 */
import { describe, expect, it } from "vitest";
import { assessKeyword, filterKeywords } from "./keyword-gate.js";

describe("assessKeyword", () => {
  it("后台代码污染 → reject（PB 不是型号）", () => {
    const r = assessKeyword("VEVOR chamber vacuum sealer PB review");
    expect(r.verdict).toBe("reject");
    expect(r.codes).toContain("ADMIN_CODE_CONTAMINATION");
  });

  it("对比词但没有对比页 → reject", () => {
    const r = assessKeyword("VEVOR vs VacMaster chamber vacuum sealer");
    expect(r.verdict).toBe("reject");
    expect(r.codes).toContain("NO_COMPARISON_PAGE");
  });

  it("有对比页时对比词放行", () => {
    const r = assessKeyword("VEVOR vs VacMaster chamber vacuum sealer", {
      hasComparisonPage: true,
    });
    expect(r.verdict).toBe("verify");
  });

  it("折扣词但没有优惠 → reject", () => {
    const r = assessKeyword("VEVOR chamber vacuum sealer discount code");
    expect(r.verdict).toBe("reject");
    expect(r.codes).toContain("NO_DISCOUNT");
  });

  it("低价词 vs 高客单产品 → reject", () => {
    const r = assessKeyword("best affordable chamber vacuum sealer", {
      priceUsd: 260,
    });
    expect(r.verdict).toBe("reject");
    expect(r.codes).toContain("PRICE_MISMATCH");
  });

  it("低价词 + 低客单产品 → 放行", () => {
    const r = assessKeyword("best affordable chamber vacuum sealer", {
      priceUsd: 60,
    });
    expect(r.verdict).toBe("verify");
  });

  it("品牌词禁令命中 → reject", () => {
    const r = assessKeyword("vevor chamber sealer", {
      brandName: "VEVOR",
      brandBiddingForbidden: true,
    });
    expect(r.verdict).toBe("reject");
    expect(r.codes).toContain("BRAND_FORBIDDEN");
  });

  it("信息型 / 维修型意图 → reject", () => {
    expect(assessKeyword("how to use chamber sealer").codes).toContain(
      "INFORMATIONAL"
    );
    expect(assessKeyword("chamber sealer repair").codes).toContain(
      "NEGATIVE_INTENT"
    );
  });

  it("单个词太宽 → reject", () => {
    const r = assessKeyword("sealer");
    expect(r.verdict).toBe("reject");
    expect(r.codes).toContain("TOO_GENERIC");
  });

  it("没有搜索量 → verify，绝不判 bid", () => {
    const r = assessKeyword("vevor chamber vacuum sealer");
    expect(r.verdict).toBe("verify");
    expect(r.reason).toContain("搜索量");
  });

  it("搜索量达标 → bid", () => {
    const r = assessKeyword("vevor chamber vacuum sealer", {
      monthlySearches: 320,
    });
    expect(r.verdict).toBe("bid");
  });

  it("搜索量不达标 → reject", () => {
    const r = assessKeyword("vevor chamber vacuum sealer 10.2 inch", {
      monthlySearches: 15,
    });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toContain("低于门槛");
  });
});

describe("filterKeywords", () => {
  it("按 verdict 分组并计数", () => {
    const r = filterKeywords(
      [
        "VEVOR chamber vacuum sealer discount code", // reject
        "VEVOR vs VacMaster chamber vacuum sealer", // reject
        "vevor chamber vacuum sealer", // verify
        "buy chamber vacuum sealer for sous vide", // verify
        "sealer", // reject
      ],
      { priceUsd: 260 }
    );
    expect(r.counts.total).toBe(5);
    expect(r.counts.reject).toBe(3);
    expect(r.counts.verify).toBe(2);
    expect(r.counts.bid).toBe(0);
  });
});
