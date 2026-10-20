/**
 * 补强 #24：品牌竞价 / 直达链接检查默认开启（可取消）— 默认值解析测试。
 */
import { describe, expect, it } from "vitest";
import {
  BRAND_BIDDING_CHECK_DEFAULT_ENABLED,
  resolveBrandBiddingCheckEnabled,
} from "./brand-bidding.js";
import {
  DIRECT_LINK_CHECK_DEFAULT_ENABLED,
  resolveDirectLinkCheckEnabled,
} from "./compliance.js";

describe("补强 #24 check defaults", () => {
  it("品牌竞价检查默认开；未传/传 null 按开，显式 false 才关", () => {
    expect(BRAND_BIDDING_CHECK_DEFAULT_ENABLED).toBe(true);
    expect(resolveBrandBiddingCheckEnabled()).toBe(true);
    expect(resolveBrandBiddingCheckEnabled(undefined)).toBe(true);
    expect(resolveBrandBiddingCheckEnabled(null)).toBe(true);
    expect(resolveBrandBiddingCheckEnabled(true)).toBe(true);
    expect(resolveBrandBiddingCheckEnabled(false)).toBe(false);
  });

  it("直达链接检查默认开；未传/传 null 按开，显式 false 才关", () => {
    expect(DIRECT_LINK_CHECK_DEFAULT_ENABLED).toBe(true);
    expect(resolveDirectLinkCheckEnabled()).toBe(true);
    expect(resolveDirectLinkCheckEnabled(undefined)).toBe(true);
    expect(resolveDirectLinkCheckEnabled(null)).toBe(true);
    expect(resolveDirectLinkCheckEnabled(true)).toBe(true);
    expect(resolveDirectLinkCheckEnabled(false)).toBe(false);
  });
});
