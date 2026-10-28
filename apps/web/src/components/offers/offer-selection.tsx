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
  type HotPicksResult,
  recommendKeywordsAction,
  type KeywordRecommendResult,
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
    hotPicksTitle: string;
    hotPicksEmpty: string;
    hotPicksDroppedByBrand: string;
    hotPicksExcludedHint: string;
    /** 经济性与需求证据标签（2026-10-27 补） */
    looseEpc: string;
    looseCvr: string;
    looseCpc: string;
    looseRating: string;
    looseReviews: string;
    looseMonthlySales: string;
    economicsLabel: string;
    breakevenCvrLabel: string;
    epcSourceLabel: string;
    paidLayerSkipped: string;
    paidLayerSkippedHint: string;
    beginnerTitle: string;
    beginnerHint: string;
    beginnerBudget: string;
    beginnerCpc: string;
    beginnerPayout: string;
    beginnerPayback: string;
    beginnerStop: string;
    beginnerBreakeven: string;
    beginnerNeededClicks: string;
    beginnerNeededBudget: string;
    beginnerGo: string;
    beginnerMarginal: string;
    beginnerNo: string;
    beginnerNeedAnswers: string;
    advancedOn: string;
    advancedOff: string;
    kwGenerate: string;
    kwGenerating: string;
    kwKeyword: string;
    kwIntent: string;
    kwMaxCpc: string;
    kwVerdict: string;
    kwNote: string;
    kwNoResult: string;
    kwIntentTransactional: string;
    kwIntentCommercial: string;
    kwIntentInformational: string;
    kwVerdictTest: string;
    kwVerdictSkip: string;
    kwVerdictBlocked: string;
    beginnerOffersTestable: string;
    prescreenGoTitle: string;
    beginnerSpreadWarning: string;
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
    Record<
      string,
      {
        seasonal: string;
        stock: string;
        traffic: string;
        epc: string;
        cvr: string;
        cpc: string;
        rating: string;
        reviews: string;
        sales: string;
      }
    >
  >({});
  const [paidNotice, setPaidNotice] = useState<string | null>(null);
  // 新手体检：6 个问题。答不全就不放行到选品区——这就是
  // 「答不上来的人不该看到 90% 界面」的落地。
  const [beginner, setBeginner] = useState({
    budget: "",
    cpc: "",
    payout: "",
    payback: "",
    stop: "",
  });
  const [advanced, setAdvanced] = useState(false);
  const [kwBusy, setKwBusy] = useState(false);
  const [kwResults, setKwResults] = useState<KeywordRecommendResult[]>([]);
  // 初筛结论留存（含 go 的 offerId），用于「筛完直接生成关键词」，
  // 避免用户重新勾选一遍。
  const [prescreenOutcomes, setPrescreenOutcomes] = useState<
    Array<{ offerId: string; verdict: "go" | "unknown" | "stop"; reason: string }>
  >([]);
  const beginnerReady = Object.values(beginner).every((v) => v.trim() !== "");
  // 拒单率 / 退款率按保守值扣减；只在体检里用，不写回任何数据。
  const beginnerAssess = (() => {
    if (!beginnerReady) return null;
    const budget = Number(beginner.budget);
    const cpc = Number(beginner.cpc);
    const payout = Number(beginner.payout);
    if (!(budget > 0) || !(cpc > 0) || !(payout > 0)) return null;
    const netPayout = payout * (1 - 0.15) * (1 - 0.05);
    const breakevenCvr = (cpc / netPayout) * 100;
    // 判断 CVR 至少要看 100 次转化；按 2.5% 算 = 4000 点击。
    const neededClicks = Math.ceil(100 / 0.025);
    const neededBudget = neededClicks * cpc;
    const level: "go" | "marginal" | "no" =
      breakevenCvr <= 5 ? "go" : breakevenCvr <= 10 ? "marginal" : "no";
    return {
      breakevenCvr,
      neededClicks,
      neededBudget,
      level,
      budgetEnough: budget >= neededBudget,
      // 这批预算最多够测几个 offer（每个都要跑到 100 转化才算有结论）
      offersTestable: Math.floor(budget / neededBudget),
    };
  })();
  const [looseDetails, setLooseDetails] = useState<LooseScreenResult | null>(
    null
  );
  const [hotPicks, setHotPicks] = useState<HotPicksResult | null>(null);
  const n = selected.size;
  if (n === 0 && !note) return null;

  const selectedOffers = offers.filter((o) => selected.has(o.id));

  const setEvidenceField = (id: string, field: string, value: string) => {
    setEvidence((prev) => {
      const cur = prev[id] ?? {
        seasonal: "",
        stock: "",
        traffic: "",
        epc: "",
        cvr: "",
        cpc: "",
        rating: "",
        reviews: "",
        sales: "",
      };
      return { ...prev, [id]: { ...cur, [field]: value } };
    });
  };

  /**
   * 把表单证据拼成 API 的 evidence 结构。
   * 数字项只在 >0 时提交，空串/非法值一律不发——宁缺勿造。
   * EPC / CVR 是人工假设；CPC 是经济性判定（保本 CVR）的必要输入。
   */
  const buildEvidence = (): LooseScreenEvidence => {
    const ev: LooseScreenEvidence = {
      seasonal: {},
      stock: {},
      lowPriceTraffic: {},
      epcUsd: {},
      conversionRate: {},
      cpc: {},
      rating: {},
      reviewCount: {},
      monthlySales: {},
    };
    const putNum = (target: Record<string, number>, id: string, raw: string) => {
      const v = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(v) && v > 0) target[id] = v;
    };
    for (const id of selected) {
      const e = evidence[id];
      if (!e) continue;
      if (e.seasonal.trim()) ev.seasonal![id] = e.seasonal.trim();
      if (e.stock === "in_stock" || e.stock === "out_of_stock")
        ev.stock![id] = e.stock;
      if (e.traffic === "winnable" || e.traffic === "not_winnable")
        ev.lowPriceTraffic![id] = e.traffic;
      putNum(ev.epcUsd!, id, e.epc);
      putNum(ev.conversionRate!, id, e.cvr);
      putNum(ev.cpc!, id, e.cpc);
      putNum(ev.rating!, id, e.rating);
      putNum(ev.reviewCount!, id, e.reviews);
      putNum(ev.monthlySales!, id, e.sales);
    }
    return ev;
  };

  /**
   * 关键词推荐：按当前勾选的 Offer 逐个取候选词（最多 5 个，避免一次
   * 打太多请求）。结果只展示，不写回任何东西。
   */
  const onKeywords = async () => {
    setKwBusy(true);
    setError(null);
    try {
      const ids = [...selected].slice(0, 5);
      const out: KeywordRecommendResult[] = [];
      for (const id of ids) {
        const r = await recommendKeywordsAction(id);
        if (r.ok) out.push(r.data);
      }
      setKwResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setKwBusy(false);
    }
  };

  /** 单条：初筛结果里点「生成关键词」直接用这个 offerId 调。 */
  const onKeywordsFor = async (offerId: string) => {
    setKwBusy(true);
    setError(null);
    try {
      const r = await recommendKeywordsAction(offerId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setKwResults((prev) => [
        r.data,
        ...prev.filter((x) => x.offerId !== offerId),
      ]);
    } finally {
      setKwBusy(false);
    }
  };

  const kwIntentLabel = (v: string): string =>
    v === "transactional"
      ? dict.kwIntentTransactional
      : v === "commercial"
        ? dict.kwIntentCommercial
        : dict.kwIntentInformational;

  const kwVerdictLabel = (v: string): string =>
    v === "test"
      ? dict.kwVerdictTest
      : v === "skip"
        ? dict.kwVerdictSkip
        : dict.kwVerdictBlocked;

  const onPrescreen = async () => {
    setBusy(true);
    setError(null);
    try {
      const splitList = (s: string) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      const result = await prescreenOffersAction([...selected], {
        excludedBrands: splitList(excludedBrands),
        excludedCategories: splitList(excludedCategories),
        evidence: buildEvidence(),
      });
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
      setHotPicks(result.data.hotPicks ?? null);
      setPrescreenOutcomes(result.data.outcomes ?? []);
      setPaidNotice(
        result.data.skippedPaidLayer
          ? `${dict.paidLayerSkipped}${
              result.data.paidLayerError ? `（${result.data.paidLayerError}）` : ""
            }${dict.paidLayerSkippedHint}`
          : null
      );
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
      const ev = buildEvidence();
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
      setHotPicks(null);
      setPaidNotice(null);
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
        {n > 0 && (
          <button
            type="button"
            onClick={onKeywords}
            disabled={kwBusy}
            className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
          >
            {kwBusy ? dict.kwGenerating : `${dict.kwGenerate} (${Math.min(n, 5)})`}
          </button>
        )}
        {note && <span className="text-sm text-emerald-700">{note}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {paidNotice && (
        <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {paidNotice}
        </p>
      )}
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
          {/* ── 新手体检：6 问 ── */}
          <div className="rounded-lg border border-ink/10 bg-white/60 p-3">
            <p className="text-sm font-medium">{dict.beginnerTitle}</p>
            <p className="mt-0.5 text-xs text-ink/60">{dict.beginnerHint}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {([
                ["budget", dict.beginnerBudget],
                ["cpc", dict.beginnerCpc],
                ["payout", dict.beginnerPayout],
                ["payback", dict.beginnerPayback],
                ["stop", dict.beginnerStop],
              ] as Array<[keyof typeof beginner, string]>).map(([key, label]) => (
                <label key={key} className="text-ink/60">
                  {label}{" "}
                  <input
                    value={beginner[key]}
                    onChange={(ev) =>
                      setBeginner((b) => ({ ...b, [key]: ev.target.value }))
                    }
                    inputMode={key === "stop" ? "text" : "decimal"}
                    className="w-24 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            {beginnerAssess && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span
                  className={
                    beginnerAssess.level === "go"
                      ? "font-medium text-emerald-700"
                      : beginnerAssess.level === "marginal"
                        ? "font-medium text-amber-700"
                        : "font-medium text-red-600"
                  }
                >
                  {beginnerAssess.level === "go"
                    ? dict.beginnerGo
                    : beginnerAssess.level === "marginal"
                      ? dict.beginnerMarginal
                      : dict.beginnerNo}
                </span>
                <span className="text-ink/70">
                  {dict.beginnerBreakeven} {beginnerAssess.breakevenCvr.toFixed(1)}%
                </span>
                <span className="text-ink/60">
                  {dict.beginnerNeededClicks} {beginnerAssess.neededClicks}
                </span>
                <span className="text-ink/60">
                  {dict.beginnerNeededBudget} ${beginnerAssess.neededBudget.toFixed(0)}
                </span>
                <span className="text-ink/60">
                  {dict.beginnerOffersTestable} {beginnerAssess.offersTestable}
                </span>
                {beginnerAssess.offersTestable <= 1 && (
                  <span className="w-full text-xs text-red-600">
                    {dict.beginnerSpreadWarning}
                  </span>
                )}
                {!beginnerAssess.budgetEnough && (
                  <span className="text-xs text-red-600">
                    预算不足：至少需要 ${beginnerAssess.neededBudget.toFixed(0)} 才能判断这个 offer
                  </span>
                )}
              </div>
            )}
          </div>
          {!beginnerReady && (
            <p className="text-sm text-amber-700">{dict.beginnerNeedAnswers}</p>
          )}
          {beginnerReady && selectedOffers.map((o) => {
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
                <button
                  type="button"
                  onClick={() => setAdvanced((v) => !v)}
                  className="rounded-lg border border-ink/10 px-2 py-1 text-xs text-ink/60"
                >
                  {advanced ? dict.advancedOff : dict.advancedOn}
                </button>
                {advanced && (
                  <>
                {/* 以下为经济性与需求证据：空着就是 unknown，不会被当成 0 */}
                <label className="text-ink/60">
                  {dict.looseEpc}{" "}
                  <input
                    value={e.epc}
                    onChange={(ev) => setEvidenceField(o.id, "epc", ev.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
                <label className="text-ink/60">
                  {dict.looseCvr}{" "}
                  <input
                    value={e.cvr}
                    onChange={(ev) => setEvidenceField(o.id, "cvr", ev.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
                <label className="text-ink/60">
                  {dict.looseCpc}{" "}
                  <input
                    value={e.cpc}
                    onChange={(ev) => setEvidenceField(o.id, "cpc", ev.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
                <label className="text-ink/60">
                  {dict.looseRating}{" "}
                  <input
                    value={e.rating}
                    onChange={(ev) => setEvidenceField(o.id, "rating", ev.target.value)}
                    inputMode="decimal"
                    className="w-14 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
                <label className="text-ink/60">
                  {dict.looseReviews}{" "}
                  <input
                    value={e.reviews}
                    onChange={(ev) => setEvidenceField(o.id, "reviews", ev.target.value)}
                    inputMode="numeric"
                    className="w-16 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
                <label className="text-ink/60">
                  {dict.looseMonthlySales}{" "}
                  <input
                    value={e.sales}
                    onChange={(ev) => setEvidenceField(o.id, "sales", ev.target.value)}
                    inputMode="numeric"
                    className="w-16 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink"
                  />
                </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {mode === "default" && n > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
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
          <span className="text-xs text-ink/60">{dict.hotPicksExcludedHint}</span>
        </div>
      )}
      {prescreenOutcomes.some((o) => o.verdict === "go") && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink/60">{dict.prescreenGoTitle}</span>
          {prescreenOutcomes
            .filter((o) => o.verdict === "go")
            .slice(0, 10)
            .map((o) => (
              <button
                key={o.offerId}
                type="button"
                onClick={() => onKeywordsFor(o.offerId)}
                disabled={kwBusy}
                className="rounded-lg border border-ink/20 px-2 py-1 text-xs text-ink transition hover:bg-ink/5 disabled:opacity-50"
              >
                {offers.find((x) => x.id === o.offerId)?.name ?? o.offerId}
                {" · "}
                {dict.kwGenerate}
              </button>
            ))}
        </div>
      )}
      {kwResults.length > 0 && (
        <div className="flex flex-col gap-3 text-sm">
          {kwResults.map((r) => (
            <div key={r.offerId} className="rounded-lg border border-ink/10 p-3">
              <p className="font-medium">
                {r.core}
                {r.maxCpcUsd != null && (
                  <span className="ml-2 text-ink/60">
                    {dict.kwMaxCpc} {"<="} ${r.maxCpcUsd.toFixed(2)}
                  </span>
                )}
              </p>
              {r.suggestions.length === 0 ? (
                <p className="mt-1 text-ink/60">{dict.kwNoResult}</p>
              ) : (
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink/60">
                      <th className="py-1 pr-3">{dict.kwKeyword}</th>
                      <th className="py-1 pr-3">{dict.kwIntent}</th>
                      <th className="py-1 pr-3">{dict.kwMaxCpc}</th>
                      <th className="py-1 pr-3">{dict.kwVerdict}</th>
                      <th className="py-1">{dict.kwNote}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.suggestions.map((k) => (
                      <tr key={k.keyword} className="border-t border-ink/5">
                        <td className="py-1 pr-3">{k.keyword}</td>
                        <td className="py-1 pr-3">{kwIntentLabel(k.intent)}</td>
                        <td className="py-1 pr-3">
                          {k.maxCpcUsd != null ? `${k.maxCpcUsd.toFixed(2)}` : "—"}
                        </td>
                        <td
                          className={
                            k.verdict === "test"
                              ? "py-1 pr-3 text-emerald-700"
                              : k.verdict === "skip"
                                ? "py-1 pr-3 text-ink/50"
                                : "py-1 pr-3 text-red-600"
                          }
                        >
                          {kwVerdictLabel(k.verdict)}
                        </td>
                        <td className="py-1 text-ink/60">{k.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {r.notes.length > 0 && (
                <p className="mt-1 text-xs text-ink/50">{r.notes.join("；")}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {hotPicks && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{dict.hotPicksTitle}</p>
          {hotPicks.picks.length === 0 && (
            <p className="text-ink/60">{dict.hotPicksEmpty}</p>
          )}
          {hotPicks.picks.map((p) => (
            <p key={p.offerId}>
              <span className="font-medium">{p.name}</span>
              {`（${p.reasons.join("；")}）`}
              {p.verdictNote && (
                <span className="text-ink/60">{` — ${p.verdictNote}`}</span>
              )}
              {p.riskCost.length > 0 && (
                <span className="text-ink/60">{`（风险：${p.riskCost.join("、")}）`}</span>
              )}
            </p>
          ))}
          {hotPicks.droppedByBrand.length > 0 && (
            <p>
              <span className="font-medium">{dict.hotPicksDroppedByBrand}：</span>
              {hotPicks.droppedByBrand
                .map((d) => `${d.name}（${d.reasons.join("；")}）`)
                .join("、")}
            </p>
          )}
        </div>
      )}
      {looseDetails && (
        <div className="flex flex-col gap-1 text-sm">
          {looseDetails.qualified.length > 0 && (
            <p>
              <span className="font-medium">{dict.looseQualified}：</span>
              {looseDetails.qualified
                .map((q) => {
                  const parts = [`${q.commissionUsd}`];
                  if (q.economics && q.economics !== "unknown")
                    parts.push(`${dict.economicsLabel} ${q.economics}`);
                  if (typeof q.breakevenCvr === "number")
                    parts.push(
                      `${dict.breakevenCvrLabel} ${q.breakevenCvr.toFixed(1)}%`
                    );
                  if (q.epcSource)
                    parts.push(`${dict.epcSourceLabel}:${q.epcSource}`);
                  return `${q.name}（${parts.join("，")}）`;
                })
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
