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
import {
  looseScreenOffersAction,
  prescreenOffersAction,
  type LooseScreenEvidence,
  type LooseScreenResult,
} from "@/lib/api/paid-data-actions";

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

/** 批量一键初筛条：有选中时显示；跑同一阶梯，结论徽标写回 Offer 后刷新列表。
 *  宽松型模式走同一接口的 mode=loose：只作本轮筛查报告，不写回徽标，
 *  需逐条填当季热销依据与库存（无依据的条会被排除）。 */
export function OfferPrescreenBar({
  dict,
  offers,
}: {
  dict: {
    prescreenBatch: string;
    prescreenBatching: string;
    prescreenBatchDone: string;
    prescreenMode: string;
    prescreenModeDefault: string;
    prescreenModeLoose: string;
    looseScreening: string;
    looseScreenDone: string;
    looseMinCommission: string;
    looseExcludedBrands: string;
    looseExcludedCategories: string;
    looseSeasonalEvidence: string;
    looseSeasonalHint: string;
    looseStock: string;
    looseStockUnknown: string;
    looseStockIn: string;
    looseStockOut: string;
    looseTraffic: string;
    looseTrafficUnknown: string;
    looseTrafficWinnable: string;
    looseTrafficNotWinnable: string;
    looseQualified: string;
    looseDropped: string;
  };
  offers: Array<{ id: string; name: string }>;
}) {
  const { selected } = useSelection();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"default" | "loose">("default");
  const [minCommission, setMinCommission] = useState("3");
  const [excludedBrands, setExcludedBrands] = useState("");
  const [excludedCategories, setExcludedCategories] = useState("");
  const [evidence, setEvidence] = useState<
    Record<string, { seasonal: string; stock: string; traffic: string }>
  >({});
  const [looseDetails, setLooseDetails] = useState<LooseScreenResult | null>(
    null
  );
  const n = selected.size;
  if (n === 0 && !note) return null;

  const selectedOffers = offers.filter((o) => selected.has(o.id));

  const setEvidenceField = (id: string, field: string, value: string) => {
    setEvidence((prev) => {
      const cur = prev[id] ?? { seasonal: "", stock: "", traffic: "" };
      return { ...prev, [id]: { ...cur, [field]: value } };
    });
  };

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
      setLooseDetails(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLooseScreen = async () => {
    setBusy(true);
    setError(null);
    try {
      const ev: LooseScreenEvidence = {
        seasonal: {},
        stock: {},
        lowPriceTraffic: {},
      };
      for (const id of selected) {
        const e = evidence[id];
        if (!e) continue;
        if (e.seasonal.trim()) ev.seasonal![id] = e.seasonal.trim();
        if (e.stock === "in_stock" || e.stock === "out_of_stock")
          ev.stock![id] = e.stock;
        if (e.traffic === "winnable" || e.traffic === "not_winnable")
          ev.lowPriceTraffic![id] = e.traffic;
      }
      const splitList = (s: string) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      const parsedMin = Number(minCommission);
      const result = await looseScreenOffersAction([...selected], {
        ...(Number.isFinite(parsedMin) && parsedMin > 0
          ? { minCommissionUsd: parsedMin }
          : {}),
        excludedBrands: splitList(excludedBrands),
        excludedCategories: splitList(excludedCategories),
        evidence: ev,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const c = result.data.counts;
      setNote(
        dict.looseScreenDone
          .replace("{q}", String(c.qualified))
          .replace("{d}", String(c.dropped))
      );
      setLooseDetails(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-ink/60">
          {dict.prescreenMode}{" "}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "default" | "loose")}
            className="rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
          >
            <option value="default">{dict.prescreenModeDefault}</option>
            <option value="loose">{dict.prescreenModeLoose}</option>
          </select>
        </label>
        {n > 0 && (
          <button
            type="button"
            onClick={mode === "loose" ? onLooseScreen : onPrescreen}
            disabled={busy}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-85 disabled:opacity-50"
          >
            {busy
              ? mode === "loose"
                ? dict.looseScreening
                : dict.prescreenBatching
              : mode === "loose"
                ? `${dict.prescreenModeLoose} (${n})`
                : `${dict.prescreenBatch} (${n})`}
          </button>
        )}
        {note && <span className="text-sm text-emerald-700">{note}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {mode === "loose" && n > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="text-ink/60">
              {dict.looseMinCommission}{" "}
              <input
                value={minCommission}
                onChange={(e) => setMinCommission(e.target.value)}
                inputMode="decimal"
                className="w-20 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="text-ink/60">
              {dict.looseExcludedBrands}{" "}
              <input
                value={excludedBrands}
                onChange={(e) => setExcludedBrands(e.target.value)}
                className="w-48 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="text-ink/60">
              {dict.looseExcludedCategories}{" "}
              <input
                value={excludedCategories}
                onChange={(e) => setExcludedCategories(e.target.value)}
                className="w-48 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
              />
            </label>
          </div>
          <p className="text-xs text-ink/60">{dict.looseSeasonalHint}</p>
          {selectedOffers.map((o) => {
            const e = evidence[o.id] ?? { seasonal: "", stock: "", traffic: "" };
            return (
              <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-40 max-w-80 truncate font-medium">{o.name}</span>
                <input
                  value={e.seasonal}
                  onChange={(ev) => setEvidenceField(o.id, "seasonal", ev.target.value)}
                  placeholder={dict.looseSeasonalEvidence}
                  className="min-w-52 flex-1 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                />
                <label className="text-ink/60">
                  {dict.looseStock}{" "}
                  <select
                    value={e.stock}
                    onChange={(ev) => setEvidenceField(o.id, "stock", ev.target.value)}
                    className="rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  >
                    <option value="">{dict.looseStockUnknown}</option>
                    <option value="in_stock">{dict.looseStockIn}</option>
                    <option value="out_of_stock">{dict.looseStockOut}</option>
                  </select>
                </label>
                <label className="text-ink/60">
                  {dict.looseTraffic}{" "}
                  <select
                    value={e.traffic}
                    onChange={(ev) => setEvidenceField(o.id, "traffic", ev.target.value)}
                    className="rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  >
                    <option value="">{dict.looseTrafficUnknown}</option>
                    <option value="winnable">{dict.looseTrafficWinnable}</option>
                    <option value="not_winnable">{dict.looseTrafficNotWinnable}</option>
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      )}
      {looseDetails && (
        <div className="flex flex-col gap-1 text-sm">
          {looseDetails.qualified.length > 0 && (
            <p>
              <span className="font-medium">{dict.looseQualified}：</span>
              {looseDetails.qualified
                .map((q) => `${q.name}（$${q.commissionUsd}）`)
                .join("、")}
            </p>
          )}
          {looseDetails.dropped.length > 0 && (
            <p>
              <span className="font-medium">{dict.looseDropped}：</span>
              {looseDetails.dropped
                .map((d) => `${d.name}（${d.reasons.join("；")}）`)
                .join("、")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
