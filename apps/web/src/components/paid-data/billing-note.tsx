"use client";

/**
 * 付费数据计费路径标注：挂载时向网关预告接口确认本功能的计费路径，
 * 显示在付费按钮旁（「使用平台额度·剩余 X 次」/「使用我的 DataForSEO」/
 * 「站长直通」/ 未授权提示两条路）。只判定不消费。
 * 文案由父组件从字典传入（纯字符串，可序列化）。
 */
import { useEffect, useState } from "react";
import {
  getPaidDataAccessAction,
  type PaidDataAccessInfo,
  type PaidDataFeatureKey,
} from "@/lib/api/paid-data-actions";

export interface BillingNoteLabels {
  platform: string;
  platformNoLimit: string;
  tenantOwn: string;
  owner: string;
  denied: string;
  loading: string;
}

export function billingNoteText(
  info: PaidDataAccessInfo | null,
  labels: BillingNoteLabels
): string {
  if (!info) return labels.loading;
  if (!info.allowed) return labels.denied;
  if (info.keySource === "owner") return labels.owner;
  if (info.keySource === "tenant-own") return labels.tenantOwn;
  if (info.remainingCalls !== null) {
    return labels.platform.replace("{n}", String(info.remainingCalls));
  }
  return labels.platformNoLimit;
}

export function PaidDataBillingNote({
  feature,
  labels,
  className,
}: {
  feature: PaidDataFeatureKey;
  labels: BillingNoteLabels;
  className?: string;
}) {
  const [info, setInfo] = useState<PaidDataAccessInfo | null>(null);
  useEffect(() => {
    let alive = true;
    getPaidDataAccessAction(feature)
      .then((r) => {
        if (alive && r.ok) setInfo(r.data);
      })
      .catch(() => {
        /* 预告失败不阻塞页面，标注停留在确认中 */
      });
    return () => {
      alive = false;
    };
  }, [feature]);
  const denied = info !== null && !info.allowed;
  return (
    <span
      className={
        className ??
        `text-xs ${denied ? "text-red-600" : "text-ink/50"}`
      }
      title={denied ? labels.denied : undefined}
    >
      {billingNoteText(info, labels)}
    </span>
  );
}
