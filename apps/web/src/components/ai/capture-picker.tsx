"use client";

import { useRef, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { listOfferCapturesAction } from "@/lib/api/ai-actions";
import type { OfferCaptureItem } from "@/lib/api/ai";

/**
 * 浏览器插件抓取记录选用器（多页面共用）。
 * 展开后列出最近 10 条插件抓取，点"选用"把整条记录交给调用方处理。
 * （各页面自己决定用哪几个字段：条款页用正文、合规页用 URL、投流页用标题……）
 * 加载带 20 秒超时 + 失败提示 + 重试：任何情况下都不永久卡在"加载中"。
 * 每次展开都重新拉列表 + 面板内可手动刷新：插件新抓的记录不用整页刷新就能出现。
 */
export function CapturePicker({
  onPick,
  label,
  className,
}: {
  onPick: (c: OfferCaptureItem) => void;
  /** 自定义按钮文案；不传则用默认“浏览器插件抓取记录”。 */
  label?: string;
  /** 外层容器 class，默认 mt-2；嵌入卡片头部时传 "" 取消间距。 */
  className?: string;
}) {
  const t = useDict();
  const d = t.ai.captures;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OfferCaptureItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  async function load() {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      // 超时兜底：请求挂起时 20 秒后也结束 loading，显示重试
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000));
      const res = await Promise.race([listOfferCapturesAction(), timeout]);
      if (req !== reqRef.current) return; // 已有更新的请求，丢弃过期结果
      if (res === null) {
        setError(d.loadTimeout);
      } else if (res.ok) {
        setItems(res.data);
      } else {
        setError(res.error || d.loadFailed);
      }
    } catch {
      if (req === reqRef.current) setError(d.loadFailed);
    } finally {
      if (req === reqRef.current) {
        setLoading(false);
      }
    }
  }

  return (
    <div className={className ?? "mt-2"}>
      <button
        type="button"
        onClick={() => {
          // 每次展开都重拉：插件刚抓的新记录不用整页刷新就能出现
          if (!open) load();
          setOpen(!open);
        }}
        className="text-xs text-ink/60 hover:text-ink"
      >
        {label ?? `🧩 ${d.toggle}`} {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink/50">
              {items.length > 0 ? `${items.length} ${d.recordsUnit}` : ""}
            </p>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="text-xs text-ink/60 hover:text-ink disabled:opacity-50"
            >
              🔄 {d.refresh}
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-ink/50">{d.loading}</p>
          ) : error ? (
            <p className="text-xs text-red-600">
              {error}{" "}
              <button type="button" onClick={load} className="underline hover:text-red-800">
                {d.retry}
              </button>
            </p>
          ) : items.length === 0 ? (
            <p className="text-xs text-ink/50">{d.empty}</p>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-2 rounded-md bg-white/60 px-2 py-1.5"
              >
                <div className="min-w-0 text-xs">
                  <p className="truncate font-medium text-ink">{c.title || c.finalUrl}</p>
                  <p className="truncate text-ink/50">
                    {c.price != null ? `${c.price} ${c.currency ?? ""} · ` : ""}
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                  {c.text ? (
                    <p className="mt-0.5 line-clamp-2 text-ink/60" title={c.text}>
                      {c.text}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="shrink-0 rounded-md border border-ink/15 px-2 py-1 text-xs text-ink hover:bg-ink/5"
                >
                  {d.use}
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
