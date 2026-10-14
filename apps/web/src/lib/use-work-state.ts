"use client";

/**
 * 工作台自动保存共享 hook：挂载时恢复最新快照，变化后防抖保存，提供历史入口。
 * 解决刷新/隔夜后工作进度丢失的问题。保存失败静默，不打断用户操作。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listWorkStateHistoryAction,
  loadWorkStateAction,
  saveWorkStateAction,
  type WorkStateHistoryItem,
  type WorkStatePage,
} from "./api/work-state-actions";

export interface UseWorkStateOptions {
  page: WorkStatePage;
  /** 当前 offer（可变；切换 offer 时保存 key 跟着变） */
  offerId: string | null;
  /** 历史列表里显示的名字 */
  label: string | null;
  /** 构造快照 */
  buildSnapshot: () => Record<string, unknown>;
  /** 快照是否有实质内容（空页面不保存，避免历史里一堆空记录） */
  isMeaningful: (s: Record<string, unknown>) => boolean;
  /** 把快照应用到组件 state */
  applySnapshot: (s: Record<string, unknown>) => void;
  /** 触发防抖保存的依赖（通常是全部 state 变量） */
  watch: unknown[];
}

export function useWorkState(opts: UseWorkStateOptions) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<WorkStateHistoryItem[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  /** 挂载恢复尝试已完成（无论有没有找到快照）。调用方可据此在恢复后应用外部传入值。 */
  const [restored, setRestored] = useState(false);
  const loadedRef = useRef(false);
  const lastSavedRef = useRef("");
  // 回调用 ref 存，避免 effect 依赖抖动
  const cbRef = useRef(opts);
  cbRef.current = opts;

  // 挂载时恢复该 offer 的最新快照
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { page, offerId, isMeaningful, applySnapshot } = cbRef.current;
        const res = await loadWorkStateAction(page, offerId);
        if (cancelled || !res.ok || !res.data.state) return;
        if (!isMeaningful(res.data.state)) return;
        applySnapshot(res.data.state);
        setRestoredAt(res.data.updatedAt);
        lastSavedRef.current = JSON.stringify(res.data.state);
      } catch {
        /* 恢复失败不打断页面 */
      } finally {
        if (!cancelled) {
          loadedRef.current = true;
          setRestored(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防抖自动保存（2.5s）
  useEffect(() => {
    if (!loadedRef.current) return;
    const { page, offerId, label, buildSnapshot, isMeaningful } = cbRef.current;
    const snap = buildSnapshot();
    if (!isMeaningful(snap)) return;
    const json = JSON.stringify(snap);
    if (json === lastSavedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        const res = await saveWorkStateAction(page, snap, { offerId, label });
        if (res.ok) lastSavedRef.current = json;
      } catch {
        /* 静默 */
      }
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.watch);

  const toggleHistory = useCallback(async () => {
    setHistoryOpen((o) => {
      if (!o) {
        listWorkStateHistoryAction(cbRef.current.page, { limit: 20 }).then((res) => {
          if (res.ok) setHistoryItems(res.data);
        });
      }
      return !o;
    });
  }, []);

  const restoreFromHistory = useCallback(async (item: WorkStateHistoryItem) => {
    const { page, isMeaningful, applySnapshot } = cbRef.current;
    const res = await loadWorkStateAction(page, item.offerId);
    if (res.ok && res.data.state && isMeaningful(res.data.state)) {
      applySnapshot(res.data.state);
      setRestoredAt(res.data.updatedAt);
      lastSavedRef.current = JSON.stringify(res.data.state);
    }
    setHistoryOpen(false);
  }, []);

  return { historyOpen, historyItems, restoredAt, restored, toggleHistory, restoreFromHistory };
}
