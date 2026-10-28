"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavProgressAction, type NavProgress } from "@/lib/api/nav-progress-actions";

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

/**
 * 导航分层（2026-10-28）。
 *
 * 系统有 44 个一级入口，新手跑 3 个 offer 只用到其中 4 个。这里按「什么时候
 * 用得上」分三层，默认只显示第 0 层：
 *   0 = 决策（每天用）：选品、关键词、体检入口
 *   1 = 运营（跑过几个 offer 才用）：复盘、止损、死链、佣金监控、搜索词…
 *   2 = 其余全部（工程/运维/规模化）
 * 未列出的 href 一律归第 2 层——宁可默认收起，也不要让新手面对 40 个入口。
 * 分层是 UX 分级，不是权限：随时可以一键「显示全部」。
 */
const NAV_LEVEL_BY_HREF: Record<string, 0 | 1 | 2> = {
  "/today": 0,
  "/dashboard": 0,
  "/quickstart": 0,
  "/offers": 0,
  "/offers/new": 0,
  "/networks": 0,
  "/catalog": 0,
  "/keywords/starter": 0,

  "/reports/weekly": 1,
  "/kill-rules": 1,
  "/link-health": 1,
  "/payout-watch": 1,
  "/search-terms": 1,
  "/conversions": 1,
  "/landing-pages": 1,
  "/cost-ledger": 1,
  "/clicks": 1,
  "/campaigns": 1,
  "/ads/auto-create": 1,
  "/ai/blueprint": 1,
  "/tracking-links": 1,
};

export const NAV_LEVEL_STORAGE_KEY = "adll_nav_level";

/** href → 层级；只比路径部分，忽略 ?tab= 之类的查询串。 */
export function navLevelOfHref(href: string): 0 | 1 | 2 {
  const base = href.split("?")[0];
  return NAV_LEVEL_BY_HREF[base] ?? 2;
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

  // 默认第 0 层（新手）。localStorage 只是本机偏好，不涉及权限。
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_LEVEL_STORAGE_KEY);
      const n = Number(raw);
      if (n === 1 || n === 2) setLevel(n);
    } catch {
      // 隐私模式下读不到就保持默认，不影响使用。
    }
  }, []);
  // 毕业进度：跑够一定量后提示解锁下一层。每会话只查一次（sessionStorage 缓存），
  // 避免每次导航都打一个请求。建议层 <= 当前层时不显示。
  const [progress, setProgress] = useState<NavProgress | null>(null);
  const [gradDismissed, setGradDismissed] = useState<number>(-1);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("adll_nav_progress");
      if (raw) setProgress(JSON.parse(raw) as NavProgress);
      const d = Number(localStorage.getItem("adll_nav_grad_dismiss"));
      if (Number.isFinite(d)) setGradDismissed(d);
    } catch {
      // 忽略缓存读取失败
    }
  }, []);
  useEffect(() => {
    if (level >= 2) return;
    let alive = true;
    getNavProgressAction().then((r) => {
      if (!alive || !r.ok) return;
      setProgress(r.data);
      try {
        sessionStorage.setItem("adll_nav_progress", JSON.stringify(r.data));
      } catch {
        // 忽略
      }
    });
    return () => {
      alive = false;
    };
  }, [level]);
  const dismissGrad = (to: number) => {
    setGradDismissed(to);
    try {
      localStorage.setItem("adll_nav_grad_dismiss", String(to));
    } catch {
      // 忽略
    }
  };

  const changeLevel = (next: 0 | 1 | 2) => {
    setLevel(next);
    try {
      localStorage.setItem(NAV_LEVEL_STORAGE_KEY, String(next));
    } catch {
      // 忽略写入失败
    }
  };

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

  // 第 0/1 层：扁平短列表（这才是「收窄」的体感）。
  // 第 2 层：回到原来的分区折叠导航。
  if (level < 2) {
    const seen = new Set<string>();
    const flat = sections
      .flatMap((s) => s.items)
      .filter((item) => navLevelOfHref(item.href) <= level)
      .filter((item) => {
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      });
    return (
      <div className="flex flex-col gap-0.5">
        {flat.map((item) => {
          const active = isActiveItem(item, path);
          return (
            <Link
              key={item.href}
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
          );
        })}
        {progress &&
          progress.suggestedLevel > level &&
          gradDismissed < progress.suggestedLevel && (
            <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              <p className="font-medium">可以解锁更多了</p>
              <p className="mt-0.5 text-amber-100/80">
                {progress.reasons.join("，")}
              </p>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => changeLevel(progress.suggestedLevel)}
                  className="rounded bg-amber-400/20 px-2 py-0.5 text-amber-50 hover:bg-amber-400/30"
                >
                  解锁
                </button>
                <button
                  type="button"
                  onClick={() => dismissGrad(progress.suggestedLevel)}
                  className="rounded px-2 py-0.5 text-amber-100/70 hover:bg-white/5"
                >
                  以后再说
                </button>
              </div>
            </div>
          )}
        <button
          type="button"
          onClick={() => changeLevel(level === 0 ? 1 : 2)}
          className="mt-3 rounded-md px-3 py-2 text-left text-xs text-mist/50 transition hover:bg-white/5 hover:text-mist/80"
        >
          {level === 0 ? "显示更多（运营模块）" : "显示全部功能"}
        </button>
      </div>
    );
  }

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
      <button
        type="button"
        onClick={() => changeLevel(0)}
        className="mt-3 rounded-md px-3 py-2 text-left text-xs text-mist/50 transition hover:bg-white/5 hover:text-mist/80"
      >
        只看核心（新手视图）
      </button>
    </div>
  );
}
