/**
 * Google 搜索样式广告预览（纯展示组件，无数据请求、无电话占位）。
 * 标题最多取 3 条用 " | " 连接，描述最多取 2 条用 " " 连接，与 Google 实际渲染一致。
 */
export function AdPreview({
  headlines,
  descriptions,
  displayUrl,
  finalUrl,
  title,
  sponsoredLabel,
}: {
  headlines: string[];
  descriptions: string[];
  displayUrl: string;
  finalUrl: string;
  /** 卡片标题，如“广告预览（Google 搜索样式）”，由调用方传字典文案。 */
  title: string;
  /** “广告 / Sponsored”角标文案，由调用方传字典文案。 */
  sponsoredLabel: string;
}) {
  const headlineText = headlines
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");
  const descriptionText = descriptions
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mx-auto mt-3 max-w-sm rounded-2xl border border-ink/10 bg-paper p-4 shadow-sm">
        {/* 显示链接行 */}
        <p className="flex items-center gap-1.5 truncate text-xs text-ink/60">
          <span aria-hidden>🌐</span>
          <span className="truncate">{displayUrl || finalUrl}</span>
        </p>
        {/* 标题：Google 蓝 */}
        <p className="mt-1.5 text-lg leading-snug text-blue-700 underline-offset-2 hover:underline">
          {headlineText || "—"}
        </p>
        {/* 描述 */}
        <p className="mt-1 text-sm leading-relaxed text-ink/80">{descriptionText || "—"}</p>
        <p className="mt-2 text-xs font-medium text-ink/45">{sponsoredLabel}</p>
      </div>
    </div>
  );
}
