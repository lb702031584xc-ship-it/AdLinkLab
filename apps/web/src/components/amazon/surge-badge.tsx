"use client";

/**
 * 需求异动徽标（第十批）：pipeline 页顶部，有异动时提醒。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { listAsinWatchesAction } from "@/lib/api/asin-watch-actions";

export function SurgeBadge({ label }: { label: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAsinWatchesAction().then((r) => {
      if (cancelled || !r.ok) return;
      setCount(r.data.items.filter((i) => i.surged).length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null || count === 0) return null;

  return (
    <Link
      href="/amazon/discovery?tab=watch"
      className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-200"
    >
      🔥 {label}：{count}
    </Link>
  );
}
