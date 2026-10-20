import { describe, expect, it } from "vitest";
import {
  classifyKeywordIntent,
  groupKeywordsByIntent,
  INTENT_GROUP_META,
} from "./intent-groups";

describe("classifyKeywordIntent", () => {
  it("品牌：命中所选 offer 品牌名", () => {
    expect(classifyKeywordIntent("roborock official site", { brand: "Roborock" })).toBe("brand");
    expect(classifyKeywordIntent("buy roborock vacuum", { brand: "roborock" })).toBe("brand");
    // 未给品牌时不误判品牌组
    expect(classifyKeywordIntent("buy roborock vacuum")).toBe("generic");
  });

  it("型号：字母+数字 token 或命中产品型号清单", () => {
    expect(classifyKeywordIntent("roborock s8 maxv ultra price")).toBe("model");
    expect(classifyKeywordIntent("dyson v15 detect")).toBe("model");
    expect(classifyKeywordIntent("robot vacuum x100", { models: ["X100"] })).toBe("model");
    // 纯数字年份不算型号
    expect(classifyKeywordIntent("best robot vacuum 2026")).toBe("generic");
  });

  it("对比 / 评测 / 攻略：意图词规则", () => {
    expect(classifyKeywordIntent("roborock vs roomba")).toBe("compare");
    expect(classifyKeywordIntent("robot vacuum alternative")).toBe("compare");
    expect(classifyKeywordIntent("robot vacuum reviews")).toBe("review");
    expect(classifyKeywordIntent("robot vacuum rating")).toBe("review");
    expect(classifyKeywordIntent("how to clean a robot vacuum")).toBe("guide");
    expect(classifyKeywordIntent("robot vacuum buying guide")).toBe("guide");
    expect(classifyKeywordIntent("best way to mop floors")).toBe("guide");
  });

  it("场景与泛需求兜底；优先级 品牌 > 型号 > 对比 > 评测", () => {
    expect(classifyKeywordIntent("robot vacuum for pets")).toBe("scenario");
    expect(classifyKeywordIntent("portable blender for travel")).toBe("scenario");
    expect(classifyKeywordIntent("best robot vacuum")).toBe("generic");
    expect(classifyKeywordIntent("roborock s8 review", { brand: "roborock" })).toBe("brand");
    expect(classifyKeywordIntent("roborock s8 review")).toBe("model");
    expect(classifyKeywordIntent("roborock vs roomba review")).toBe("compare");
    expect(classifyKeywordIntent("")).toBe("generic");
  });
});

describe("groupKeywordsByIntent", () => {
  it("聚合、去重、按固定组序输出，并带承接页提示", () => {
    const out = groupKeywordsByIntent(
      [
        "robot vacuum reviews",
        "best robot vacuum",
        "roborock s8",
        "Robot Vacuum Reviews",
        "roborock vs roomba",
        "",
      ],
      { brand: "roborock" }
    );
    // 品牌优先级最高："roborock vs roomba" 也先进品牌组（人工可在 UI 改组）
    expect(out.map((g) => g.group)).toEqual(["brand", "review", "generic"]);
    expect(out.find((g) => g.group === "brand")?.keywords).toEqual([
      "roborock s8",
      "roborock vs roomba",
    ]);
    expect(out.find((g) => g.group === "review")?.keywords).toEqual(["robot vacuum reviews"]);
    expect(INTENT_GROUP_META.brand.landingZh).toBe("官网首页");
    expect(INTENT_GROUP_META.model.landingZh).toBe("产品页");
    expect(INTENT_GROUP_META.review.landingZh).toBe("评测页");
    expect(INTENT_GROUP_META.compare.landingZh).toBe("对比页");
    expect(INTENT_GROUP_META.guide.landingZh).toBe("攻略/内容页");
  });
});
