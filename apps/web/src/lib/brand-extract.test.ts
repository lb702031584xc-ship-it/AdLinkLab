import { describe, expect, it } from "vitest";
import { extractBrandName } from "./brand-extract";

describe("extractBrandName (P1-2)", () => {
  it("标题按 | 切，第一段像品牌名 → 0.8", () => {
    expect(
      extractBrandName({ title: "Anker | Official Site", url: "" })
    ).toEqual({ brandName: "Anker", source: "auto_extracted", confidence: 0.8 });
  });

  it("标题无分隔符且短 → 0.7", () => {
    const r = extractBrandName({ title: "Anker", url: "" });
    expect(r?.confidence).toBe(0.7);
    expect(r?.brandName).toBe("Anker");
  });

  it("标题长句时取前 2 token 兜底 → 0.5", () => {
    const r = extractBrandName({
      title: "Best portable power bank for travel 20000mAh fast charging",
      url: "",
    });
    expect(r?.confidence).toBe(0.5);
    expect(r?.brandName).toBe("Best portable");
  });

  it("无标题时域名回退 → 0.6", () => {
    expect(
      extractBrandName({ title: "", url: "https://www.anker.com/deals" })
    ).toEqual({ brandName: "Anker", source: "domain_fallback", confidence: 0.6 });
  });

  it("标题和 URL 都没有 → null，不编造", () => {
    expect(extractBrandName({})).toBeNull();
    expect(extractBrandName({ title: "", url: "not a url" })).toBeNull();
  });

  it("IP 域名回退置信度 0.3", () => {
    const r = extractBrandName({ title: "", url: "http://192.168.1.10/x" });
    expect(r?.confidence).toBe(0.3);
  });
});
