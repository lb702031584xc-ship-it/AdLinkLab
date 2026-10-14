import { describe, expect, it } from "vitest";
import { parseEcommerceCapture } from "./ecommerce-capture.js";

describe("parseEcommerceCapture", () => {
  it("Amazon 产品页", () => {
    const r = parseEcommerceCapture(`
      Max & Lily Bunk Bed
      Price: $399.99
      4.5 out of 5 stars
      1,234 ratings
      Best Sellers Rank: #1,234 in Beds
    `);
    expect(r).toEqual({
      price: 399.99,
      rating: 4.5,
      reviewCount: 1234,
      bsr: 1234,
      bsrCategory: "Beds",
    });
  });

  it("找不到全为 null（不编造）", () => {
    expect(parseEcommerceCapture("这里什么都没有")).toEqual({
      price: null,
      rating: null,
      reviewCount: null,
      bsr: null,
      bsrCategory: null,
    });
  });
});
