/**
 * 流量门可见性回归（2026-10-18）：
 * 1. 投放向导 step 2：流量门卡片始终渲染，不再被 `analyses.length > 0` 条件包裹；
 *    无历史分析记录（新建 offer）时也可见。
 * 2. TrafficGateCard 空状态：gate=null 但传了 onRecheck 时，手动区（含检测按钮）仍渲染，
 *    而不是只有"尚未检测"四个字。
 * 3. 工作表第 ① 步：流量门检测区排在 DemandGateStep（关键词区）之前——最顶部先看到流量门。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { zh as launchZh } from "@/i18n/dict/launch";
import { TrafficGateCard } from "@/components/traffic/traffic-gate-card";

const wizardSrc = readFileSync(
  fileURLToPath(new URL("./launch-wizard-client.tsx", import.meta.url)),
  "utf8",
);
const worksheetSrc = readFileSync(
  fileURLToPath(new URL("../ai/worksheet-client.tsx", import.meta.url)),
  "utf8",
);

describe("投放向导：流量门卡片始终渲染", () => {
  it("不再被 analyses.length > 0 条件包裹", () => {
    // 回归：曾经是 {analyses.length > 0 && (<div><TrafficGateCard />)}，
    // 新建 offer（无历史分析记录）走向导时流量门永远看不到。
    expect(wizardSrc).not.toMatch(
      /analyses\.length\s*>\s*0\s*&&[\s\S]{0,300}?<TrafficGateCard/,
    );
  });

  it("向导中确实渲染 TrafficGateCard", () => {
    expect(wizardSrc).toContain("<TrafficGateCard");
  });
});

describe("TrafficGateCard 空状态（gate=null + 有 onRecheck）", () => {
  it("手动区（含检测按钮）仍渲染", () => {
    const html = renderToStaticMarkup(
      createElement(TrafficGateCard, {
        gate: null,
        loading: false,
        dict: launchZh.trafficGate,
        onRecheck: () => {},
      }),
    );
    expect(html).toContain(launchZh.trafficGate.notChecked);
    expect(html).toContain(launchZh.trafficGate.manualTitle);
    expect(html).toContain(launchZh.trafficGate.recheck);
  });
});

describe("工作表第 ① 步：流量门在关键词区之上", () => {
  it("流量门检测区排在 DemandGateStep 之前", () => {
    const gatePos = worksheetSrc.indexOf("runTrafficGateCheck()");
    const demandPos = worksheetSrc.indexOf("<DemandGateStep");
    expect(gatePos).toBeGreaterThan(-1);
    expect(demandPos).toBeGreaterThan(-1);
    expect(gatePos).toBeLessThan(demandPos);
  });
});
