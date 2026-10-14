import { describe, expect, it } from "vitest";
import {
  buildProductExtractPrompt,
  buildProductSummaryText,
  normalizeProduct,
} from "./product-capture-ai.js";

describe("product-capture-ai", () => {
  it("prompt 含任务与防编造规则", () => {
    const { user } = buildProductExtractPrompt("Max and Lily Bunk Bed $299.99", "zh");
    expect(user).toContain("卖点");
    expect(user).toContain("不许编造");
    expect(user).toContain("Max and Lily Bunk Bed $299.99");
  });

  it("normalize：清洗非法字段、卖点上限", () => {
    const p = normalizeProduct({
      title: "  Max and Lily Bunk Bed  ",
      brand: "",
      price: "299.99",
      currency: "USD",
      bullets: ["Solid pine", "", "  Easy assembly  ", 123, "x".repeat(300)],
      description: null,
      extra: "ignored",
    });
    expect(p).toEqual({
      title: "Max and Lily Bunk Bed",
      brand: null,
      price: 299.99,
      currency: "USD",
      bullets: ["Solid pine", "Easy assembly", "x".repeat(200)],
      description: null,
    });
  });

  it("normalize：非对象返回空", () => {
    expect(normalizeProduct(null)).toEqual({
      title: null,
      brand: null,
      price: null,
      currency: null,
      bullets: [],
      description: null,
    });
  });

  it("summary：按标题/价格/卖点格式化", () => {
    const text = buildProductSummaryText(
      {
        title: "Max and Lily Bunk Bed",
        brand: "Max and Lily",
        price: 299.99,
        currency: "USD",
        bullets: ["Solid pine"],
        description: null,
      },
      "zh"
    );
    expect(text).toContain("商品：Max and Lily Bunk Bed");
    expect(text).toContain("价格：USD 299.99");
    expect(text).toContain("- Solid pine");
  });
});
