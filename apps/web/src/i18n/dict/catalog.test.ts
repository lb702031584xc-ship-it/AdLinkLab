import { describe, expect, it } from "vitest";
import { en, zh } from "./catalog";

/** AGENTS.md: i18n dict objects passed to client components must not contain functions. */
function assertNoFunctions(obj: unknown, path: string): void {
  if (typeof obj === "function") {
    throw new Error(`function found in catalog dict at ${path}`);
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      assertNoFunctions(v, path ? `${path}.${k}` : k);
    }
  }
}

const EXPECTED_RISK_TEXT =
  "登录态采集风险提示：使用登录态（Cookie）自动采集商品数据，可能违反 YeahPromos/PartnerBoost 服务条款中关于自动化访问的条款，存在账号被警告、限流或封禁的风险。请仅采集您自己账号可见的商品数据，不要高频抓取。如该联盟日后提供官方商品 API，请优先切换为官方 API 模式。继续即代表您已了解并自行承担该风险。";

describe("catalog dict", () => {
  it("contains no functions (client-component safe)", () => {
    expect(() => assertNoFunctions(zh, "")).not.toThrow();
    expect(() => assertNoFunctions(en, "")).not.toThrow();
  });

  it("keeps the ToS risk text verbatim in both languages", () => {
    expect(zh.mode.riskText).toBe(EXPECTED_RISK_TEXT);
    expect(en.mode.riskText).toBe(EXPECTED_RISK_TEXT);
  });

  it("cookie guide mentions never sharing in chat", () => {
    expect(zh.mode.cookieGuide).toContain("不要在聊天里发");
  });

  it("preset mode switch strings exist in both languages", () => {
    expect(zh.preset.modeLabel).toBe("筛查口径");
    expect(zh.preset.modeRegular).toBe("常规");
    expect(zh.preset.modeLoose).toBe("宽松型");
    expect(en.preset.modeRegular).toBe("Regular");
    expect(en.preset.modeLoose).toBe("Loose");
  });

  it("loose hint says recommended is authoritative and numeric preset filters still apply", () => {
    expect(zh.preset.looseHint).toContain("recommended");
    expect(zh.preset.looseHint).toContain("仅看推荐");
    expect(en.preset.looseHint).toContain("recommended");
  });

  it("riskCost column header carries a merchant-level label, never product terms", () => {
    expect(zh.products.colRiskCost).toContain("商家级政策提示");
    expect(en.products.colRiskCost).toContain("Merchant-level");
    expect(zh.products.sortCommissionDesc).toBe("佣金降序");
    expect(en.products.sortCommissionDesc).toBe("Commission desc");
  });
});
