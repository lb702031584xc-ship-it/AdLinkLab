import { describe, expect, it } from "vitest";
import {
  CATEGORY_CPC_BENCHMARKS,
  CATEGORY_CPC_SOURCE_NOTE,
  findCategoryCpc,
} from "./category-cpc.js";

describe("CATEGORY_CPC_BENCHMARKS（补强 #5）", () => {
  it("四品类课程参考值与标注齐备", () => {
    const byKey = new Map(CATEGORY_CPC_BENCHMARKS.map((b) => [b.key, b]));
    expect(byKey.get("electronics")?.medianCpcUsd).toBe(1.01);
    expect(byKey.get("apparel")?.medianCpcUsd).toBe(0.76);
    expect(byKey.get("saas")?.medianCpcUsd).toBe(2.94);
    expect(byKey.get("finance_insurance")?.medianCpcUsd).toBe(4.62);
    for (const b of CATEGORY_CPC_BENCHMARKS) {
      expect(b.labelZh).toBeTruthy();
      expect(b.labelEn).toBeTruthy();
    }
    expect(CATEGORY_CPC_SOURCE_NOTE).toContain("非实时");
    expect(CATEGORY_CPC_SOURCE_NOTE).toContain("not live data");
  });

  it("findCategoryCpc：未知 key → null", () => {
    expect(findCategoryCpc("saas")?.medianCpcUsd).toBe(2.94);
    expect(findCategoryCpc("nope")).toBeNull();
    expect(findCategoryCpc(null)).toBeNull();
    expect(findCategoryCpc(undefined)).toBeNull();
  });
});
