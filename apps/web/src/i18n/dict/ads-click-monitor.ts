export interface AdsClickMonitorDict {
  title: string;
  description: string;
  howItWorks: string;
  steps: string[];
  labelLabel: string;
  labelPlaceholder: string;
  labelHint: string;
  maxClicksLabel: string;
  maxClicksPlaceholder: string;
  maxClicksHint: string;
  noLimitNote: string;
  maxClicksInvalid: string;
  generate: string;
  generating: string;
  copy: string;
  copied: string;
  download: string;
  resultTitle: string;
  setupTitle: string;
  setupSteps: string[];
}

export const zh: AdsClickMonitorDict = {
  title: "点击监测 Script",
  description:
    "为 Google Ads 生成点击次数监测脚本：给广告打上标签并设置点击上限，累计点击达到上限时自动暂停广告；不设上限，广告一直运行。",
  howItWorks: "工作原理",
  steps: [
    "给要监测的广告打上一个标签（如 adlinklab-clicks-wenoker）",
    "在这里填入同一标签，并输入点击上限（如 100）",
    "把生成的 Script 粘贴到 Google Ads → 工具 → 脚本，设置每小时运行",
    "Script 每次运行：检查该标签下广告的累计点击（ALL_TIME），达到上限的暂停",
    "不输入上限则不需要脚本：广告会一直运行",
  ],
  labelLabel: "监测标签",
  labelPlaceholder: "adlinklab-clicks-wenoker",
  labelHint: "只能包含字母、数字、下划线和连字符。要监测的广告必须打上完全相同的标签。",
  maxClicksLabel: "点击上限（可选）",
  maxClicksPlaceholder: "如 100",
  maxClicksHint: "累计点击达到上限时自动暂停广告。留空 = 不设上限，广告一直运行。",
  noLimitNote: "未设置上限，广告会一直运行，无需生成脚本。",
  maxClicksInvalid: "点击上限必须是大于 0 的整数。",
  generate: "生成 Script",
  generating: "生成中…",
  copy: "复制代码",
  copied: "已复制",
  download: "下载 .js 文件",
  resultTitle: "生成的 Script",
  setupTitle: "部署步骤",
  setupSteps: [
    "在 Google Ads 中给要监测的广告打上上方填写的标签",
    "进入 工具 → 脚本 → + 新建脚本，粘贴代码",
    "点击「运行」测试一次，查看日志确认监测正常",
    "设置频率为「每小时」，保存",
    "手动重新启用被暂停的广告后，若累计点击仍超过上限，下次脚本运行会再次暂停",
    "不同上限要分开：用不同标签 + 生成多份脚本，分别粘贴到 Google Ads",
  ],
};

export const en: AdsClickMonitorDict = {
  title: "Click Monitor Script",
  description:
    "Generate a Google Ads click-monitor script: tag ads with a label and set a click cap; ads are auto-paused when cumulative clicks reach the cap. Without a cap, ads keep running.",
  howItWorks: "How it works",
  steps: [
    "Apply a label to the ads you want to monitor (e.g. adlinklab-clicks-wenoker)",
    "Enter the same label here and set a click cap (e.g. 100)",
    "Paste the generated script into Google Ads → Tools → Scripts, run hourly",
    "Each run: check cumulative clicks (ALL_TIME) of labeled ads; pause any that reached the cap",
    "With no cap, no script is needed: ads keep running",
  ],
  labelLabel: "Monitor label",
  labelPlaceholder: "adlinklab-clicks-wenoker",
  labelHint:
    "Letters, digits, underscore and hyphen only. Monitored ads must share the exact same label.",
  maxClicksLabel: "Click cap (optional)",
  maxClicksPlaceholder: "e.g. 100",
  maxClicksHint:
    "Ads are auto-paused when cumulative clicks reach the cap. Leave empty = no cap, ads keep running.",
  noLimitNote: "No cap set — ads will keep running, no script needed.",
  maxClicksInvalid: "Click cap must be a positive integer.",
  generate: "Generate Script",
  generating: "Generating…",
  copy: "Copy code",
  copied: "Copied",
  download: "Download .js file",
  resultTitle: "Generated Script",
  setupTitle: "Deployment steps",
  setupSteps: [
    "Apply the label above to the ads you want to monitor in Google Ads",
    "Go to Tools → Scripts → + New script, paste the code",
    "Click Run once to test, check the log for correct monitoring",
    "Set frequency to Hourly and save",
    "If you manually re-enable a paused ad while cumulative clicks still exceed the cap, the next script run will pause it again",
    "Different caps need separate scripts: use different labels + generate multiple scripts, paste each into Google Ads",
  ],
};
