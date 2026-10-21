/**
 * 自动止损脚本生成：阈值 = payout × 2.5、系列名精确匹配（与建系列脚本
 * 同款 campaign.name 条件）、名称转义、诚实注释（站点不直接执行）。
 */
import { describe, expect, it } from "vitest";
import { buildStopLossScript } from "./stop-loss-script.js";

describe("buildStopLossScript", () => {
  it("内嵌系列名、payout 与 2.5 倍阈值，按名精确匹配 + pause 逻辑", () => {
    const s = buildStopLossScript({ campaignName: "Roborock US Search", payout: 117 });
    expect(s).toContain('var CAMPAIGN_NAME = "Roborock US Search"');
    expect(s).toContain("var PAYOUT = 117");
    expect(s).toContain("var STOP_LOSS_MULTIPLE = 2.5");
    expect(s).toContain("var STOP_LOSS_THRESHOLD = 292.5");
    expect(s).toContain(`campaign.name = "`);
    expect(s).toContain("getStatsFor('ALL_TIME')");
    expect(s).toContain("campaign.pause()");
    expect(s).toContain("conversions <= 0");
    expect(s).toContain("cost >= STOP_LOSS_THRESHOLD");
  });

  it("系列名含引号/反斜杠时转义，不破坏脚本字符串", () => {
    const s = buildStopLossScript({ campaignName: 'A "B" \\ C', payout: 10 });
    expect(s).toContain('A \\"B\\" \\\\ C');
    expect(s).toContain("var STOP_LOSS_THRESHOLD = 25");
  });

  it("文案诚实：注明站点不直接执行、需粘贴到 Google Ads 才生效", () => {
    const s = buildStopLossScript({ campaignName: "X", payout: 10 });
    expect(s).toContain("站点不会直接执行暂停");
    expect(s).toContain("粘贴到 Google Ads");
    expect(s).toContain("每小时 1 次");
  });

  it("自定义倍数生效", () => {
    const s = buildStopLossScript({ campaignName: "X", payout: 40, multiple: 3 });
    expect(s).toContain("var STOP_LOSS_MULTIPLE = 3");
    expect(s).toContain("var STOP_LOSS_THRESHOLD = 120");
  });
});
