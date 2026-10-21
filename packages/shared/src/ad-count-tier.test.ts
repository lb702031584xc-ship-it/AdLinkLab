import { describe, expect, it } from "vitest";
import {
  adCountTier,
  adCountTierDistribution,
  AD_COUNT_SWEET_SPOT,
} from "./ad-count-tier.js";

describe("adCountTier（广告数分档边界）", () => {
  it("0 → none（无人投放）", () => {
    expect(adCountTier(0)?.key).toBe("none");
  });
  it("1 与 5 → small（小规模在投）", () => {
    expect(adCountTier(1)?.key).toBe("small");
    expect(adCountTier(5)?.key).toBe("small");
  });
  it("6 与 20 → sweet（甜蜜点）", () => {
    expect(adCountTier(6)?.key).toBe("sweet");
    expect(adCountTier(20)?.key).toBe("sweet");
  });
  it("21 与 50 → hot（竞争较热）", () => {
    expect(adCountTier(21)?.key).toBe("hot");
    expect(adCountTier(50)?.key).toBe("hot");
  });
  it("51 与 500 → red_ocean（红海）", () => {
    expect(adCountTier(51)?.key).toBe("red_ocean");
    expect(adCountTier(500)?.key).toBe("red_ocean");
  });
  it("未知不分档：null / undefined / NaN / 负数 → null", () => {
    expect(adCountTier(null)).toBeNull();
    expect(adCountTier(undefined)).toBeNull();
    expect(adCountTier(Number.NaN)).toBeNull();
    expect(adCountTier(-3)).toBeNull();
  });
  it("甜蜜点快捷区间 = min 1 / max 20", () => {
    expect(AD_COUNT_SWEET_SPOT).toEqual({ min: 1, max: 20 });
  });
  it("分布计数：未知不计入任何档", () => {
    const dist = adCountTierDistribution([0, 1, 5, 6, 20, 21, 50, 51, null, undefined]);
    expect(dist).toEqual({ none: 1, small: 2, sweet: 2, hot: 2, red_ocean: 1 });
  });
});
