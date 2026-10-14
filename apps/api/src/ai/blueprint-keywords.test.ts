import { describe, expect, it } from "vitest";
import { mergeKeywordItems } from "./blueprint";

describe("mergeKeywordItems", () => {
  it("用户种子全部保留在前，AI 补充去重", () => {
    const out = mergeKeywordItems(
      ["best treadmill 2026", "cheap treadmill"],
      [
        { keyword: "Best Treadmill 2026", reason: "高购买意图" },
        { keyword: "treadmill under 500", reason: "价格敏感词" },
        { keyword: "cheap treadmill", reason: "预算型词，转化意图明确" },
      ],
      12,
      "zh"
    );
    expect(out.map((k) => k.keyword)).toEqual([
      "best treadmill 2026",
      "cheap treadmill",
      "treadmill under 500",
    ]);
    expect(out[0]).toMatchObject({ source: "user", reason: "高购买意图" });
    expect(out[1]).toMatchObject({ source: "user", reason: "预算型词，转化意图明确" });
    expect(out[2]).toMatchObject({ source: "ai" });
  });

  it("AI 没评估的种子用默认理由", () => {
    const out = mergeKeywordItems(["lonely keyword"], [], 12, "zh");
    expect(out[0]).toMatchObject({ source: "user", reason: "你已选的关键词" });
  });

  it("种子超过 count 也全部保留", () => {
    const out = mergeKeywordItems(["a", "b", "c"], [{ keyword: "d", reason: "" }], 2, "zh");
    expect(out.map((k) => k.keyword)).toEqual(["a", "b", "c"]);
  });
});
