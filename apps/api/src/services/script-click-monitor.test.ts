import { describe, expect, it } from "vitest";
import {
  buildClickMonitorScript,
  validateClickMonitorScriptInput,
} from "./script-click-monitor.js";

describe("script-click-monitor", () => {
  it("generates a valid Google Ads script with the label and maxClicks", () => {
    const src = buildClickMonitorScript({
      label: "adlinklab-monitor-nike",
      maxClicks: 100,
    });
    expect(src).toContain("adlinklab-monitor-nike");
    expect(src).toContain("MAX_CLICKS = 100");
    expect(src).toContain("function main()");
    expect(src).toContain("AdsApp.ads()");
    expect(src).toContain('LabelNames CONTAINS');
    expect(src).toContain('getStatsFor("ALL_TIME").getClicks()');
    expect(src).toContain("ad.pause()");
    expect(src).toContain("clicks >= MAX_CLICKS");
  });

  it("rejects empty label", () => {
    expect(
      validateClickMonitorScriptInput({ label: "", maxClicks: 100 }),
    ).toHaveLength(1);
    expect(
      validateClickMonitorScriptInput({ label: "   ", maxClicks: 100 }),
    ).toHaveLength(1);
  });

  it("rejects label with illegal characters", () => {
    const errors = validateClickMonitorScriptInput({
      label: "bad label!",
      maxClicks: 100,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects missing maxClicks", () => {
    const errors = validateClickMonitorScriptInput({
      label: "adlinklab-monitor-nike",
    });
    expect(errors).toContain("maxClicks 必填，如 100");
  });

  it("rejects maxClicks of 0, negative, or non-integer", () => {
    for (const bad of [0, -1, -100, 1.5, 2.7]) {
      const errors = validateClickMonitorScriptInput({
        label: "adlinklab-monitor-nike",
        maxClicks: bad,
      });
      expect(errors).toContain("maxClicks 必须是 >= 1 的整数");
    }
  });

  it("accepts valid input", () => {
    expect(
      validateClickMonitorScriptInput({
        label: "adlinklab-monitor-nike_01",
        maxClicks: 100,
      }),
    ).toHaveLength(0);
  });

  it("throws on invalid input in builder", () => {
    expect(() =>
      buildClickMonitorScript({ label: "", maxClicks: 100 }),
    ).toThrow();
    expect(() =>
      buildClickMonitorScript({
        label: "adlinklab-monitor-nike",
        maxClicks: 0,
      }),
    ).toThrow();
    expect(() =>
      buildClickMonitorScript({
        label: "adlinklab-monitor-nike",
        maxClicks: 1.5,
      }),
    ).toThrow();
  });
});
