"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { listOfferCapturesAction } from "@/lib/api/ai-actions";
import type { OfferCaptureItem } from "@/lib/api/ai";

/**
 * 浏览器插件抓取记录选用器（多页面共用）。
 * 展开后列出最近 10 条插件抓取，点"选用"把整条记录交给调用方处理。
 * （各页面自己决定用哪几个字段：条款页用正文、合规页用 URL、投流页用标题……）
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
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setLoading(true);
    const res = await listOfferCapturesAction();
    setLoading(false);
    setLoaded(true);
    if (res.ok) setItems(res.data);
  }

  return (
    <div className={className ?? "mt-2"}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!loaded) load();
        }}
        className="text-xs text-ink/60 hover:text-ink"
      >
        {label ?? `🧩 ${d.toggle}`} {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
          {loading ? (
            <p className="text-xs text-ink/50">{d.loading}</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-ink/50">{d.empty}</p>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/60 px-2 py-1.5"
              >
                <div className="min-w-0 text-xs">
                  <p className="truncate font-medium text-ink">{c.title || c.finalUrl}</p>
                  <p className="truncate text-ink/50">
                    {c.price != null ? `${c.price} ${c.currency ?? ""} · ` : ""}
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
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
