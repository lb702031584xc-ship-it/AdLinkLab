"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TrackNavItem {
  href: string;
  label: string;
  /**
   * Workflow phase within the lane (e.g. 选品 / 分析判断 / 物料制作 / 投流 / 监控优化).
   * When the phase changes between consecutive items, a small phase divider
   * label is rendered. Items without a phase (lane intros like the 7-day SOP)
   * render directly under the section title.
   */
  phase?: string;
}

export interface TrackNavSection {
  title: string;
  items: TrackNavItem[];
  /**
   * 置顶一级菜单组：标题高亮（amber-300 加粗 + 左侧小竖条），
   * 常驻展开 —— toggle 点击无效，始终渲染其 items。
   */
  pinned?: boolean;
}

interface TrackNavProps {
  /** Role-filtered sections, built server-side in the app layout. */
  sections: TrackNavSection[];
  /**
   * Current pathname. Optional: when omitted (the app layout cannot know the
   * URL in a server component without middleware changes), the browser's
   * pathname is used via usePathname().
   */
  activePath?: string;
}

/** Index of the first section containing the path (exact or nested route). */
function sectionIndexForPath(sections: TrackNavSection[], path: string): number {
  return sections.findIndex((section) =>
    section.items.some((item) => path === item.href || path.startsWith(`${item.href}/`)),
  );
}

function isActiveItem(item: TrackNavItem, path: string): boolean {
  // Strip query string (?tab=...) so deep-linked phase entries still highlight.
  const base = item.href.split("?")[0];
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Collapsible track navigation. Only the track containing the current page is
 * expanded by default; clicking a track header toggles it. The active page
 * link is highlighted.
 *
 * Pinned sections (`pinned: true`) always render their items and render their
 * title highlighted (amber-300 bold with a left accent bar); the toggle
 * header is replaced by a static, non-interactive label.
 *
 * Pure client component: never import server-only modules (next/headers,
 * server actions, @/lib/api/*) here. Keep it importable from the client
 * component rules documented in AGENTS.md lessons.
 */
export function TrackNav({ sections, activePath }: TrackNavProps) {
  const browserPath = usePathname();
  const path = activePath ?? browserPath;

  const [expanded, setExpanded] = useState<number[]>(() => {
    const initial = sectionIndexForPath(sections, path);
    const pinned = sections
      .map((s, i) => (s.pinned ? i : -1))
      .filter((i) => i >= 0);
    const set = new Set<number>(pinned);
    if (initial >= 0) set.add(initial);
    return [...set];
  });

  const toggle = (index: number) =>
    setExpanded((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );

  return (
    <div className="flex flex-col gap-1">
      {sections.map((section, index) => {
        const pinned = section.pinned === true;
        const open = pinned || expanded.includes(index);
        return (
          <div key={section.title}>
            {pinned ? (
              <div
                aria-hidden="true"
                className="relative flex w-full items-center rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-300"
              >
                <span
                  className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-amber-400"
                />
                <span>{section.title}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => toggle(index)}
                aria-expanded={open}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium uppercase tracking-wider text-mist/50 transition hover:bg-white/5 hover:text-mist/80"
              >
                <span>{section.title}</span>
                <span
                  aria-hidden="true"
                  className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
                >
                  ▼
                </span>
              </button>
            )}
            {open ? (
              <div className="flex flex-col gap-0.5 pb-1">
                {section.items.map((item, itemIndex) => {
                  const active = isActiveItem(item, path);
                  const prevPhase =
                    itemIndex > 0 ? section.items[itemIndex - 1].phase : undefined;
                  const showPhaseHeader =
                    item.phase !== undefined && item.phase !== prevPhase;
                  return (
                    <span key={item.href} className="flex flex-col gap-0.5">
                      {showPhaseHeader ? (
                        <span
                          aria-hidden="true"
                          className="mt-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-amber-200/70 first:mt-0"
                        >
                          {item.phase}
                        </span>
                      ) : null}
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`rounded-md px-3 py-2 text-sm transition ${
                          active
                            ? "bg-white/15 font-medium text-white"
                            : "text-mist/85 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
