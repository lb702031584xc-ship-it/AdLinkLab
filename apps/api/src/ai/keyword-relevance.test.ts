import { describe, expect, it } from "vitest";
import {
  buildRelevancePrompt,
  normalizeJudgments,
} from "./keyword-relevance.js";

describe("keyword-relevance", () => {
  it("prompt 要求只认相关+购买意图的词，离题词判不相关", () => {
    const { user } = buildRelevancePrompt(
      "GREENVINES 折叠椅",
      "户外折叠 Adirondack 椅",
      [{ keyword: "greenvine baptist church", volume: 70 }],
      "zh"
    );
    expect(user).toContain("相关");
    expect(user).toContain("购买或对比意图");
    expect(user).toContain("离题");
    expect(user).toContain("greenvine baptist church");
  });
  it("en prompt 同样覆盖判断规则", () => {
    const { user } = buildRelevancePrompt("Chair", "", [{ keyword: "how to fold a chair" }], "en");
    expect(user).toContain("buying or comparison intent");
    expect(user).toContain("purely informational");
  });
  it("normalize：只认发过的词，去重，reason 截短", () => {
    const sent = [{ keyword: "green chair" }, { keyword: "red chair" }];
    const out = normalizeJudgments(
      {
        judgments: [
          { keyword: "green chair", relevant: true, reason: "x".repeat(150) },
          { keyword: "green chair", relevant: false, reason: "dup" },
          { keyword: "hallucinated kw", relevant: true, reason: "no" },
          { keyword: "red chair", relevant: "yes", reason: "not bool" },
        ],
      },
      sent
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ keyword: "green chair", relevant: true, reason: "x".repeat(100) });
    expect(out[1].relevant).toBe(false);
  });
  it("normalize：非数组 → 空", () => {
    expect(normalizeJudgments({}, [{ keyword: "a" }])).toEqual([]);
    expect(normalizeJudgments({ judgments: "nope" }, [{ keyword: "a" }])).toEqual([]);
  });
});
