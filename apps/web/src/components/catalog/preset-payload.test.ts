import { describe, expect, it } from "vitest";
import { buildScreeningPresetPayload } from "./preset-payload";

const base = {
  minReviews: null,
  minCommissionAmount: 8,
  minCommissionRate: 10,
  minPrice: 80,
  maxPrice: 150,
  minScore: null,
};

describe("buildScreeningPresetPayload（筛查口径 mode）", () => {
  it("未传 mode 时默认常规 regular", () => {
    const payload = buildScreeningPresetPayload(base, false);
    expect(payload.mode).toBe("regular");
  });

  it("宽松型 loose 原样透传", () => {
    const payload = buildScreeningPresetPayload({ ...base, mode: "loose" }, false);
    expect(payload.mode).toBe("loose");
  });

  it("常规 regular 原样透传", () => {
    const payload = buildScreeningPresetPayload(
      { ...base, mode: "regular" },
      false
    );
    expect(payload.mode).toBe("regular");
  });

  it("数值字段原样透传，常规模式下与老 payload 一致", () => {
    const payload = buildScreeningPresetPayload(base, false);
    expect(payload.minCommissionAmount).toBe(8);
    expect(payload.minCommissionRate).toBe(10);
    expect(payload.minPrice).toBe(80);
    expect(payload.maxPrice).toBe(150);
    expect(payload.minReviews).toBeNull();
    expect(payload.minScore).toBeNull();
  });

  it("非管理员不带管理员字段（老行为不变）", () => {
    const payload = buildScreeningPresetPayload(
      { ...base, autoCreateOffer: true, autoCreateTopN: 20 },
      false
    );
    expect(payload.autoCreateOffer).toBeUndefined();
    expect(payload.autoCreateTopN).toBeUndefined();
    expect(payload.admin).toBe(false);
  });

  it("管理员带管理员字段", () => {
    const payload = buildScreeningPresetPayload(
      { ...base, mode: "loose", autoCreateOffer: true, autoCreateTopN: 20 },
      true
    );
    expect(payload.autoCreateOffer).toBe(true);
    expect(payload.autoCreateTopN).toBe(20);
    expect(payload.admin).toBe(true);
    expect(payload.mode).toBe("loose");
  });
});
