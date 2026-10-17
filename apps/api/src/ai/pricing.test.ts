import { describe, expect, it } from "vitest";
import { estimateCostCents, pricingForModel } from "./pricing.js";

describe("estimateCostCents", () => {
  it("按公开价折算：deepseek-chat 1000 in / 500 out = 0.27*0.001 + 1.10*0.0005 美元", () => {
    // (1000*0.27 + 500*1.10) / 1e6 * 100 = 0.082 美分 → 四舍五入为 0
    expect(estimateCostCents("deepseek-chat", 1000, 500)).toBe(0);
    // 1M in / 1M out = (0.27 + 1.10) * 100 = 137 美分
    expect(estimateCostCents("deepseek-chat", 1_000_000, 1_000_000)).toBe(137);
  });

  it("deepseek-reasoner 用自己的价格", () => {
    expect(estimateCostCents("deepseek-reasoner", 1_000_000, 0)).toBe(55);
    expect(estimateCostCents("deepseek-reasoner", 0, 1_000_000)).toBe(219);
  });

  it("未知模型按 DeepSeek Chat 兜底价，不抛错", () => {
    expect(pricingForModel("some-future-model").inputPerMillionUsd).toBe(0.27);
    expect(estimateCostCents("some-future-model", 1_000_000, 0)).toBe(27);
  });

  it("无 usage（0 tokens）成本为 0；负数/NaN 按 0 处理", () => {
    expect(estimateCostCents("deepseek-chat", 0, 0)).toBe(0);
    expect(estimateCostCents("deepseek-chat", -5, NaN)).toBe(0);
  });
});
