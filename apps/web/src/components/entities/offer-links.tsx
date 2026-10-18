/**
 * Offer 双链接展示：联盟链接（affiliateUrl）+ 最终链接（destinationUrl），各带一键直达。
 * affiliateUrl 为空时只显示最终链接，绝不生成假链接。
 * 纯展示组件（client-safe）：不 value-import server-only 模块。
 */
export interface OfferLinksProps {
  affiliateUrl?: string | null;
  destinationUrl?: string | null;
  /** 联盟链接标签，默认“联盟链接” */
  affiliateLabel?: string;
  /** 最终链接标签，默认“最终链接” */
  destinationLabel?: string;
  /** 一键直达按钮文字，默认“↗ 直达” */
  openLabel?: string;
  className?: string;
}

const linkBtnCls =
  "inline-flex items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20";

export default function OfferLinks({
  affiliateUrl,
  destinationUrl,
  affiliateLabel = "联盟链接",
  destinationLabel = "最终链接",
  openLabel = "↗ 直达",
  className = "",
}: OfferLinksProps) {
  const aff = affiliateUrl?.trim() || null;
  const dest = destinationUrl?.trim() || null;
  if (!aff && !dest) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {aff ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink/70">
          <span>{affiliateLabel}：</span>
          <a
            href={aff}
            target="_blank"
            rel="noopener noreferrer"
            className={linkBtnCls}
          >
            {openLabel}
          </a>
        </span>
      ) : null}
      {dest ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink/70">
          <span>{destinationLabel}：</span>
          <a
            href={dest}
            target="_blank"
            rel="noopener noreferrer"
            className={linkBtnCls}
          >
            {openLabel}
          </a>
        </span>
      ) : null}
    </span>
  );
}
