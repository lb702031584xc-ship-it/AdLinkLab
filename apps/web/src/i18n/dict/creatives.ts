/**
 * 创意管理库 strings (2026-10-19). Standalone dict. Strings only — no functions.
 */
export const zh = {
  page: {
    title: "创意管理",
    description:
      "租户自有 RSA 文案资产库：手动建、AI 入库或从投放档案导入；标记已使用方便复用。无真实广告数据同步时不做 CTR 统计。",
    loadError: "创意加载失败",
    empty: "还没有创意。新建一条，或从投放档案导入历史 RSA 文案。",
  },
  stats: {
    total: "总创意数",
    draft: "草稿",
    used: "已使用",
    archived: "已归档",
  },
  filters: {
    search: "搜索标题、描述或卖点…",
    statusAll: "所有状态",
    statuses: { DRAFT: "草稿", USED: "已使用", ARCHIVED: "已归档" },
    sources: { MANUAL: "手动", AI: "AI", ARCHIVE: "投放档案" },
    refresh: "刷新",
  },
  form: {
    create: "新建创意",
    edit: "编辑创意",
    title: "标题 *",
    titlePlaceholder: "RSA 标题（建议 30 字符内）",
    description: "描述 *",
    descriptionPlaceholder: "RSA 描述（建议 90 字符内）",
    finalUrl: "最终链接（可选）",
    angle: "卖点角度（可选）",
    anglePlaceholder: "例如：低价 / 免运费 / 官方直营",
    cancel: "取消",
    save: "保存",
    saving: "保存中…",
    titleRequired: "标题和描述必填",
    saved: "已保存",
    deleted: "已删除",
    delete: "删除",
    deleteConfirm: "确定删除这条创意吗？",
    markUsed: "标记已使用",
    markDraft: "移回草稿",
    archive: "归档",
    source: "来源",
  },
  import: {
    button: "从投放档案导入",
    importing: "导入中…",
    done: "导入完成：新建 {c} 条，跳过 {s} 条（去重）",
    empty: "投放档案中没有可导入的 RSA 文案",
  },
  note: {
    ctr: "CTR 效果统计需接通广告数据同步后开放；当前展示资产状态与使用情况。",
    goOffer: "为 Offer 写创意 →",
  },
};

export type CreativesDict = typeof zh;

export const en: CreativesDict = {
  page: {
    title: "Creative Library",
    description:
      "Your RSA text assets: create manually, save from AI, or import from launch archives; mark used ones for reuse. No CTR stats until ad data sync is enabled.",
    loadError: "Failed to load creatives",
    empty: "No creatives yet. Create one, or import historical RSA copy from launch archives.",
  },
  stats: {
    total: "Total",
    draft: "Draft",
    used: "Used",
    archived: "Archived",
  },
  filters: {
    search: "Search title, description or angle…",
    statusAll: "All statuses",
    statuses: { DRAFT: "Draft", USED: "Used", ARCHIVED: "Archived" },
    sources: { MANUAL: "Manual", AI: "AI", ARCHIVE: "Archive" },
    refresh: "Refresh",
  },
  form: {
    create: "New creative",
    edit: "Edit creative",
    title: "Headline *",
    titlePlaceholder: "RSA headline (ideally ≤30 chars)",
    description: "Description *",
    descriptionPlaceholder: "RSA description (ideally ≤90 chars)",
    finalUrl: "Final URL (optional)",
    angle: "Angle (optional)",
    anglePlaceholder: "e.g. low price / free shipping / official",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    titleRequired: "Headline and description are required",
    saved: "Saved",
    deleted: "Deleted",
    delete: "Delete",
    deleteConfirm: "Delete this creative?",
    markUsed: "Mark used",
    markDraft: "Move back to draft",
    archive: "Archive",
    source: "Source",
  },
  import: {
    button: "Import from launch archives",
    importing: "Importing…",
    done: "Import done: {c} created, {s} skipped (deduped)",
    empty: "No RSA copy found in launch archives",
  },
  note: {
    ctr: "CTR stats will appear once ad data sync is enabled; asset status and usage are shown for now.",
    goOffer: "Write creatives for an offer →",
  },
};
