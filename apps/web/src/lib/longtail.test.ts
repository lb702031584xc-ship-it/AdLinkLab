import { describe, expect, it } from "vitest";
import { mergeLongtailCandidates } from "./longtail";

describe("mergeLongtailCandidates", () => {
  it("单单词种子：包含种子词且更长的才入选，种子本身排除", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [
        { keyword: "roborock s8 maxv ultra", volume: "5400" },
        { keyword: "roborock", volume: "100000" },
      ],
      serverCandidates: [
        { keyword: "roborock vacuum", volume: null, source: "autocomplete" },
        { keyword: "irobot roomba", volume: 9000, source: "autocomplete" },
      ],
      planKeywords: [],
    });
    const kws = out.map((c) => c.keyword);
    expect(kws).toContain("roborock s8 maxv ultra");
    expect(kws).toContain("roborock vacuum");
    expect(kws).not.toContain("roborock");
    expect(kws).not.toContain("irobot roomba");
  });

  it("多单词种子：必须包含全部单词且词数更多", () => {
    const out = mergeLongtailCandidates({
      seed: "robot vacuum",
      snapshotRows: [],
      serverCandidates: [
        { keyword: "best robot vacuum", volume: null, source: "autocomplete" },
        { keyword: "robot vacuum cleaner", volume: 1200, source: "dataforseo" },
        { keyword: "robot mop", volume: 5000, source: "dataforseo" },
        { keyword: "robot vacuum", volume: 8000, source: "dataforseo" },
      ],
      planKeywords: [],
    });
    const kws = out.map((c) => c.keyword);
    expect(kws).toEqual(["robot vacuum cleaner", "best robot vacuum"]);
  });

  it("去重：同词保留带搜索量的；排除已在计划里的词；按搜索量降序，无量排最后", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [{ keyword: "roborock s8 maxv ultra", volume: "5400" }],
      serverCandidates: [
        { keyword: "roborock s8 maxv ultra", volume: 5400, source: "dataforseo" },
        { keyword: "roborock saros 10r", volume: 2900, source: "dataforseo" },
        { keyword: "roborock vacuum", volume: null, source: "autocomplete" },
        { keyword: "roborock q7", volume: 800, source: "dataforseo" },
      ],
      planKeywords: ["roborock q7"],
    });
    expect(out.map((c) => c.keyword)).toEqual([
      "roborock s8 maxv ultra",
      "roborock saros 10r",
      "roborock vacuum",
    ]);
    expect(out[0].source).toBe("snapshot");
    expect(out[0].volume).toBe(5400);
    expect(out[2].volume).toBeNull();
  });
});
