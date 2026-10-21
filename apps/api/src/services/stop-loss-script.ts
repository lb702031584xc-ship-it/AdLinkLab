/**
 * 自动止损脚本生成（Google Ads Script）。
 *
 * 站内只生成脚本、绝不直接执行暂停——脚本由用户粘贴到 Google Ads
 * （工具 → 脚本，建议每小时运行）后才生效，页面文案必须如实标注。
 *
 * 系列匹配与建系列脚本（script-create-campaign.ts）同款约定：
 * AdsApp.campaigns().withCondition('campaign.name = "..."') 精确匹配，
 * 名称转义同 escapeCondition_ 口径（反斜杠 + 双引号）。
 *
 * 判断与站内 perf-verdict 同一口径：系列累计花费（ALL_TIME）≥
 * payout × 2.5 且转化 = 0 → 暂停。注意 AdsApp 的 cost 是账户币种，
 * payout 须为同币种数值（脚本头注释已提醒）。
 */
import { STOP_LOSS_PAYOUT_MULTIPLE } from "@adlinklab/shared";

export interface StopLossScriptInput {
  /** 系列名（与 Google Ads 中的系列名精确一致；档案取 offerName）。 */
  campaignName: string;
  /** 单次转化佣金（与 Google Ads 账户同币种）。 */
  payout: number;
  /** 止损倍数，缺省 STOP_LOSS_PAYOUT_MULTIPLE（2.5）。 */
  multiple?: number;
}

function escapeConditionValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

export function buildStopLossScript(input: StopLossScriptInput): string {
  const multiple = input.multiple ?? STOP_LOSS_PAYOUT_MULTIPLE;
  const threshold = Math.round(input.payout * multiple * 100) / 100;
  const name = input.campaignName.trim();
  const escapedName = escapeConditionValue(name);
  return `// ============================================================
// AdLinkLab 自动止损脚本（Stop-Loss）
// 规则：系列累计花费 >= payout × ${multiple} 且转化 = 0 → 自动暂停系列
// 本脚本由 AdLinkLab 站内生成，站点不会直接执行暂停；
// 只有把本脚本粘贴到 Google Ads（工具 → 脚本）并授权运行后才会生效。
// 建议运行频率：每小时 1 次。
// 注意：花费为 Google Ads 账户币种，payout 须填同币种数值。
// 系列名不同请改 CAMPAIGN_NAME（须与 Google Ads 中的系列名完全一致）。
// ============================================================

var CAMPAIGN_NAME = ${jsString(name)};
var PAYOUT = ${input.payout};
var STOP_LOSS_MULTIPLE = ${multiple};
var STOP_LOSS_THRESHOLD = ${threshold}; // = PAYOUT × STOP_LOSS_MULTIPLE

function main() {
  var it = AdsApp.campaigns()
    .withCondition('campaign.name = "' + "${escapedName}" + '"')
    .get();
  if (!it.hasNext()) {
    Logger.log('未找到系列：' + CAMPAIGN_NAME);
    return;
  }
  var campaign = it.next();
  var stats = campaign.getStatsFor('ALL_TIME');
  var cost = stats.getCost();
  var conversions = stats.getConversions();
  Logger.log(
    '系列「' + CAMPAIGN_NAME + '」累计花费 ' + cost +
    '，转化 ' + conversions +
    '，止损阈值 ' + STOP_LOSS_THRESHOLD + '（payout ' + PAYOUT + ' × ' + STOP_LOSS_MULTIPLE + '）'
  );
  if (cost >= STOP_LOSS_THRESHOLD && conversions <= 0) {
    campaign.pause();
    Logger.log('已暂停系列「' + CAMPAIGN_NAME + '」：花费已达止损阈值且转化 = 0');
  }
}
`;
}
