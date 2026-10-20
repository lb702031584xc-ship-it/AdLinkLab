/**
 * 数据管理（导出/导入）strings (2026-10-19). Standalone dict.
 */
export const zh = {
  page: {
    title: "数据管理",
    description: "导出你的广告数据与系统配置，或导入以前导出的配置文件。",
    loadError: "数据管理加载失败",
  },
  export: {
    title: "数据导出",
    subtitle: "导出你的数据（Offers / Campaigns / 用户配置）。",
    type: "数据类型",
    types: {
      offers: "Offers（推广产品）",
      campaigns: "Campaigns（广告活动）",
      settings: "Settings（用户配置）",
    },
    format: "导出格式",
    formats: { json: "JSON（结构化数据）", csv: "CSV（Excel 兼容）" },
    button: "导出数据",
    exporting: "导出中…",
    noteSettings: "Settings 仅支持 JSON；敏感信息（API 密钥、代理凭证）默认脱敏导出。",
  },
  import: {
    title: "配置导入",
    subtitle: "导入用户配置数据（JSON 格式，仅支持 Settings）。",
    pickFile: "选择配置文件",
    noFile: "未选择文件",
    button: "导入配置",
    importing: "导入中…",
    warn: "请使用从本系统导出的配置文件（JSON 格式）；脱敏的配置项（含 ****）会被自动跳过。",
    done: "导入完成",
    applied: "已应用",
    skipped: "已跳过",
    invalidJson: "文件不是有效的 JSON",
    note: "OAuth/Token 等受保护配置不通过导入修改，需要在系统设置里重新填写。",
  },
  table: {
    title: "配置分类说明",
    columns: { category: "分类", desc: "说明", importable: "可导入" },
    rows: [
      { category: "ai", desc: "AI 服务配置（服务商、模型；密钥脱敏后需重填）", importable: "部分" },
      { category: "ads", desc: "广告发布配置（MCC 连接列表）", importable: "是" },
      { category: "proxy", desc: "代理服务器配置（需明文 URL）", importable: "是" },
      { category: "system", desc: "系统通用配置（货币、链接检查）", importable: "是" },
    ],
  },
};

export type DataIoDict = typeof zh;

export const en: DataIoDict = {
  page: {
    title: "Data Management",
    description: "Export your ad data and system configuration, or import a previously exported config file.",
    loadError: "Failed to load data management",
  },
  export: {
    title: "Export data",
    subtitle: "Export your data (Offers / Campaigns / Settings).",
    type: "Data type",
    types: {
      offers: "Offers (promoted products)",
      campaigns: "Campaigns (ad campaigns)",
      settings: "Settings (user configuration)",
    },
    format: "Format",
    formats: { json: "JSON (structured data)", csv: "CSV (Excel compatible)" },
    button: "Export",
    exporting: "Exporting…",
    noteSettings: "Settings exports JSON only; secrets (API keys, proxy credentials) are masked by default.",
  },
  import: {
    title: "Import configuration",
    subtitle: "Import user configuration (JSON format, Settings only).",
    pickFile: "Choose config file",
    noFile: "No file chosen",
    button: "Import",
    importing: "Importing…",
    warn: "Use a config file exported from this system (JSON); masked items (****) are skipped automatically.",
    done: "Import complete",
    applied: "Applied",
    skipped: "Skipped",
    invalidJson: "The file is not valid JSON",
    note: "Protected config (OAuth/tokens) cannot be changed via import; re-enter it in System Settings.",
  },
  table: {
    title: "Config categories",
    columns: { category: "Category", desc: "Description", importable: "Importable" },
    rows: [
      { category: "ai", desc: "AI service config (provider, model; key must be re-entered after masking)", importable: "Partial" },
      { category: "ads", desc: "Ad publishing config (MCC connections)", importable: "Yes" },
      { category: "proxy", desc: "Proxy server config (plaintext URLs required)", importable: "Yes" },
      { category: "system", desc: "System config (currency, link checks)", importable: "Yes" },
    ],
  },
};
