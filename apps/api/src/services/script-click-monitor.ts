/**
 * 谷歌广告点击次数监测 Script 生成器。
 *
 * 原理：给要监测的广告打上同一个标签（如 "adlinklab-monitor-nike"）。
 * Script 每次运行时，读取每条带标签广告的累计点击数（ALL_TIME）；
 * 达到用户设定的上限时暂停该广告，未达上限的继续运行。
 *
 * 不输入上限 = 不生成暂停脚本：本生成器要求 maxClicks 必填且 >= 1，
 * 没有上限的广告不需要监测脚本，一直运行即可。
 *
 * 为什么用累计点击而不是当日点击：
 * - 用户要的是"这条广告一共点了几次就停"，不是"每天点几次"。
 * - ALL_TIME 统计自广告创建以来的全部点击，符合"累计点击达到上限就暂停"。
 *
 * 注意：手动重新启用后，若累计点击仍 >= 上限，下次运行会再次暂停。
 * 如需继续投放，先在 Google Ads 里把标签摘掉，或换一个新标签。
 *
 * 使用方式：用户在 Google Ads → 工具 → 脚本 中粘贴生成的代码，
 * 设置每小时（或自定义频率）运行一次。
 */

export const CLICK_MONITOR_SCRIPT_VERSION = "1.0.0";

export interface ClickMonitorScriptInput {
  /** 标签名，用于标识要监测的所有广告，如 "adlinklab-monitor-nike" */
  label: string;
  /** 累计点击上限，达到即暂停；必须是 >= 1 的整数 */
  maxClicks: number;
}

/**
 * 生成 Google Ads Script 源代码。
 * Script 逻辑：
 * 1. 找出所有带指定标签的已启用/已暂停广告
 * 2. 对每条广告取 ALL_TIME 累计点击数
 * 3. 点击 >= 上限且广告启用中 → 暂停并记日志；否则只记日志
 */
export function buildClickMonitorScript(
  input: ClickMonitorScriptInput,
): string {
  const label = input.label.replace(/["\\]/g, "");
  if (!label) throw new Error("label is required");
  if (!Number.isInteger(input.maxClicks) || input.maxClicks < 1) {
    throw new Error("maxClicks must be an integer >= 1");
  }

  return `/**
 * AdLinkLab 点击次数监测 Script v${CLICK_MONITOR_SCRIPT_VERSION}
 * 标签: ${label}
 * 累计点击上限: ${input.maxClicks}
 * 每次运行：检查该标签下每条广告的累计点击（ALL_TIME），达到上限的暂停，未达上限的继续运行。
 * 建议运行频率：每小时 1 次（Google Ads 脚本 → 频率 → 每小时）。
 * 注意：手动重新启用后，若累计点击仍 >= 上限，下次运行会再次暂停。
 */
function main() {
  var LABEL = "${label}";
  var MAX_CLICKS = ${input.maxClicks};

  // 找出该标签下的所有广告（不限状态）
  var ads = AdsApp.ads()
    .withCondition("LabelNames CONTAINS '" + LABEL + "'")
    .withCondition("Status IN [ENABLED, PAUSED]")
    .orderBy("AdGroupName ASC")
    .orderBy("Id ASC")
    .get();

  var count = 0;
  while (ads.hasNext()) {
    var ad = ads.next();
    count++;
    var clicks = 0;
    try {
      clicks = ad.getStatsFor("ALL_TIME").getClicks();
    } catch (e) {
      Logger.log("[" + LABEL + "] 广告 " + count + " 读取点击数失败: " + e);
      continue;
    }
    if (clicks >= MAX_CLICKS) {
      if (ad.isEnabled()) {
        ad.pause();
        Logger.log(
          "[" + LABEL + "] 广告 " + count + " 累计点击 " + clicks +
          " 已达上限 " + MAX_CLICKS + "，已暂停。"
        );
      } else {
        Logger.log(
          "[" + LABEL + "] 广告 " + count + " 累计点击 " + clicks +
          " 已达上限 " + MAX_CLICKS + "，已是暂停状态。"
        );
      }
    } else {
      Logger.log(
        "[" + LABEL + "] 广告 " + count + " 累计点击 " + clicks +
        " / 上限 " + MAX_CLICKS + "，继续运行。"
      );
    }
  }

  if (count === 0) {
    Logger.log("[" + LABEL + "] 未找到带此标签的广告，跳过。");
  }
}
`;
}

/**
 * 校验输入，返回错误信息列表（为空表示通过）。
 * label 与 rotation 相同规则；maxClicks 必填且必须是 >= 1 的整数。
 */
export function validateClickMonitorScriptInput(input: {
  label?: unknown;
  maxClicks?: unknown;
}): string[] {
  const errors: string[] = [];
  if (typeof input.label !== "string" || !input.label.trim()) {
    errors.push("label 必填，如 adlinklab-monitor-nike");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(input.label.trim())) {
    errors.push("label 只能包含字母、数字、下划线和连字符");
  }
  if (input.maxClicks === undefined || input.maxClicks === null) {
    errors.push("maxClicks 必填，如 100");
  } else if (
    typeof input.maxClicks !== "number" ||
    !Number.isInteger(input.maxClicks) ||
    input.maxClicks < 1
  ) {
    errors.push("maxClicks 必须是 >= 1 的整数");
  }
  return errors;
}
