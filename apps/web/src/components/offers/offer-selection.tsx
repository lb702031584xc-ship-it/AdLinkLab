"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { deleteOffersAction } from "@/lib/api/entity-actions";
import { prescreenOffersAction } from "@/lib/api/paid-data-actions";

interface SelectionCtxValue {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
}

const SelectionCtx = createContext<SelectionCtxValue | null>(null);

function useSelection() {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error("OfferSelectionProvider 缺失");
  return ctx;
}

export function OfferSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, setAll, clear }),
    [selected, toggle, setAll, clear]
  );
  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

/** 行内复选框（表格第一列） */
export function OfferRowCheckbox({ offerId }: { offerId: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(offerId)}
      onChange={() => toggle(offerId)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 accent-blue-600"
      aria-label="选择"
    />
  );
}

/** 表头全选框 */
export function OfferSelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useSelection();
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allChecked}
      onChange={(e) => setAll(ids, e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 accent-blue-600"
      aria-label="全选"
    />
  );
}

/** 批量操作条：有选中时显示 */
export function OfferBatchDeleteBar({
  dict,
}: {
  dict: {
    selectedCount: string;
    deleteSelected: string;
    deleteSelectedConfirm: string;
    deleting: string;
  };
}) {
  const { selected, clear } = useSelection();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const n = selected.size;
  if (n === 0) return null;

  const onDelete = async () => {
    if (!window.confirm(dict.deleteSelectedConfirm.replace("{n}", String(n)))) return;
    setBusy(true);
    try {
      const result = await deleteOffersAction([...selected]);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      clear();
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50/60 px-4 py-2.5">
      <span className="text-sm font-medium text-ink">
        {dict.selectedCount.replace("{n}", String(n))}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? dict.deleting : dict.deleteSelected}
      </button>
      <button
        type="button"
        onClick={clear}
        className="text-sm text-ink/60 hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}

/** 批量一键初筛条：有选中时显示；跑同一阶梯，结论徽标写回 Offer 后刷新列表。 */
export function OfferPrescreenBar({
  dict,
}: {
  dict: {
    prescreenBatch: string;
    prescreenBatching: string;
    prescreenBatchDone: string;
  };
}) {
  const { selected } = useSelection();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = selected.size;
  if (n === 0 && !note) return null;

  const onPrescreen = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await prescreenOffersAction([...selected]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const c = result.data.counts;
      setNote(
        dict.prescreenBatchDone
          .replace("{g}", String(c.go))
          .replace("{u}", String(c.unknown))
          .replace("{s}", String(c.stop))
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-2.5">
      {n > 0 && (
        <button
          type="button"
          onClick={onPrescreen}
          disabled={busy}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-85 disabled:opacity-50"
        >
          {busy ? dict.prescreenBatching : `${dict.prescreenBatch} (${n})`}
        </button>
      )}
      {note && <span className="text-sm text-emerald-700">{note}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
