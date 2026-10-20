import { describe, expect, it } from "vitest";
import {
  paceActionLabelKey,
  paceStageForClicks,
  paceStageLabelKey,
} from "./pace-ladder";

describe("paceStageForClicks（测试节奏阶梯）", () => {
  it("clicks < 30 → 验证期 verify", () => {
    expect(paceStageForClicks(0)).toBe("verify");
    expect(paceStageForClicks(1)).toBe("verify");
    expect(paceStageForClicks(29)).toBe("verify");
  });

  it("30 ≤ clicks < 60 → 等延迟 wait（边界 30 含）", () => {
    expect(paceStageForClicks(30)).toBe("wait");
    expect(paceStageForClicks(45)).toBe("wait");
    expect(paceStageForClicks(59)).toBe("wait");
  });

  it("60 ≤ clicks < 100 → 看持续 sustain（边界 60 含）", () => {
    expect(paceStageForClicks(60)).toBe("sustain");
    expect(paceStageForClicks(99)).toBe("sustain");
  });

  it("clicks ≥ 100 → 综合判定 judge（边界 100 含）", () => {
    expect(paceStageForClicks(100)).toBe("judge");
    expect(paceStageForClicks(1000)).toBe("judge");
  });

  it("非法输入（负数/NaN）按 0 处理 → 验证期，不抛错", () => {
    expect(paceStageForClicks(-5)).toBe("verify");
    expect(paceStageForClicks(NaN)).toBe("verify");
  });

  it("label key 映射正确", () => {
    expect(paceStageLabelKey("verify")).toBe("paceStageVerify");
    expect(paceStageLabelKey("wait")).toBe("paceStageWait");
    expect(paceStageLabelKey("sustain")).toBe("paceStageSustain");
    expect(paceStageLabelKey("judge")).toBe("paceStageJudge");
    expect(paceActionLabelKey("verify")).toBe("paceActionVerify");
    expect(paceActionLabelKey("wait")).toBe("paceActionWait");
    expect(paceActionLabelKey("sustain")).toBe("paceActionSustain");
    expect(paceActionLabelKey("judge")).toBe("paceActionJudge");
  });
});
