"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as catalogZh, en as catalogEn } from "@/i18n/dict/catalog";
import {
  addBlacklistAction,
  addWhitelistAction,
  addedProductIdsAction,
  backfillCatalogProductsAction,
  batchCreateOffersAction,
  calcAdCountAction,
  calcScoreAction,
  confirmWhitelistAction,
  deleteBlacklistAction,
  deleteWhitelistAction,
  evaluateMerchantsAction,
  getCatalogFunnelAction,
  getScoreCalcPausedAction,
  getSessionStatusAction,
  getSyncJobAction,
  importBlacklistAction,
  listBlacklistAction,
  getProductLaunchCountsAction,
  listCatalogCountriesAction,
  listCatalogProductsAction,
  listMerchantSignalsAction,
  listSyncJobsAction,
  listWhitelistAction,
  moveProductPoolStageAction,
  moveProductsPoolStageAction,
  offlineProductsAction,
  forceSelectProductsAction,
  oneClickScreenAction,
  previewCalcAdCountAction,
  recheckBlacklistAction,
  saveScreeningPresetAction,
  saveSessionCookieAction,
  screenCatalogAction,
  setScoreCalcPausedAction,
  setSyncModeAction,
  syncCatalogAction,
  type BatchCreateResult,
  type BlacklistEntry,
  type BlacklistEntityType,
  type CalcAdCountPreviewResult,
  type CatalogChannel,
  type CatalogFunnel,
  type CatalogNetwork,
  type CatalogProduct,
  type CatalogSyncJob,
  type MerchantEvaluateResult,
  type MerchantSignal,
  type OneClickScreenReport,
  type PoolStage,
  type RecheckResult,
  type ScreeningPreset,
  type SessionStatus,
  type SyncMode,
  type SyncResult,
  type WhitelistEntry,
} from "@/lib/api/catalog-actions";
import { adCountTier } from "../../../../../packages/shared/src/ad-count-tier";
import { PaidDataBillingNote } from "@/components/paid-data/billing-note";
import { OfferTestPriorityCell } from "@/components/offers/offer-test-priority-cell";
import { LaunchHistoryModal } from "./launch-history-modal";
import {
  AdTrendMark,
  CatalogBrandView,
  adLandingSplitText,
  adProbeFields,
} from "./catalog-brand-view";
import {
  CALC_DEPTH_OPTIONS,
  DEFAULT_CALC_DEPTH,
  calcAdCountConfirmFacts,
  formatUsdAmount,
  resolveStoredCalcDepth,
  type CalcAdCountScope,
  type CalcDepth,
} from "./calc-ad-count-confirm";
import {
  localDayRangeToIso,
  localTodayString,
} from "./added-date-range";
import {
  priorityRankFor,
  resolveStoredSort,
  selectableProducts,
} from "./list-helpers";
import Link from "next/link";

type Dict = typeof catalogZh;

/** 一键筛选淘汰总数：报告没有现成合计字段，由五道杀的计数相加推导。 */
function killedTotalOf(r: OneClickScreenReport): number {
  return (
    r.killedBlacklist +
    r.killedCommission +
    r.killedPreset +
    r.killedAdCount +
    r.killedTrafficGate
  );
}

/** 动作抛错时给用户看的错误文本（兜底提示用，异常细节不吞）。 */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 商品列表排序选择的 localStorage 键（变更即写回，下次进页恢复）。 */
const SORT_STORAGE_KEY = "catalog:products-sort";

function readStoredSort(): string | null {
  try {
    return resolveStoredSort(window.localStorage.getItem(SORT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistSort(v: string): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, v);
  } catch {
    /* localStorage 不可用（隐私模式等）时静默降级，不影响列表渲染。 */
  }
}

/** 广告数计算深度选择的 localStorage 键（与排序同持久化风格）。 */
const CALC_DEPTH_STORAGE_KEY = "catalog:calc-depth";

function readStoredCalcDepth(): CalcDepth | null {
  try {
    return resolveStoredCalcDepth(
      window.localStorage.getItem(CALC_DEPTH_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

function persistCalcDepth(v: CalcDepth): void {
  try {
    window.localStorage.setItem(CALC_DEPTH_STORAGE_KEY, String(v));
  } catch {
    /* localStorage 不可用时静默降级，不影响计算。 */
  }
}

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";
const cardCls =
  "rounded-xl border border-ink/10 bg-white p-5 shadow-sm";
const labelCls = "mb-1 block text-xs font-medium text-ink/60";

const MAX_COOKIE_BYTES = 8 * 1024;
const PAGE_SIZE = 20;

const KIND_LABELS: Record<string, string> = {
  partnerboost: "PartnerBoost",
  yeahpromos: "YeahPromos",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind.toLowerCase()] ?? kind;
}

/** 联盟平台缩写（AutoAds 式：PB / YP / AW …），未知取前两位大写。 */
function kindAbbr(kind: string | null | undefined): string {
  const k = (kind ?? "").toLowerCase();
  const map: Record<string, string> = {
    partnerboost: "PB",
    yeahpromos: "YP",
    awin: "AW",
    cj: "CJ",
    shareasale: "SS",
    rakuten: "RK",
    flexoffers: "FO",
    impact: "IM",
    amazon: "AMZ",
  };
  if (map[k]) return map[k];
  const clean = k.replace(/[^a-z]/g, "");
  return clean ? clean.slice(0, 2).toUpperCase() : "—";
}

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function pullStatusColor(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-100 text-emerald-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    case "RUNNING":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-ink/10 text-ink/60";
  }
}

function sessionColor(status: SessionStatus): string {
  switch (status) {
    case "OK":
      return "bg-emerald-100 text-emerald-800";
    case "EXPIRED":
      return "bg-red-100 text-red-800";
    case "FAILED":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-ink/10 text-ink/60";
  }
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(v: number | null): string {
  return v == null ? "—" : String(v);
}

function fmtMoney(v: number | null, currency: string | null): string {
  if (v == null) return "—";
  return `${currency ? currency + " " : ""}${v}`;
}

function fmtRate(v: number | null): string {
  if (v == null) return "—";
  return `${v}%`;
}

function cookieByteLen(v: string): number {
  try {
    return new TextEncoder().encode(v).length;
  } catch {
    return v.length;
  }
}

const ENTITY_TYPES: BlacklistEntityType[] = [
  "merchant",
  "network_account",
  "product",
  "offer",
];

const CHANNELS: CatalogChannel[] = ["cashback", "affiliate", "amazon"];

function channelLabel(d: Dict, c: string): string {
  switch (c) {
    case "cashback":
      return d.channel.cashback;
    case "affiliate":
      return d.channel.affiliate;
    case "amazon":
      return d.channel.amazon;
    default:
      return c;
  }
}

/** 渠道页签：返利网 / 联盟 / 亚马逊。 */
function ChannelTabs({
  d,
  channel,
  onChange,
}: {
  d: Dict;
  channel: CatalogChannel;
  onChange: (c: CatalogChannel) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink/60">{d.channel.label}：</span>
      {CHANNELS.map((c) => (
        <button
          key={c}
          className={
            channel === c
              ? "rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white"
              : btnGhost
          }
          onClick={() => onChange(c)}
        >
          {channelLabel(d, c)}
        </button>
      ))}
    </div>
  );
}

function isObservation(e: { status?: string | null }): boolean {
  return e.status === "removed";
}

function entityTypeLabel(
  d: Dict,
  section: "blacklist" | "whitelist",
  t: string
): string {
  const sec = d[section] as Dict["blacklist"];
  switch (t) {
    case "merchant":
      return sec.typeMerchant;
    case "network_account":
      return sec.typeNetworkAccount;
    case "product":
      return sec.typeProduct;
    case "offer":
      return sec.typeOffer;
    default:
      return t;
  }
}

/** 商家评估区块：渠道评估 + 结果列表 + 每行展开看信号历史（只展示证据，不做判定）。 */
function MerchantEvalBlock({
  d,
  channel,
  showMsg,
}: {
  d: Dict;
  channel: CatalogChannel;
  showMsg: (m: string | null) => void;
}) {
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<MerchantEvaluateResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signals, setSignals] = useState<Record<string, MerchantSignal[]>>({});
  const [signalsLoading, setSignalsLoading] = useState<string | null>(null);

  async function onEvaluate() {
    if (evaluating) return;
    setEvaluating(true);
    showMsg(null);
    try {
      const res = await evaluateMerchantsAction(channel);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setResult(res.data);
      setExpandedId(null);
      showMsg(
        res.data.blacklisted.length > 0
          ? d.blacklist.evalDone
              .replace("{a}", String(res.data.evaluated))
              .replace("{b}", String(res.data.blacklisted.length))
          : d.blacklist.evalEmpty
      );
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setEvaluating(false);
    }
  }

  async function toggleSignals(merchantId: string) {
    if (expandedId === merchantId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(merchantId);
    if (signals[merchantId] || signalsLoading === merchantId) return;
    setSignalsLoading(merchantId);
    try {
      const res = await listMerchantSignalsAction(merchantId, channel);
      if (!res.ok) {
        showMsg(res.error);
        setExpandedId(null);
        return;
      }
      setSignals((m) => ({ ...m, [merchantId]: res.data }));
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
      setExpandedId(null);
    } finally {
      setSignalsLoading(null);
    }
  }

  function fmtPct(v: number | null): string {
    return v == null ? "—" : `${v}%`;
  }

  return (
    <div className="mt-5 rounded-lg border border-ink/10 p-4">
      <p className="font-medium text-ink">{d.blacklist.evalTitle}</p>
      <p className="mt-1 text-xs text-ink/60">{d.blacklist.evalDesc}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className={btnPrimary}
          onClick={onEvaluate}
          disabled={evaluating}
        >
          {evaluating ? d.blacklist.evalRunning : d.blacklist.evalRun}
        </button>
        {result && (
          <span className="text-sm text-ink/70">
            {result.blacklisted.length > 0
              ? d.blacklist.evalDone
                  .replace("{a}", String(result.evaluated))
                  .replace("{b}", String(result.blacklisted.length))
              : d.blacklist.evalEmpty}
          </span>
        )}
      </div>
      {result && result.blacklisted.length > 0 && (
        <div className="mt-3 space-y-2">
          {result.blacklisted.map((m) => {
            const expanded = expandedId === m.merchantId;
            const rows = signals[m.merchantId];
            return (
              <div
                key={m.merchantId}
                className="rounded-lg border border-red-200 bg-red-50/50 p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-ink">
                    {m.merchantName ?? m.merchantId}
                  </span>
                  {m.merchantName && (
                    <span className="font-mono text-xs text-ink/50">
                      {d.blacklist.evalMerchantId}：{m.merchantId}
                    </span>
                  )}
                  <span className="text-sm text-red-700">{m.reason}</span>
                  <button
                    className={`${btnGhost} ml-auto`}
                    onClick={() => toggleSignals(m.merchantId)}
                  >
                    {expanded
                      ? d.blacklist.signalsHide
                      : d.blacklist.signalsToggle}
                  </button>
                </div>
                {expanded && (
                  <div className="mt-3 overflow-x-auto">
                    {signalsLoading === m.merchantId && (
                      <p className="py-2 text-sm text-ink/50">
                        {d.blacklist.signalsLoading}
                      </p>
                    )}
                    {rows && rows.length === 0 && (
                      <p className="py-2 text-sm text-ink/50">
                        {d.blacklist.signalsEmpty}
                      </p>
                    )}
                    {rows && rows.length > 0 && (
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
                            <th className="py-1 pr-2">
                              {d.blacklist.colPeriod}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colOwnConversions}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colNetworkOrders}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colShavePct}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colAdSpend}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colCommission}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colRoas}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colPendingOrders}
                            </th>
                            <th className="py-1 pr-2">
                              {d.blacklist.colOldestPendingDays}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((s) => (
                            <tr
                              key={`${s.periodStart}-${s.periodDays}`}
                              className="border-b border-ink/5"
                            >
                              <td className="py-1 pr-2 text-xs text-ink/70">
                                {formatDateTime(s.periodStart)} ·{" "}
                                {s.periodDays}
                                {d.blacklist.daysSuffix}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.ownConversions)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.networkOrders)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtPct(s.shavePct)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.adSpend)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.commission)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.roas)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.pendingOrders)}
                              </td>
                              <td className="py-1 pr-2 text-ink/80">
                                {fmtNum(s.oldestPendingDays)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 黑名单面板：列表 + 手动添加 + 复检 + 删除（仅 admin）。 */
function BlacklistPanel({
  d,
  isAdmin,
  showMsg,
}: {
  d: Dict;
  isAdmin: boolean;
  showMsg: (m: string | null) => void;
}) {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<CatalogChannel>("cashback");
  const [filter, setFilter] = useState<string>("");
  const [fType, setFType] = useState<BlacklistEntityType>("merchant");
  const [fChannel, setFChannel] = useState<CatalogChannel>("cashback");
  const [fId, setFId] = useState("");
  const [fReason, setFReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<BlacklistEntry | null>(
    null
  );
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteReasonError, setDeleteReasonError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recheckOutcomes, setRecheckOutcomes] = useState<
    Record<string, RecheckResult>
  >({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    added: number;
    skipped: number;
    errors: Array<{ index: number; entityId: string; message: string }>;
  } | null>(null);

  const load = useCallback(
    async (entityType?: string, ch?: CatalogChannel) => {
      setLoading(true);
      try {
        const res = await listBlacklistAction(entityType || undefined, ch);
        if (!res.ok) {
          showMsg(res.error);
          return;
        }
        setEntries(res.data);
      } catch (err) {
        showMsg(d.products.actionFailed.replace("{error}", errText(err)));
      } finally {
        setLoading(false);
      }
    },
    [showMsg, d]
  );

  useEffect(() => {
    void load(filter || undefined, channel);
  }, [filter, channel, load]);

  // 切换渠道时，手动添加表单的渠道默认跟随。
  useEffect(() => {
    setFChannel(channel);
  }, [channel]);

  async function onAdd() {
    const entityId = fId.trim();
    const reason = fReason.trim();
    if (!entityId) {
      showMsg(d.blacklist.entityIdRequired);
      return;
    }
    if (!reason) {
      showMsg(d.blacklist.reasonRequired);
      return;
    }
    if (adding) return;
    setAdding(true);
    showMsg(null);
    try {
      const res = await addBlacklistAction({
        entityType: fType,
        entityId,
        reason,
        channel: fChannel,
      });
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setFId("");
      setFReason("");
      showMsg(d.blacklist.added);
      await load(filter || undefined, channel);
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setAdding(false);
    }
  }

  async function onRecheck(id: string) {
    if (recheckingId) return;
    setRecheckingId(id);
    try {
      const res = await recheckBlacklistAction(id);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setRecheckOutcomes((m) => ({ ...m, [id]: res.data }));
      showMsg(d.blacklist.recheckDone);
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setRecheckingId(null);
    }
  }

  function openDelete(entry: BlacklistEntry) {
    setDeletingEntry(entry);
    setDeleteReason("");
    setDeleteReasonError(false);
  }

  /** 批量导入：每行 `实体ID, 拉黑原因`（逗号或制表符分隔），渠道/实体类型沿用手动添加的选择。 */
  async function onImport() {
    if (importing) return;
    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      showMsg(d.blacklist.entityIdRequired);
      return;
    }
    const items = lines.map((line) => {
      const parts = line.split(/[,，\t]/);
      return {
        entityType: fType,
        entityId: (parts[0] ?? "").trim(),
        reason: parts.slice(1).join(",").trim(),
        channel: fChannel,
      };
    });
    setImporting(true);
    showMsg(null);
    setImportResult(null);
    try {
      const res = await importBlacklistAction(items);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setImportResult(res.data);
      if (res.data.added > 0) {
        await load(filter || undefined, channel);
      }
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setImporting(false);
    }
  }

  async function confirmDelete() {
    if (!deletingEntry || deleting) return;
    if (!deleteReason.trim()) {
      setDeleteReasonError(true);
      return;
    }
    setDeleting(true);
    try {
      const res = await deleteBlacklistAction(
        deletingEntry.id,
        deleteReason.trim()
      );
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setDeletingEntry(null);
      setDeleteReason("");
      showMsg(d.blacklist.deleted);
      await load(filter || undefined, channel);
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setDeleting(false);
    }
  }

  const observationCount = entries.filter((e) => isObservation(e)).length;

  return (
    <section className={cardCls}>
      <h2 className="text-lg font-semibold text-ink">{d.blacklist.title}</h2>
      <p className="mt-1 text-sm text-ink/70">{d.blacklist.desc}</p>
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        ⚠ {d.blacklist.riskNote}
      </p>

      <div className="mt-4">
        <ChannelTabs
          d={d}
          channel={channel}
          onChange={(c) => setChannel(c)}
        />
      </div>

      <MerchantEvalBlock d={d} channel={channel} showMsg={showMsg} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink/70">
          {d.blacklist.entityType}
          <select
            className={inputCls}
            style={{ width: "auto" }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">{d.blacklist.filterAll}</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {entityTypeLabel(d, "blacklist", t)}
              </option>
            ))}
          </select>
        </label>
        {observationCount > 0 && (
          <span className="text-xs text-ink/60">
            {d.blacklist.observationBadge}：{observationCount} ·{" "}
            {d.blacklist.observationNote}
          </span>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
              <th className="py-2 pr-2">{d.blacklist.colType}</th>
              <th className="py-2 pr-2">{d.blacklist.colChannel}</th>
              <th className="py-2 pr-2">{d.blacklist.colName}</th>
              <th className="py-2 pr-2">{d.blacklist.colNetwork}</th>
              <th className="py-2 pr-2">{d.blacklist.colReason}</th>
              <th className="py-2 pr-2">{d.blacklist.colFirstSeen}</th>
              <th className="py-2 pr-2">{d.blacklist.colLastConfirmed}</th>
              <th className="py-2 pr-2">{d.blacklist.colSource}</th>
              <th className="py-2 pr-2">{d.blacklist.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const outcome = recheckOutcomes[e.id];
              const observing = isObservation(e);
              return (
                <tr key={e.id} className="border-b border-ink/5">
                  <td className="py-2 pr-2 text-ink/70">
                    {entityTypeLabel(d, "blacklist", e.entityType)}
                  </td>
                  <td className="py-2 pr-2 text-ink/70">
                    {e.channel ? channelLabel(d, e.channel) : "—"}
                  </td>
                  <td className="py-2 pr-2">
                    <span className="font-medium text-ink">
                      {e.entityName ?? e.entityId}
                    </span>
                    {e.entityName && (
                      <span className="block font-mono text-xs text-ink/50">
                        {e.entityId}
                      </span>
                    )}
                    {observing && (
                      <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                        {d.blacklist.observationBadge}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-ink/70">
                    {kindLabel(e.networkKind)}
                  </td>
                  <td className="py-2 pr-2 text-ink/80">
                    {e.reason}
                    {e.removeReason && (
                      <span className="block text-xs text-ink/50">
                        {d.blacklist.removeReasonCol}：{e.removeReason}
                        {e.observationUntil &&
                          `（${d.blacklist.observationUntil}：${formatDateTime(
                            e.observationUntil
                          )}）`}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs text-ink/60">
                    {formatDateTime(e.firstSeenAt)}
                  </td>
                  <td className="py-2 pr-2 text-xs text-ink/60">
                    {formatDateTime(e.lastConfirmedAt)}
                  </td>
                  <td className="py-2 pr-2">
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/70">
                      {e.source === "auto"
                        ? d.blacklist.sourceAuto
                        : d.blacklist.sourceManual}
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {!observing && (
                        <>
                          <button
                            className={btnGhost}
                            onClick={() => onRecheck(e.id)}
                            disabled={recheckingId === e.id}
                          >
                            {recheckingId === e.id
                              ? d.blacklist.rechecking
                              : d.blacklist.recheck}
                          </button>
                          {outcome && (
                            <span className="text-xs text-ink/70">
                              {d.blacklist.recheckResult[outcome.result]}
                              {outcome.detail ? `：${outcome.detail}` : ""}
                            </span>
                          )}
                        </>
                      )}
                      {isAdmin && !observing ? (
                        <button
                          className={`${btnGhost} !border-red-300 !text-red-700 hover:!bg-red-50`}
                          title={d.blacklist.deleteNote}
                          onClick={() => openDelete(e)}
                        >
                          {d.blacklist.delete}
                        </button>
                      ) : (
                        !observing && (
                          <span className="text-xs text-ink/40">
                            {d.blacklist.adminOnly}
                          </span>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && (
          <p className="py-6 text-center text-sm text-ink/50">
            {d.blacklist.loading}
          </p>
        )}
        {!loading && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/50">
            {d.blacklist.empty}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-ink/10 p-4">
        <p className="font-medium text-ink">{d.blacklist.addTitle}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <div>
            <label className={labelCls}>{d.blacklist.channelLabel}</label>
            <select
              className={inputCls}
              value={fChannel}
              onChange={(e) =>
                setFChannel(e.target.value as CatalogChannel)
              }
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(d, c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{d.blacklist.entityType}</label>
            <select
              className={inputCls}
              value={fType}
              onChange={(e) =>
                setFType(e.target.value as BlacklistEntityType)
              }
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {entityTypeLabel(d, "blacklist", t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{d.blacklist.entityId}</label>
            <input
              className={inputCls}
              placeholder={d.blacklist.entityIdPlaceholder}
              value={fId}
              onChange={(e) => setFId(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>{d.blacklist.reason}</label>
            <input
              className={inputCls}
              placeholder={d.blacklist.reasonPlaceholder}
              value={fReason}
              onChange={(e) => setFReason(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimary} mt-3`}
          onClick={onAdd}
          disabled={adding}
        >
          {adding ? d.blacklist.adding : d.blacklist.add}
        </button>
      </div>

      {/* ===== 批量导入：与手动添加并列 ===== */}
      <div className="mt-4 rounded-lg border border-ink/10">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setImportOpen((v) => !v)}
        >
          <span className="font-medium text-ink">
            {d.blacklist.importTitle}
            <span className="ml-2 text-xs font-normal text-ink/50">
              {entityTypeLabel(d, "blacklist", fType)} ·{" "}
              {channelLabel(d, fChannel)}
            </span>
          </span>
          <span className="text-sm text-ink/50">{importOpen ? "▲" : "▼"}</span>
        </button>
        {importOpen && (
          <div className="border-t border-ink/10 p-4">
            <p className="text-sm text-ink/70">{d.blacklist.importDesc}</p>
            <textarea
              className={`${inputCls} mt-3 font-mono`}
              rows={6}
              placeholder={d.blacklist.importPlaceholder}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button
              className={`${btnPrimary} mt-3`}
              onClick={onImport}
              disabled={importing}
            >
              {importing ? d.blacklist.importing : d.blacklist.importButton}
            </button>
            {importResult && (
              <div className="mt-3 rounded-lg bg-ink/5 p-3 text-sm">
                <p className="font-medium text-ink">
                  {d.blacklist.importResult
                    .replace("{a}", String(importResult.added))
                    .replace("{b}", String(importResult.skipped))}
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-700">
                    {importResult.errors.slice(0, 5).map((e) => (
                      <li key={e.index}>
                        {d.blacklist.importErrorLine
                          .replace("{i}", String(e.index + 1))
                          .replace("{id}", e.entityId || "—")
                          .replace("{msg}", e.message)}
                      </li>
                    ))}
                    {importResult.errors.length > 5 && (
                      <li>… +{importResult.errors.length - 5}</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== 删除黑名单：弹框必填移除理由（仅管理员） ===== */}
      {deletingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink">
              {d.blacklist.deleteTitle}
            </h3>
            <p className="mt-2 text-sm text-ink/70">
              {entityTypeLabel(d, "blacklist", deletingEntry.entityType)}：
              <span className="font-medium text-ink">
                {deletingEntry.entityName ?? deletingEntry.entityId}
              </span>
            </p>
            <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ {d.blacklist.deleteNote}
            </p>
            <label
              className={`${labelCls} mt-4`}
              htmlFor="blacklist-delete-reason"
            >
              {d.blacklist.deleteReasonLabel}
            </label>
            <textarea
              id="blacklist-delete-reason"
              className={inputCls}
              rows={3}
              placeholder={d.blacklist.deleteReasonPlaceholder}
              value={deleteReason}
              onChange={(e) => {
                setDeleteReason(e.target.value);
                if (e.target.value.trim()) setDeleteReasonError(false);
              }}
            />
            {deleteReasonError && (
              <p className="mt-1 text-xs text-red-700">
                {d.blacklist.deleteReasonRequired}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className={btnGhost}
                onClick={() => setDeletingEntry(null)}
                disabled={deleting}
              >
                {d.blacklist.deleteCancel}
              </button>
              <button
                className={btnPrimary}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? d.blacklist.deleting : d.blacklist.deleteConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** 白名单面板：列表 + 手动添加 + 确认建议 + 删除。 */
function WhitelistPanel({
  d,
  showMsg,
}: {
  d: Dict;
  showMsg: (m: string | null) => void;
}) {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<CatalogChannel>("cashback");
  const [fType, setFType] = useState<BlacklistEntityType>("merchant");
  const [fChannel, setFChannel] = useState<CatalogChannel>("cashback");
  const [fId, setFId] = useState("");
  const [fNote, setFNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(
    async (ch?: CatalogChannel) => {
      setLoading(true);
      try {
        const res = await listWhitelistAction(ch);
        if (!res.ok) {
          showMsg(res.error);
          return;
        }
        setEntries(res.data);
      } catch (err) {
        showMsg(d.products.actionFailed.replace("{error}", errText(err)));
      } finally {
        setLoading(false);
      }
    },
    [showMsg, d]
  );

  useEffect(() => {
    void load(channel);
  }, [channel, load]);

  // 切换渠道时，手动添加表单的渠道默认跟随。
  useEffect(() => {
    setFChannel(channel);
  }, [channel]);

  async function onAdd() {
    const entityId = fId.trim();
    if (!entityId) {
      showMsg(d.whitelist.entityIdRequired);
      return;
    }
    if (adding) return;
    setAdding(true);
    showMsg(null);
    try {
      const note = fNote.trim();
      const res = await addWhitelistAction({
        entityType: fType,
        entityId,
        note: note || undefined,
        channel: fChannel,
      });
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setFId("");
      setFNote("");
      showMsg(d.whitelist.added);
      await load(channel);
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setAdding(false);
    }
  }

  async function onConfirm(id: string) {
    if (confirmingId) return;
    setConfirmingId(id);
    try {
      const res = await confirmWhitelistAction(id);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      showMsg(d.whitelist.confirmed);
      await load(channel);
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setConfirmingId(null);
    }
  }

  async function onDelete(id: string) {
    if (deletingId) return;
    if (!window.confirm(d.whitelist.confirmDelete)) return;
    setDeletingId(id);
    try {
      const res = await deleteWhitelistAction(id);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      showMsg(d.whitelist.deleted);
      await load(channel);
    } catch (err) {
      showMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={cardCls}>
      <h2 className="text-lg font-semibold text-ink">{d.whitelist.title}</h2>
      <p className="mt-1 text-sm text-ink/70">{d.whitelist.desc}</p>
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        ⚠ {d.whitelist.riskNote}
      </p>

      <div className="mt-4">
        <ChannelTabs d={d} channel={channel} onChange={(c) => setChannel(c)} />
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
              <th className="py-2 pr-2">{d.whitelist.colType}</th>
              <th className="py-2 pr-2">{d.whitelist.colName}</th>
              <th className="py-2 pr-2">{d.whitelist.colNote}</th>
              <th className="py-2 pr-2">{d.whitelist.colSource}</th>
              <th className="py-2 pr-2">{d.whitelist.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-ink/5">
                <td className="py-2 pr-2 text-ink/70">
                  {entityTypeLabel(d, "whitelist", e.entityType)}
                </td>
                <td className="py-2 pr-2">
                  <span className="font-medium text-ink">
                    {e.entityName ?? e.entityId}
                  </span>
                  {e.entityName && (
                    <span className="block font-mono text-xs text-ink/50">
                      {e.entityId}
                    </span>
                  )}
                  {isObservation(e) && (
                    <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                      {d.whitelist.observationBadge}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2 text-ink/70">{e.note ?? "—"}</td>
                <td className="py-2 pr-2">
                  {e.source === "suggested" ? (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                      {d.whitelist.suggestedBadge}
                    </span>
                  ) : (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/70">
                      {d.whitelist.sourceManual}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.source === "suggested" && !isObservation(e) && (
                      <button
                        className={btnPrimary}
                        style={{ padding: "0.375rem 0.75rem" }}
                        onClick={() => onConfirm(e.id)}
                        disabled={confirmingId === e.id}
                      >
                        {confirmingId === e.id
                          ? d.whitelist.confirming
                          : d.whitelist.confirm}
                      </button>
                    )}
                    <button
                      className={btnGhost}
                      onClick={() => onDelete(e.id)}
                      disabled={deletingId === e.id}
                    >
                      {deletingId === e.id
                        ? d.whitelist.deleting
                        : d.whitelist.delete}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <p className="py-6 text-center text-sm text-ink/50">
            {d.whitelist.loading}
          </p>
        )}
        {!loading && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/50">
            {d.whitelist.empty}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-ink/10 p-4">
        <p className="font-medium text-ink">{d.whitelist.addTitle}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <div>
            <label className={labelCls}>{d.whitelist.channelLabel}</label>
            <select
              className={inputCls}
              value={fChannel}
              onChange={(e) =>
                setFChannel(e.target.value as CatalogChannel)
              }
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(d, c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{d.whitelist.entityType}</label>
            <select
              className={inputCls}
              value={fType}
              onChange={(e) =>
                setFType(e.target.value as BlacklistEntityType)
              }
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {entityTypeLabel(d, "whitelist", t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{d.whitelist.entityId}</label>
            <input
              className={inputCls}
              placeholder={d.whitelist.entityIdPlaceholder}
              value={fId}
              onChange={(e) => setFId(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>
              {d.whitelist.note}（{d.common.optional}）
            </label>
            <input
              className={inputCls}
              placeholder={d.whitelist.notePlaceholder}
              value={fNote}
              onChange={(e) => setFNote(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimary} mt-3`}
          onClick={onAdd}
          disabled={adding}
        >
          {adding ? d.whitelist.adding : d.whitelist.add}
        </button>
      </div>
    </section>
  );
}

export function CatalogClient({
  initialNetworks,
  initialPreset,
  isAdmin,
}: {
  initialNetworks: CatalogNetwork[];
  initialPreset: ScreeningPreset | null;
  isAdmin: boolean;
}) {
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d: Dict = lang === "en" ? catalogEn : catalogZh;

  const [tab, setTab] = useState<"products" | "blacklist" | "whitelist">(
    "products"
  );
  /** 商品表 / 品牌视图切换（品牌视图按品牌聚合，决策单位是品牌）。 */
  const [viewMode, setViewMode] = useState<"products" | "brands">("products");

  // ---- network selection / sync ----
  const [networks, setNetworks] = useState(initialNetworks);
  useEffect(() => setNetworks(initialNetworks), [initialNetworks]);
  const supported = networks.filter((n) =>
    ["partnerboost", "yeahpromos"].includes(n.kind.toLowerCase())
  );
  const [selectedId, setSelectedId] = useState<string>(
    supported[0]?.id ?? ""
  );
  useEffect(() => {
    if (!supported.some((n) => n.id === selectedId)) {
      setSelectedId(supported[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networks]);
  const selected = networks.find((n) => n.id === selectedId) ?? null;

  const [msg, setMsg] = useState<string | null>(null);
  // 操作提示渲染在页面最顶端：表格处操作（建 Offer/下线等）的结果用户
  // 看不见曾造成连环误诊 → msg 一出现就把提示框滚入视野。
  const msgRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (msg) {
      msgRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [msg]);
  const [syncing, setSyncing] = useState(false);
  const [syncForbidden, setSyncForbidden] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  /** 按商家同步：品牌 ID 输入框。 */
  const [brandIdInput, setBrandIdInput] = useState("");
  /** 正在按商家同步时的 brandId（用于显示状态）。 */
  const [syncingBrandId, setSyncingBrandId] = useState<string | null>(null);
  /** 当前轮询中的同步任务（显示阶段用）。 */
  const [syncJob, setSyncJob] = useState<CatalogSyncJob | null>(null);
  /** 最近同步任务列表（当前所选网络）。 */
  const [syncJobs, setSyncJobs] = useState<CatalogSyncJob[]>([]);
  /** 可投流漏斗计数（当前所选网络）。 */
  const [funnel, setFunnel] = useState<CatalogFunnel | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    []
  );

  async function loadSyncJobs() {
    const res = await listSyncJobsAction(selectedId || undefined);
    if (res.ok) setSyncJobs(res.data);
  }

  async function loadFunnel() {
    if (!selectedId) {
      setFunnel(null);
      return;
    }
    const res = await getCatalogFunnelAction(selectedId);
    if (res.ok) setFunnel(res.data);
  }

  // 所选网络变化 → 刷新任务列表 + 漏斗。
  useEffect(() => {
    void loadSyncJobs();
    void loadFunnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function onSync(brandId?: string) {
    if (!selectedId || syncing) return;
    const trimmedBrandId = brandId?.trim() || undefined;
    setSyncing(true);
    setSyncingBrandId(trimmedBrandId ?? null);
    setMsg(null);
    setSyncForbidden(false);
    setSyncResult(null);
    setSyncJob(null);
    // 后端改为后台任务：POST 只建 job 立即返回，之后每 2 秒轮询状态。
    try {
      const res = await syncCatalogAction(selectedId, trimmedBrandId);
      if (!res.ok) {
        setSyncing(false);
        setSyncingBrandId(null);
        if (res.forbidden) {
          setSyncForbidden(true);
        } else {
          setMsg(res.error);
        }
        return;
      }
      void pollSyncJob(res.data.jobId);
    } catch (err) {
      setSyncing(false);
      setSyncingBrandId(null);
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    }
  }

  async function pollSyncJob(jobId: string) {
    try {
      const res = await getSyncJobAction(jobId);
      if (!res.ok) {
        setSyncing(false);
        setSyncingBrandId(null);
        setMsg(res.error);
        return;
      }
      const job = res.data;
      setSyncJob(job);
      if (job.status === "succeeded" || job.status === "skipped") {
        setSyncing(false);
        setSyncingBrandId(null);
        setSyncResult(job.result ?? null);
        await reloadProducts(1);
        void loadFunnel();
        void loadSyncJobs();
        return;
      }
      if (job.status === "failed") {
        setSyncing(false);
        setSyncingBrandId(null);
        setMsg(job.error ?? d.top.syncJobFailed);
        void loadSyncJobs();
        return;
      }
      pollTimer.current = setTimeout(() => void pollSyncJob(jobId), 2000);
    } catch (err) {
      setSyncing(false);
      setSyncingBrandId(null);
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    }
  }

  function onSyncByBrand() {
    if (!brandIdInput.trim()) {
      setMsg(d.top.brandIdRequired);
      return;
    }
    onSync(brandIdInput.trim());
  }

  // ---- session status per network ----
  const [sessionStatuses, setSessionStatuses] = useState<
    Record<string, { status: SessionStatus; updatedAt: string | null }>
  >({});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        supported.map(async (n) => {
          const r = await getSessionStatusAction(n.id);
          return [
            n.id,
            r.ok
              ? r.data
              : { status: (n.sessionStatus ?? "NEVER") as SessionStatus, updatedAt: null },
          ] as const;
        })
      );
      if (!cancelled) setSessionStatuses(Object.fromEntries(entries));
    }
    if (supported.length > 0) void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networks]);

  function sessionOf(n: CatalogNetwork): SessionStatus {
    return sessionStatuses[n.id]?.status ?? n.sessionStatus ?? "NEVER";
  }

  // ---- sync-mode switch (ToS confirm modal) ----
  const [modePending, setModePending] = useState<{
    networkId: string;
    mode: SyncMode;
  } | null>(null);
  const [riskChecked, setRiskChecked] = useState(false);
  const [riskError, setRiskError] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);

  function requestModeChange(network: CatalogNetwork, mode: SyncMode) {
    if (mode === network.syncMode) return;
    if (mode === "session") {
      setRiskChecked(false);
      setRiskError(false);
      setModePending({ networkId: network.id, mode });
    } else {
      void applyModeChange(network.id, "api", false);
    }
  }

  async function applyModeChange(
    networkId: string,
    mode: SyncMode,
    confirmTosRisk: boolean
  ) {
    setModeSaving(true);
    setMsg(null);
    try {
      const res = await setSyncModeAction(networkId, mode, confirmTosRisk);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setNetworks((ns) =>
        ns.map((n) => (n.id === networkId ? { ...n, syncMode: mode } : n))
      );
      setModePending(null);
      setRiskChecked(false);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setModeSaving(false);
    }
  }

  async function confirmSessionMode() {
    if (!riskChecked) {
      setRiskError(true);
      return;
    }
    if (modePending) {
      await applyModeChange(modePending.networkId, "session", true);
    }
  }

  // ---- session cookie save ----
  const [cookieInputs, setCookieInputs] = useState<Record<string, string>>({});
  const [savingCookieId, setSavingCookieId] = useState<string | null>(null);

  async function onSaveCookie(networkId: string) {
    const value = (cookieInputs[networkId] ?? "").trim();
    if (!value || savingCookieId) return;
    if (cookieByteLen(value) > MAX_COOKIE_BYTES) {
      setMsg(d.mode.cookieTooLong);
      return;
    }
    setSavingCookieId(networkId);
    setMsg(null);
    try {
      const res = await saveSessionCookieAction(networkId, value);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setCookieInputs((m) => ({ ...m, [networkId]: "" }));
      setSessionStatuses((m) => ({
        ...m,
        [networkId]: { status: "OK", updatedAt: new Date().toISOString() },
      }));
      setNetworks((ns) =>
        ns.map((n) =>
          n.id === networkId
            ? { ...n, sessionConfigured: true, sessionStatus: "OK" as SessionStatus }
            : n
        )
      );
      setMsg(d.mode.saved);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setSavingCookieId(null);
    }
  }

  // ---- session credentials 信息展示（管理 UI 已搬至管理控制台；此处仅展示 + 跳转） ----
  // 弹窗组件见 ./session-credentials-modal（管理控制台 · 登录账号 tab 使用）。

  /** 登录态到期信息展示：username 明文；密码永不回显。 */
  function credInfo(n: CatalogNetwork): string {
    const u = n.sessionUsername?.trim()
      ? n.sessionUsername
      : d.mode.credUsernameEmpty;
    const pwd = n.sessionPasswordSet
      ? d.mode.credPasswordSet
      : d.mode.credPasswordEmpty;
    const exp = n.sessionExpiresAt
      ? `${d.mode.credExpiresAt}：${new Date(n.sessionExpiresAt).toLocaleString()}`
      : "";
    return `${d.mode.credUsername}：${u} · ${d.mode.credPassword}：${pwd}${exp ? ` · ${exp}` : ""}`;
  }

  // ---- screening preset ----
  const [pMinReviews, setPMinReviews] = useState(initialPreset?.minReviews != null ? String(initialPreset.minReviews) : "");
  const [pMinCommissionAmount, setPMinCommissionAmount] = useState(initialPreset?.minCommissionAmount != null ? String(initialPreset.minCommissionAmount) : "");
  const [pMinCommissionRate, setPMinCommissionRate] = useState(initialPreset?.minCommissionRate != null ? String(initialPreset.minCommissionRate) : "");
  const [pMinPrice, setPMinPrice] = useState(initialPreset?.minPrice != null ? String(initialPreset.minPrice) : "");
  const [pMaxPrice, setPMaxPrice] = useState(initialPreset?.maxPrice != null ? String(initialPreset.maxPrice) : "");
  const [pMinScore, setPMinScore] = useState(initialPreset?.minScore != null ? String(initialPreset.minScore) : "");
  const [pAutoCreate, setPAutoCreate] = useState(initialPreset?.autoCreateOffer ?? false);
  const [pAutoTopN, setPAutoTopN] = useState(initialPreset ? String(initialPreset.autoCreateTopN) : "20");
  const [savingPreset, setSavingPreset] = useState(false);
  const [screening, setScreening] = useState(false);
  const [screenMsg, setScreenMsg] = useState<string | null>(null);

  function buildPresetPayload(adminFields: boolean) {
    const topN = numOrNull(pAutoTopN);
    return {
      minReviews: numOrNull(pMinReviews),
      minCommissionAmount: numOrNull(pMinCommissionAmount),
      minCommissionRate: numOrNull(pMinCommissionRate),
      minPrice: numOrNull(pMinPrice),
      maxPrice: numOrNull(pMaxPrice),
      minScore: numOrNull(pMinScore),
      autoCreateOffer: adminFields ? pAutoCreate : undefined,
      autoCreateTopN: adminFields
        ? Math.min(50, Math.max(1, Math.round(topN ?? 20)))
        : undefined,
      admin: adminFields,
    };
  }

  async function onSavePreset(adminFields: boolean) {
    if (savingPreset) return;
    setSavingPreset(true);
    setMsg(null);
    try {
      const res = await saveScreeningPresetAction(buildPresetPayload(adminFields));
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(d.preset.saved);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setSavingPreset(false);
    }
  }

  async function onScreenNow() {
    if (screening) return;
    setScreening(true);
    setScreenMsg(null);
    try {
      // 先保存表单现值再筛：筛选跑的是已保存预设，只改数字不保存 = 按旧值筛（白改）。
      const saved = await saveScreeningPresetAction(buildPresetPayload(isAdmin));
      if (!saved.ok) {
        setMsg(saved.error);
        return;
      }
      const res = await screenCatalogAction(selectedId || undefined);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setScreenMsg(
        d.preset.screened
          .replace("{a}", String(res.data.screened))
          .replace("{b}", String(res.data.recommended))
      );
      await reloadProducts(1);
      void loadFunnel();
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setScreening(false);
    }
  }

  // ---- product list ----
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [applyPreset, setApplyPreset] = useState(true);
  const [presetExcluded, setPresetExcluded] = useState(0);
  const [sort, setSort] = useState("id_desc");
  // 排序选择持久化：挂载后从 localStorage 恢复（不在 useState 初始化里读——
  // 服务端渲染没有 window，读了会 hydration 不一致）；每次变更写回。
  useEffect(() => {
    const stored = readStoredSort();
    if (stored) setSort(stored);
  }, []);
  useEffect(() => {
    persistSort(sort);
  }, [sort]);
  /** 广告数下限过滤：草稿（输入框）与已生效值分离，回车/失焦才生效。 */
  const [minAdsDraft, setMinAdsDraft] = useState("");
  const [minAds, setMinAds] = useState<number | undefined>(undefined);
  /** 广告数上限过滤（与下限合成区间；「甜蜜点」快捷 = 1–20）。 */
  const [maxAdsDraft, setMaxAdsDraft] = useState("");
  const [maxAds, setMaxAds] = useState<number | undefined>(undefined);
  /** 投放国家过滤："" = 全部国家；选项来自当前网络在库商品的国家清单。 */
  const [countryFilter, setCountryFilter] = useState("");
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  /** 补强 #3：备选池阶段筛选（"" = 全部阶段）与批量移动目标阶段。 */
  const [poolStageFilter, setPoolStageFilter] = useState<PoolStage | "">("");
  const [batchPoolStage, setBatchPoolStage] = useState<PoolStage>("pool");
  const [movingStage, setMovingStage] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchCreateResult | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  /** 历史投放次数（商品 id → 投放档案条数；无记录 → 0，不编数）。 */
  const [launchCounts, setLaunchCounts] = useState<Record<string, number>>({});
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);

  async function reloadProducts(targetPage: number, qOverride?: string) {
    if (!selectedId) {
      setProducts([]);
      setTotal(0);
      return;
    }
    setLoadingProducts(true);
    try {
      const query = (qOverride ?? q).trim();
      const res = await listCatalogProductsAction({
        networkId: selectedId,
        recommended: onlyRecommended ? true : undefined,
        q: query || undefined,
        page: targetPage,
        pageSize: PAGE_SIZE,
        preset: applyPreset ? undefined : false,
        sort,
        minAdCount: minAds,
        maxAdCount: maxAds,
        country: countryFilter || undefined,
        poolStage: poolStageFilter || undefined,
      });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setProducts(res.data.items);
      void getProductLaunchCountsAction(res.data.items.map((p) => p.id)).then((r) => {
        if (r.ok) setLaunchCounts(r.data.counts);
      });
      setTotal(res.data.total);
      setPage(res.data.page);
      setPresetExcluded(res.data.presetExcluded ?? 0);
      setSelectedIds(new Set());
      setBatchResult(null);
    } catch (err) {
      // 列表加载自身抛错也要出字 + 复位 loading，否则整页静默卡死。
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setLoadingProducts(false);
    }
  }

  /** 补强 #3：单条移动备选池阶段（后端 B6 门禁；失败原因直接展示）。 */
  async function onMovePoolStageOne(prod: CatalogProduct, stage: PoolStage) {
    if (movingStage || (prod.poolStage ?? "inbox") === stage) return;
    setMovingStage(true);
    setMsg(null);
    try {
      const res = await moveProductPoolStageAction(prod.id, stage);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(
        d.products.poolStageMoved
          .replace("{n}", "1")
          .replace("{stage}", d.products.poolStage[stage])
      );
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setMovingStage(false);
    }
  }

  /** 补强 #3：批量移动备选池阶段。 */
  async function onBatchMovePoolStage() {
    if (selectedIds.size === 0 || movingStage) {
      setMsg(d.products.noSelection);
      return;
    }
    setMovingStage(true);
    setMsg(null);
    try {
      const res = await moveProductsPoolStageAction(
        Array.from(selectedIds),
        batchPoolStage
      );
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(
        d.products.poolStageMoved
          .replace("{n}", String(res.data.updated))
          .replace("{stage}", d.products.poolStage[batchPoolStage])
      );
      setSelectedIds(new Set());
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setMovingStage(false);
    }
  }

  /** 一键筛选报告「查看被淘汰的」：切到商品视图 + 备选池阶段，并滚动到商品表。 */
  function onViewKilled() {
    setViewMode("products");
    setPoolStageFilter("pool");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tableWrapRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }

  async function onBackfill() {
    if (backfilling || !selectedId) return;
    setBackfilling(true);
    setMsg(null);
    try {
      const res = await backfillCatalogProductsAction(selectedId);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(
        d.products.backfillDone
          .replace("{a}", String(res.data.scanned))
          .replace("{b}", String(res.data.backfilled)) +
          (res.data.normalizedIds
            ? "；" +
              d.products.backfillIdsNormalized.replace(
                "{c}",
                String(res.data.normalizedIds)
              )
            : "")
      );
      await reloadProducts(page);
      // 回填可能刚补上国家 → 同步刷新国家下拉选项。
      void listCatalogCountriesAction(selectedId).then((r) => {
        if (r.ok) setCountryOptions(r.data.countries);
      });
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setBackfilling(false);
    }
  }

  async function onCreateOfferOne(id: string) {
    if (batching) return;
    setBatching(true);
    setMsg(null);
    try {
      const res = await batchCreateOffersAction([id]);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      // 单条四种结局必须分开报，只报"成功创建 N 个"会掩盖原因：
      // 已建过（幂等）是最常见的"没新建"，误报失败会把人带偏。
      const failedOne = res.data.failed[0];
      const skippedOne = res.data.skippedBlacklist?.[0];
      const existingOne = res.data.skippedExisting?.[0];
      if (res.data.created.length > 0) {
        setMsg(d.products.batchResultCreated.replace("{n}", "1"));
      } else if (existingOne) {
        setMsg(d.products.offerOneExists);
      } else if (skippedOne) {
        setMsg(
          `${d.products.offerOneSkipped ?? "未创建（黑名单）"}：${skippedOne.reason}`
        );
      } else {
        setMsg(
          `${d.products.offerOneFailed ?? "创建失败"}：${failedOne?.reason ?? d.products.unknownReason ?? "未知原因"}`
        );
      }
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setBatching(false);
    }
  }

  async function onOfflineOne(p: CatalogProduct) {
    if (offlining) return;
    if (!window.confirm(d.products.offlineConfirm.replace("{n}", "1"))) return;
    setOfflining(true);
    setMsg(null);
    try {
      const res = await offlineProductsAction([p.id]);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(d.products.offlineDone.replace("{n}", String(res.data.updated)));
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setOfflining(false);
    }
  }

  useEffect(() => {
    void reloadProducts(1);
    setQ("");
    setQDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, onlyRecommended, applyPreset, sort, minAds, maxAds, countryFilter, poolStageFilter]);

  /** 网络切换时刷新国家选项并清空国家过滤（别网络的国家代码不通用）。 */
  useEffect(() => {
    setCountryFilter("");
    if (!selectedId) {
      setCountryOptions([]);
      return;
    }
    void listCatalogCountriesAction(selectedId).then((r) => {
      if (r.ok) setCountryOptions(r.data.countries);
    });
  }, [selectedId]);

  /** 提交广告数下限草稿：正整数生效，空/非法 → 清除过滤。 */
  function commitMinAds() {
    const n = Number(minAdsDraft.trim());
    setMinAds(
      minAdsDraft.trim() !== "" && Number.isFinite(n) && n > 0
        ? Math.floor(n)
        : undefined
    );
  }

  /** 提交广告数上限草稿：非负整数生效（0 = 只看已计算且为 0 的），空/非法 → 清除。 */
  function commitMaxAds() {
    const n = Number(maxAdsDraft.trim());
    setMaxAds(
      maxAdsDraft.trim() !== "" && Number.isFinite(n) && n >= 0
        ? Math.floor(n)
        : undefined
    );
  }

  /** 「甜蜜点」快捷：一键设区间 1–20（稳定投放·甜蜜点分档）。 */
  function applySweetSpot() {
    setMinAdsDraft("1");
    setMaxAdsDraft("20");
    setMinAds(1);
    setMaxAds(20);
  }

  /** 点击表头切换排序：同列在 desc/asc 间切换 */
  function onSortCol(base: string) {
    setSort((prev) => {
      const [b, dir] = prev.split("_");
      if (b === base) return `${base}_${dir === "desc" ? "asc" : "desc"}`;
      return `${base}_desc`;
    });
  }

  /* 表格横向拖拽滚动（autoads 式：按住拖动看全列） */
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ down: false, startX: 0, startLeft: 0 });
  function onTablePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 链接/按钮/输入框上不启动拖拽，避免误触
    const t = e.target as HTMLElement;
    if (t.closest("a,button,input,select,textarea")) return;
    const el = tableWrapRef.current;
    if (!el) return;
    dragState.current = { down: true, startX: e.clientX, startLeft: el.scrollLeft };
  }
  function onTablePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = tableWrapRef.current;
    const st = dragState.current;
    if (!st.down || !el) return;
    el.scrollLeft = st.startLeft - (e.clientX - st.startX);
  }
  function endTableDrag() {
    dragState.current.down = false;
  }

  /** 可排序表头（autoads 式：点击切换 降序/升序；label 可带图标节点） */
  function sortTh(base: string, label: React.ReactNode, thCls?: string) {
    const [b, dir] = sort.split("_");
    const active = b === base;
    return (
      <th className={`px-3 py-2.5 ${thCls ?? ""}`}>
        <button
          type="button"
          onClick={() => onSortCol(base)}
          className={`inline-flex items-center gap-1 font-medium hover:text-ink ${
            active ? "text-ink" : ""
          }`}
          title={active && dir === "asc" ? d.products.sortAsc : d.products.sortDesc}
        >
          {label}
          {active ? (
            <span className="text-[10px] text-signal">
              {dir === "desc" ? "▼" : "▲"}
            </span>
          ) : (
            <span className="text-[10px] text-ink/30">↕</span>
          )}
        </button>
      </th>
    );
  }

  /** 佣金金额：实数优先；只有佣金率+价格时给预计值（明确标注，不编数字）。 */
  function commissionAmountCell(p: CatalogProduct) {
    if (p.commissionAmount != null)
      return <span>{fmtMoney(p.commissionAmount, p.currency)}</span>;
    if (p.commissionRate != null && p.price != null) {
      const est = Math.round(p.price * p.commissionRate) / 100;
      return (
        <span>
          {fmtMoney(est, p.currency)}{" "}
          <span className="text-xs text-ink/40">({d.products.estimated})</span>
        </span>
      );
    }
    return <span className="text-ink/40">—</span>;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectable = selectableProducts(products);
  const allChecked =
    selectable.length > 0 && selectable.every((p) => selectedIds.has(p.id));

  function toggleAll() {
    if (allChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map((p) => p.id)));
    }
  }

  function toggleOne(id: string, disabled?: boolean) {
    if (disabled) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onBatchCreate() {
    if (selectedIds.size === 0 || batching) {
      setMsg(d.products.noSelection);
      return;
    }
    setBatching(true);
    setMsg(null);
    setBatchResult(null);
    try {
      const res = await batchCreateOffersAction(Array.from(selectedIds));
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setBatchResult(res.data);
      setSelectedIds(new Set());
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setBatching(false);
    }
  }

  const [calcScoring, setCalcScoring] = useState(false);
  const [calcAdCounting, setCalcAdCounting] = useState(false);
  /** 广告数付费计算的范围/强制控制与预估确认（防误触：先预估、再确认）。 */
  const [adCalcScope, setAdCalcScope] = useState<CalcAdCountScope>("all");
  const [adCalcForce, setAdCalcForce] = useState(false);
  /** 每组查询深度（4/8/12，默认 12）：工具栏选择 + localStorage 持久化。 */
  const [adCalcDepth, setAdCalcDepth] = useState<CalcDepth>(DEFAULT_CALC_DEPTH);
  const [adCalcPreviewing, setAdCalcPreviewing] = useState(false);
  /** 确认框内切换深度后重新预估中（数字刷新完成前禁用深度选择与确认）。 */
  const [adCalcRepricing, setAdCalcRepricing] = useState(false);
  const [adCalcConfirm, setAdCalcConfirm] = useState<{
    preview: CalcAdCountPreviewResult;
    scope: CalcAdCountScope;
    force: boolean;
    depth: CalcDepth;
    facts: ReturnType<typeof calcAdCountConfirmFacts>;
  } | null>(null);

  // 深度选择持久化：挂载后从 localStorage 恢复（同排序口径，不在
  // useState 初始化里读 window）；每次变更写回。
  useEffect(() => {
    const stored = readStoredCalcDepth();
    if (stored) setAdCalcDepth(stored);
  }, []);
  useEffect(() => {
    persistCalcDepth(adCalcDepth);
  }, [adCalcDepth]);
  /** 按新增日期全选：所选本地日期与请求中标记。 */
  const [addedDate, setAddedDate] = useState(() => localTodayString());
  const [selectingAdded, setSelectingAdded] = useState(false);
  /** 一键筛选：运行中标记 + 最近一次数字报告。 */
  const [oneClickBusy, setOneClickBusy] = useState(false);
  const [screenReport, setScreenReport] = useState<OneClickScreenReport | null>(null);
  const [forceSelectingId, setForceSelectingId] = useState<string | null>(null);
  const [offlining, setOfflining] = useState(false);
  const [scorePaused, setScorePaused] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await getScoreCalcPausedAction();
      if (res.ok) setScorePaused(res.data.paused);
    })();
  }, []);

  function landingPageTypeLabel(t: string | null): string {
    switch (t) {
      case "amazon_product":
        return d.products.landingAmazonProduct;
      case "amazon_store":
        return d.products.landingAmazonStore;
      case "dtc":
        return d.products.landingDtc;
      default:
        return d.products.landingUnknown;
    }
  }

  async function onCalcScore() {
    if (selectedIds.size === 0 || calcScoring) {
      setMsg(d.products.noSelection);
      return;
    }
    setCalcScoring(true);
    setMsg(null);
    try {
      const res = await calcScoreAction(Array.from(selectedIds));
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(
        d.products.calcScoreDone.replace("{n}", String(res.data.updated))
      );
      setSelectedIds(new Set());
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setCalcScoring(false);
    }
  }

  /**
   * 广告数付费计算第一步：只读预估（不计费）→ 打开确认框。
   * 防误触口径：付费调用绝不一键直达，必须先看真实数字再确认；
   * 预估中/确认框打开/提交中都视为忙，入口按钮全程 disabled 防连点。
   */
  async function onCalcAdCount() {
    if (calcAdCounting || adCalcPreviewing || adCalcConfirm) return;
    setAdCalcPreviewing(true);
    setMsg(null);
    try {
      const res = await previewCalcAdCountAction(adCalcScope, {
        depth: adCalcDepth,
        force: adCalcForce,
      });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      // 快照当时的范围/强制/深度：确认提交时按快照走，不受其后改动影响。
      setAdCalcConfirm({
        preview: res.data,
        scope: adCalcScope,
        force: adCalcForce,
        depth: adCalcDepth,
        facts: calcAdCountConfirmFacts(res.data, {
          force: adCalcForce,
          scope: adCalcScope,
          depth: adCalcDepth,
        }),
      });
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setAdCalcPreviewing(false);
    }
  }

  /**
   * 确认框内切换深度：以快照的范围/强制 + 新深度重新预估（只读、不
   * 计费），回来后整框数字（预计查询数/最坏/费用）按新深度刷新——
   * 费用永远由后端按新深度重算，前端不在本地算钱。失败则保留旧数字
   * 并报错，不让用户对着过期费用确认。
   */
  async function onConfirmDepthChange(next: CalcDepth) {
    if (!adCalcConfirm || adCalcRepricing || calcAdCounting) return;
    if (next === adCalcConfirm.depth) return;
    const snapshot = adCalcConfirm;
    setAdCalcRepricing(true);
    try {
      const res = await previewCalcAdCountAction(snapshot.scope, {
        depth: next,
        force: snapshot.force,
      });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setAdCalcConfirm({
        preview: res.data,
        scope: snapshot.scope,
        force: snapshot.force,
        depth: next,
        facts: calcAdCountConfirmFacts(res.data, {
          force: snapshot.force,
          scope: snapshot.scope,
          depth: next,
        }),
      });
      // 工具栏深度同步跟随（并经 effect 持久化），下次打开即是这一档。
      setAdCalcDepth(next);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setAdCalcRepricing(false);
    }
  }

  /** 确认框点「确认提交计算」才真正调付费计算（带快照的 force/scope）。 */
  async function onConfirmCalcAdCount() {
    if (!adCalcConfirm || calcAdCounting) return;
    const snapshot = adCalcConfirm;
    setCalcAdCounting(true);
    setMsg(null);
    try {
      // 未选中 = 全量（范围/强制/深度仍按快照）；选中 = 只算勾选的商品。
      const res = await calcAdCountAction(Array.from(selectedIds), {
        force: snapshot.force,
        scope: snapshot.scope,
        depth: snapshot.depth,
      });
      setAdCalcConfirm(null);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      let text = d.products.calcAdCountDone
        .replace("{q}", String(res.data.groupsQueried))
        .replace("{s}", String(res.data.groupsSkippedCache))
        .replace("{u}", String(res.data.productsUpdated));
      if ((res.data.skippedDeadGroups ?? 0) > 0) {
        text += d.products.calcAdCountSkippedDead.replace(
          "{n}",
          String(res.data.skippedDeadGroups)
        );
      }
      if (res.data.errors.length > 0) {
        text += d.products.calcAdCountErrors.replace(
          "{e}",
          String(res.data.errors.length)
        );
        // 失败组的原因要可见：前 3 组明细 + 溢出计数。
        const detail = res.data.errors
          .slice(0, 3)
          .map(
            (e) =>
              `${e.brand}${e.countryCode ? `(${e.countryCode})` : ""}: ${e.message}`.slice(0, 120)
          )
          .join("；");
        text += `：${detail}${
          res.data.errors.length > 3
            ? d.products.calcAdCountErrorsMore.replace(
                "{n}",
                String(res.data.errors.length - 3)
              )
            : ""
        }`;
      }
      setMsg(text);
      await reloadProducts(page);
    } catch (err) {
      setAdCalcConfirm(null);
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setCalcAdCounting(false);
    }
  }

  /**
   * 按新增日期全选：本地时区把所选日期换算成 [当天 00:00, 次日 00:00)
   * 的 UTC ISO 区间（带当前网络过滤，若有）→ 取 id 后**替换**当前勾选集。
   * 纯选择辅助，不触发任何付费/筛选动作；失败不改勾选。
   */
  async function onSelectAddedByDate() {
    if (selectingAdded) return;
    const range = localDayRangeToIso(addedDate);
    if (!range) {
      setMsg(d.products.addedSelectInvalid);
      return;
    }
    setSelectingAdded(true);
    setMsg(null);
    try {
      const res = await addedProductIdsAction({
        from: range.from,
        to: range.to,
        ...(selectedId ? { networkId: selectedId } : {}),
      });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setSelectedIds(new Set(res.data.ids));
      if (res.data.ids.length === 0) {
        setMsg(d.products.addedSelectNone.replace("{date}", addedDate));
      } else if (res.data.truncated) {
        setMsg(
          d.products.addedSelectTruncated
            .replace("{date}", addedDate)
            .replace("{total}", String(res.data.total))
            .replace("{n}", String(res.data.ids.length))
        );
      } else {
        setMsg(
          d.products.addedSelectDone
            .replace("{date}", addedDate)
            .replace("{n}", String(res.data.ids.length))
        );
      }
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setSelectingAdded(false);
    }
  }

  /** 一键筛选（范围三选）：免费层直跑，广告数层经网关（被拒后端自动跳过并标注）。 */
  async function onOneClickScreen(scope: "selected" | "current" | "unscreened") {
    if (oneClickBusy) return;
    if (scope === "selected" && selectedIds.size === 0) {
      setMsg(d.products.noSelection);
      return;
    }
    setOneClickBusy(true);
    setMsg(null);
    setScreenReport(null);
    try {
      const res = await oneClickScreenAction({
        scope,
        ids: scope === "selected" ? Array.from(selectedIds) : undefined,
        filter:
          scope === "current"
            ? {
                networkId: selectedId ?? undefined,
                recommended: onlyRecommended ? true : undefined,
                q: q.trim() || undefined,
                minAdCount: minAds,
                maxAdCount: maxAds,
                country: countryFilter || undefined,
                poolStage: poolStageFilter || undefined,
              }
            : undefined,
      });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setScreenReport(res.data);
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setOneClickBusy(false);
    }
  }

  /** 人工强制入选（单个被杀商品）：黑名单不可强制，后端拒绝原因直接展示。 */
  async function onForceSelectOne(productId: string) {
    if (forceSelectingId) return;
    setForceSelectingId(productId);
    setMsg(null);
    try {
      const res = await forceSelectProductsAction([productId]);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      if (res.data.refusedBlacklist.length > 0) {
        setMsg(res.data.refusedBlacklist[0].reason);
        return;
      }
      if (res.data.failed.length > 0) {
        setMsg(res.data.failed[0].reason);
        return;
      }
      setMsg(d.products.forceSelectDone.replace("{n}", "1"));
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setForceSelectingId(null);
    }
  }

  async function onBatchOffline() {
    if (selectedIds.size === 0 || offlining) {
      setMsg(d.products.noSelection);
      return;
    }
    if (
      !window.confirm(
        d.products.offlineConfirm.replace("{n}", String(selectedIds.size))
      )
    ) {
      return;
    }
    setOfflining(true);
    setMsg(null);
    try {
      const res = await offlineProductsAction(Array.from(selectedIds));
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(d.products.offlineDone.replace("{n}", String(res.data.updated)));
      setSelectedIds(new Set());
      await reloadProducts(page);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setOfflining(false);
    }
  }

  async function onToggleScorePause() {
    if (togglingPause) return;
    setTogglingPause(true);
    setMsg(null);
    try {
      const res = await setScoreCalcPausedAction(!scorePaused);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setScorePaused(res.data.paused);
    } catch (err) {
      setMsg(d.products.actionFailed.replace("{error}", errText(err)));
    } finally {
      setTogglingPause(false);
    }
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader title={d.page.title} description={d.page.description} />

      {msg && (
        <div
          ref={msgRef}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {msg}
        </div>
      )}

      {/* ===== 页签：商品 / 黑名单 / 白名单 ===== */}
      <div className="flex flex-wrap gap-2">
        {(["products", "blacklist", "whitelist"] as const).map((t) => (
          <button
            key={t}
            className={
              tab === t
                ? "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white"
                : `${btnGhost} !px-4 !py-2`
            }
            onClick={() => setTab(t)}
          >
            {d.tabs[t]}
          </button>
        ))}
      </div>

      {/* ===== 顶部：联盟选择 + 同步 ===== */}
      {syncForbidden ? (
        <div className={cardCls}>
          <h2 className="text-lg font-semibold text-ink">{d.grant.title}</h2>
          <p className="mt-2 text-sm text-ink/70">{d.grant.body}</p>
          <a href="/admin/grants" className={`${btnPrimary} mt-4 inline-block`}>
            {d.grant.apply}
          </a>
        </div>
      ) : (
        <section className={cardCls}>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-52 flex-1">
              <label className={labelCls} htmlFor="catalog-network">
                {d.top.selectNetwork}
              </label>
              <select
                id="catalog-network"
                className={inputCls}
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {supported.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} · {kindLabel(n.kind)}
                  </option>
                ))}
              </select>
            </div>
            <button
              className={btnPrimary}
              onClick={() => onSync()}
              disabled={!selectedId || syncing}
            >
              {syncing && !syncingBrandId ? d.top.syncing : d.top.sync}
            </button>
            {/* 按商家同步（PB brand_id） */}
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                value={brandIdInput}
                onChange={(e) => setBrandIdInput(e.target.value)}
                placeholder={d.top.brandIdPlaceholder}
                disabled={syncing}
                style={{ width: "180px" }}
              />
              <button
                className={btnGhost}
                onClick={onSyncByBrand}
                disabled={!selectedId || syncing || !brandIdInput.trim()}
                title={d.top.syncByBrand}
              >
                {syncing && syncingBrandId
                  ? `${d.top.syncingBrand} ${syncingBrandId}`
                  : d.top.syncByBrand}
              </button>
            </div>
            {supported.length === 0 && (
              <p className="text-sm text-ink/60">{d.top.noNetwork}</p>
            )}
          </div>
          {selected && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink/70">
              <span>
                {d.top.lastPull}：{formatDateTime(selected.lastPullAt)}
              </span>
              <span className="inline-flex items-center gap-2">
                {d.top.pullStatus}：
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${pullStatusColor(
                    selected.pullStatus
                  )}`}
                >
                  {d.top.status[selected.pullStatus as keyof typeof d.top.status] ??
                    selected.pullStatus}
                </span>
              </span>
              {selected.pullError && (
                <span className="text-red-700">{selected.pullError}</span>
              )}
            </div>
          )}
          {syncResult && (
            <>
              <div className="mt-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
                <span className="mr-2 inline-block rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium">
                  {syncResult.scope === "brand"
                    ? `${d.top.scopeBrand} (${syncResult.brandId})`
                    : d.top.scopeFull}
                </span>
                synced {syncResult.synced} · created {syncResult.created} ·
                updated {syncResult.updated} · recommended {syncResult.recommended} ·
                autoCreatedOffers {syncResult.autoCreatedOffers}
                {(syncResult.skippedLowCommission ?? 0) > 0 && (
                  <> · {d.top.skippedLowCommission}：{syncResult.skippedLowCommission}</>
                )}
              </div>
              {syncResult.skipped && (
                <div className="mt-2 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  {d.top.syncSkipped.replace(
                    "{reason}",
                    syncResult.skipReason ?? ""
                  )}
                </div>
              )}
            </>
          )}
          {syncing && syncJob?.stage && (
            <p className="mt-3 text-sm text-ink/60">
              {d.top.syncing} ·{" "}
              {d.top.syncStage[syncJob.stage as keyof typeof d.top.syncStage] ??
                syncJob.stage}
            </p>
          )}
          {syncJobs.length > 0 && (
            <div className="mt-4 border-t border-ink/10 pt-3">
              <p className="text-sm font-medium text-ink/70">
                {d.top.jobsTitle}
              </p>
              <ul className="mt-2 space-y-1.5">
                {syncJobs.map((j) => {
                  const net = networks.find((n) => n.id === j.networkId);
                  const r = j.result;
                  return (
                    <li
                      key={j.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink/70"
                    >
                      <span className="font-medium text-ink">
                        {net ? net.name : j.networkId}
                      </span>
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs">
                        {j.scope === "brand"
                          ? `${d.top.scopeBrand} (${j.brandId ?? ""})`
                          : d.top.scopeFull}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${pullStatusColor(
                          j.status === "succeeded"
                            ? "SUCCESS"
                            : j.status === "failed"
                              ? "FAILED"
                              : j.status === "running" || j.status === "queued"
                                ? "RUNNING"
                                : "NEVER"
                        )}`}
                      >
                        {d.top.jobStatus[j.status] ?? j.status}
                      </span>
                      <span className="text-ink/50">
                        {formatDateTime(j.createdAt)}
                      </span>
                      {j.status === "succeeded" && r && (
                        <span>
                          synced {r.synced} · created {r.created} · updated{" "}
                          {r.updated} · recommended {r.recommended}
                        </span>
                      )}
                      {j.status === "skipped" && r?.skipReason && (
                        <span>{r.skipReason}</span>
                      )}
                      {j.status === "failed" && j.error && (
                        <span className="text-red-700">{j.error}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === "products" && (
        <>
          {/* ===== 采集模式 ===== */}
          <section className={cardCls}>
        <h2 className="text-lg font-semibold text-ink">{d.mode.title}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {supported.map((n) => {
            const sess = sessionOf(n);
            const cookie = cookieInputs[n.id] ?? "";
            return (
              <div
                key={n.id}
                className="rounded-lg border border-ink/10 p-4"
              >
                <p className="font-medium text-ink">
                  {n.name} · {kindLabel(n.kind)}
                </p>
                <div className="mt-3 space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name={`sync-mode-${n.id}`}
                      checked={n.syncMode === "api"}
                      onChange={() => requestModeChange(n, "api")}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-ink">{d.mode.api}</span>
                      <span className="block text-xs text-ink/60">
                        {d.mode.apiHint}
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name={`sync-mode-${n.id}`}
                      checked={n.syncMode === "session"}
                      onChange={() => requestModeChange(n, "session")}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-ink">
                        {d.mode.session}
                      </span>
                      <span className="block text-xs text-amber-700">
                        {d.mode.sessionHint}
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="text-ink/60">{d.mode.sessionStatus}：</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${sessionColor(
                      sess
                    )}`}
                  >
                    {d.mode.sessionBadge[sess]}
                  </span>
                </div>
                {sess === "EXPIRED" && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                    ⚠ {d.mode.expiredWarning}
                  </p>
                )}

                <div className="mt-3">
                  <label className={labelCls} htmlFor={`cookie-${n.id}`}>
                    {d.mode.cookieLabel}
                  </label>
                  <p className="mb-1 text-xs text-amber-700">
                    ⚠ {d.mode.sessionHint}
                  </p>
                  <div className="flex gap-2">
                    <input
                      id={`cookie-${n.id}`}
                      type="password"
                      autoComplete="off"
                      className={inputCls}
                      placeholder={d.mode.cookiePlaceholder}
                      value={cookie}
                      onChange={(e) =>
                        setCookieInputs((m) => ({
                          ...m,
                          [n.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      className={btnGhost}
                      style={{ whiteSpace: "nowrap" }}
                      onClick={() => onSaveCookie(n.id)}
                      disabled={!cookie.trim() || savingCookieId === n.id}
                    >
                      {savingCookieId === n.id
                        ? d.mode.saving
                        : d.mode.saveSession}
                    </button>
                  </div>
                  {cookie && cookieByteLen(cookie) > MAX_COOKIE_BYTES && (
                    <p className="mt-1 text-xs text-red-700">
                      {d.mode.cookieTooLong}
                    </p>
                  )}
                  <details className="mt-2 text-xs text-ink/60">
                    <summary className="cursor-pointer text-signal">
                      {d.mode.cookieGuideTitle}
                    </summary>
                    <p className="mt-1">{d.mode.cookieGuide}</p>
                  </details>
                </div>

                {/* ===== 登录账号（管理已搬至管理控制台；此处仅展示 + 跳转） ===== */}
                <div className="mt-3 border-t border-ink/10 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">
                      {d.mode.credTitle}
                    </span>
                    <Link
                      href="/admin/console?tab=accounts"
                      className="text-xs text-signal underline"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {d.mode.credGoConsole}
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-ink/60">{credInfo(n)}</p>
                </div>
              </div>
            );
          })}
          {supported.length === 0 && (
            <p className="text-sm text-ink/60">{d.top.noNetwork}</p>
          )}
        </div>
      </section>

      {/* ===== 筛选预设 ===== */}
      <section className={cardCls}>
        <h2 className="text-lg font-semibold text-ink">{d.preset.title}</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <label className={labelCls}>{d.preset.minReviews}</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              value={pMinReviews}
              onChange={(e) => setPMinReviews(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{d.preset.minCommissionAmount}</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="0.01"
              value={pMinCommissionAmount}
              onChange={(e) => setPMinCommissionAmount(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{d.preset.minCommissionRate}</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="0.1"
              value={pMinCommissionRate}
              onChange={(e) => setPMinCommissionRate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{d.preset.minPrice}</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="0.01"
              value={pMinPrice}
              onChange={(e) => setPMinPrice(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{d.preset.maxPrice}</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="0.01"
              value={pMaxPrice}
              onChange={(e) => setPMaxPrice(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{d.preset.minScore}</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step="1"
              value={pMinScore}
              onChange={(e) => setPMinScore(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-ink/50">{d.preset.hint}</p>

        {isAdmin && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="font-medium text-ink">{d.preset.adminZone}</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={pAutoCreate}
                  onChange={(e) => setPAutoCreate(e.target.checked)}
                />
                {d.preset.autoCreateOffer}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                {d.preset.autoCreateTopN}
                <input
                  className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1 text-sm"
                  type="number"
                  min={1}
                  max={50}
                  value={pAutoTopN}
                  onChange={(e) => setPAutoTopN(e.target.value)}
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-ink/60">{d.preset.autoCreateHint}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className={btnPrimary}
            onClick={() => onSavePreset(isAdmin)}
            disabled={savingPreset}
          >
            {savingPreset ? d.preset.saving : d.preset.save}
          </button>
          <button
            className={btnGhost}
            onClick={onScreenNow}
            disabled={screening || !selectedId}
          >
            {screening ? d.preset.screening : d.preset.screenNow}
          </button>
          {screenMsg && (
            <span className="text-sm text-emerald-700">{screenMsg}</span>
          )}
        </div>
      </section>

      {/* ===== 商品列表 ===== */}
      <section className={cardCls}>
        <h2 className="text-lg font-semibold text-ink">{d.products.title}</h2>
        {funnel && (
          <div className="mt-3">
            <div
              className="flex h-9 w-full overflow-hidden rounded-lg border border-ink/10 text-sm"
              role="img"
              aria-label={`${d.products.funnelTotal} ${funnel.total} → ${d.products.funnelRecommended} ${funnel.recommended} → ${d.products.funnelLaunchable} ${funnel.launchable} → ${d.products.funnelWithAds} ${funnel.withAds} → ${d.products.funnelOffers} ${funnel.offersCreated ?? "—"}`}
            >
              {(
                [
                  { label: d.products.funnelTotal, n: funnel.total, cls: "bg-slate-200 text-slate-800" },
                  { label: d.products.funnelRecommended, n: funnel.recommended, cls: "bg-sky-200 text-sky-900" },
                  { label: d.products.funnelLaunchable, n: funnel.launchable, cls: "bg-emerald-200 text-emerald-900" },
                  { label: d.products.funnelWithAds, n: funnel.withAds, cls: "bg-amber-200 text-amber-900" },
                  { label: d.products.funnelOffers, n: funnel.offersCreated, cls: "bg-violet-200 text-violet-900" },
                ] as const
              ).map((s, i) => (
                <div
                  key={s.label}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-2 font-medium ${s.cls}${i > 0 ? " border-l border-white/70" : ""}`}
                  title={`${s.label}：${s.n ?? "—"}`}
                >
                  <span className="truncate text-xs">{s.label}</span>
                  <span className="text-base font-bold tabular-nums">
                    {s.n ?? "—"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink/45">
              {d.products.funnelTotal}
              {" "}
              <span className="font-medium text-ink/70 tabular-nums">{funnel.total}</span>
              <span className="mx-1.5 text-ink/30">→</span>
              {d.products.funnelRecommended}
              {" "}
              <span className="font-medium text-ink/70 tabular-nums">{funnel.recommended}</span>
              <span className="mx-1.5 text-ink/30">→</span>
              {d.products.funnelLaunchable}
              {" "}
              <span className="font-medium text-ink/70 tabular-nums">{funnel.launchable}</span>
              <span className="mx-1.5 text-ink/30">→</span>
              {d.products.funnelWithAds}
              {" "}
              <span className="font-medium text-ink/70 tabular-nums">{funnel.withAds}</span>
              <span className="mx-1.5 text-ink/30">→</span>
              {d.products.funnelOffers}
              {" "}
              <span className="font-medium text-ink/70 tabular-nums">
                {funnel.offersCreated ?? "—"}
              </span>
            </p>
            <p className="mt-1 text-xs text-ink/40">
              {d.products.funnelScopeNote}
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-ink/15">
            <button
              className={
                viewMode === "products"
                  ? "bg-signal px-3 py-1.5 text-sm font-medium text-white"
                  : "px-3 py-1.5 text-sm text-ink/70 transition hover:bg-ink/5"
              }
              onClick={() => setViewMode("products")}
            >
              {d.products.viewModeProducts}
            </button>
            <button
              className={
                viewMode === "brands"
                  ? "bg-signal px-3 py-1.5 text-sm font-medium text-white"
                  : "px-3 py-1.5 text-sm text-ink/70 transition hover:bg-ink/5"
              }
              onClick={() => setViewMode("brands")}
            >
              {d.products.viewModeBrands}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["", "inbox", "pool", "testing", "live"] as const).map((st) => (
            <button
              key={st || "all"}
              className={
                poolStageFilter === st
                  ? "rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white"
                  : btnGhost
              }
              onClick={() => setPoolStageFilter(st)}
            >
              {st === "" ? d.products.poolStage.all : d.products.poolStage[st]}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={onlyRecommended}
              onChange={(e) => setOnlyRecommended(e.target.checked)}
            />
            {d.products.onlyRecommended}
          </label>
          <label
            className="flex items-center gap-2 text-sm text-ink"
            title={d.preset.title}
          >
            <input
              type="checkbox"
              checked={applyPreset}
              onChange={(e) => setApplyPreset(e.target.checked)}
            />
            {d.products.autoPresetFilter}
          </label>
          {applyPreset && presetExcluded > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {d.products.presetFilteredNote.replace("{n}", String(presetExcluded))}
            </span>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            {d.products.minAdCount}
            <input
              className={inputCls}
              style={{ width: 90 }}
              type="number"
              min={0}
              step={1}
              placeholder={d.products.minAdCountPlaceholder}
              value={minAdsDraft}
              onChange={(e) => setMinAdsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMinAds();
              }}
              onBlur={commitMinAds}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            {d.products.maxAdCount}
            <input
              className={inputCls}
              style={{ width: 90 }}
              type="number"
              min={0}
              step={1}
              placeholder={d.products.maxAdCountPlaceholder}
              value={maxAdsDraft}
              onChange={(e) => setMaxAdsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMaxAds();
              }}
              onBlur={commitMaxAds}
            />
          </label>
          <button
            className={btnGhost}
            onClick={applySweetSpot}
            title={d.products.sweetSpotTip}
          >
            {d.products.sweetSpot}
          </button>
          <label className="flex items-center gap-2 text-sm text-ink">
            {d.products.colCountry}
            <select
              className={inputCls}
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
            >
              <option value="">{d.products.allCountries}</option>
              {countryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button
            className={btnGhost}
            onClick={onBackfill}
            disabled={backfilling || loadingProducts}
            title={d.products.backfill}
          >
            {backfilling ? d.products.backfilling : d.products.backfill}
          </button>
          <div className="flex gap-2">
            <input
              className={inputCls}
              style={{ width: 260 }}
              placeholder={d.products.searchPlaceholder}
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setQ(qDraft);
                  void reloadProducts(1, qDraft);
                }
              }}
            />
            <button
              className={btnGhost}
              onClick={() => {
                setQ(qDraft);
                void reloadProducts(1, qDraft);
              }}
            >
              {d.products.search}
            </button>
          </div>
          <span className="ml-auto flex items-center gap-3">
            <span className="rounded-full bg-signal/10 px-3 py-1 text-sm font-semibold text-signal">
              {d.products.resultCount.replace("{n}", String(total))}
            </span>
            <span className="text-xs text-ink/50 tabular-nums">
              {page}/{totalPages}
            </span>
            <button
              className={btnGhost}
              onClick={() => void reloadProducts(page - 1)}
              disabled={page <= 1 || loadingProducts}
            >
              {d.products.prev}
            </button>
            <button
              className={btnGhost}
              onClick={() => void reloadProducts(page + 1)}
              disabled={page >= totalPages || loadingProducts}
            >
              {d.products.next}
            </button>
          </span>
        </div>

        {viewMode === "brands" ? (
          <CatalogBrandView
            d={d}
            networkId={selectedId}
            country={countryFilter}
            q={q}
          />
        ) : (
          <>
        {poolStageFilter === "pool" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {d.products.poolStageBanner}
          </p>
        )}
        <p className="mt-3 text-xs text-ink/40">{d.products.dragHint}</p>
        <div
          ref={tableWrapRef}
          onPointerDown={onTablePointerDown}
          onPointerMove={onTablePointerMove}
          onPointerUp={endTableDrag}
          onPointerLeave={endTableDrag}
          className="mt-2 cursor-grab overflow-x-auto rounded-xl border border-ink/10 active:cursor-grabbing"
        >
          <table
            className="table-fixed border-collapse text-sm"
            style={{
              width: "2844px",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
            {/* 固定布局：27 列宽由此唯一决定（合计 2844 = 表宽），auto 布局下
                各列 min-content 总和过约束会把广告格压成逐字竖排、盖住操作列。
                左右 sticky 偏移与此严格对应：序号列 left-[36px] = 复选列宽 36，
                操作列 right-0 自身宽 164。改列宽必须同步改这两处。 */}
            <colgroup>
              <col className="w-[36px]" />
              <col className="w-[44px]" />
              <col className="w-[84px]" />
              <col className="w-[112px]" />
              <col className="w-[76px]" />
              <col className="w-[80px]" />
              <col className="w-[132px]" />
              <col className="w-[96px]" />
              <col className="w-[72px]" />
              <col className="w-[84px]" />
              <col className="w-[116px]" />
              <col className="w-[112px]" />
              <col className="w-[126px]" />
              <col className="w-[104px]" />
              <col className="w-[112px]" />
              <col className="w-[100px]" />
              <col className="w-[96px]" />
              <col className="w-[190px]" />
              <col className="w-[230px]" />
              <col className="w-[84px]" />
              <col className="w-[104px]" />
              <col className="w-[88px]" />
              <col className="w-[122px]" />
              <col className="w-[88px]" />
              <col className="w-[92px]" />
              <col className="w-[100px]" />
              <col className="w-[164px]" />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#f7f8fa] text-left text-sm text-ink/55 [&>th]:whitespace-nowrap">
                <th className="sticky left-0 z-30 w-[36px] min-w-[36px] bg-inherit px-2 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={d.products.selectAll}
                    checked={allChecked}
                    onChange={toggleAll}
                  />
                </th>
                <th className="sticky left-[36px] z-30 w-[44px] min-w-[44px] bg-inherit px-2 py-2.5 ">
                  {d.products.colSeq}
                </th>
                <th className="px-3 py-2.5 ">{d.products.colNetwork}</th>
                <th className="px-3 py-2.5 ">{d.products.colAccount}</th>
                <th className="px-3 py-2.5 ">{d.products.colStatus}</th>
                <th className="px-3 py-2.5 ">{d.products.colMid}</th>
                <th className="px-3 py-2.5 ">{d.products.colMerchant}</th>
                <th className="px-3 py-2.5 ">{d.products.colSettlementRate}</th>
                <th className="px-3 py-2.5 ">{d.products.colApprovalRate}</th>
                <th className="px-3 py-2.5 ">{d.products.colPayoutCycle}</th>
                <th className="px-3 py-2.5 ">{d.products.colPoolStage}</th>
                {sortTh("brand", d.products.colBrand)}
                {sortTh(
                  "asin",
                  <>
                    {d.products.colAsin}
                    <span className="ml-1 text-ink/35" title={d.products.asinTip ?? ""}>
                      ℹ️
                    </span>
                  </>
                )}
                <th className="px-3 py-2.5 ">{d.products.colLandingType}</th>
                {sortTh("reviews", d.products.colReviews)}
                {sortTh("score", d.products.colScore)}
                {sortTh("priority", d.products.colTestPriority)}
                <th className="w-[190px] px-3 py-2.5">{d.products.colAds}</th>
                <th className="min-w-[220px] max-w-[280px] px-3 py-2.5 ">
                  {d.products.colName}
                </th>
                <th className="px-3 py-2.5 ">{d.products.colCountry}</th>
                {sortTh("price", d.products.colPrice)}
                <th className="px-3 py-2.5 ">{d.products.colCommissionRate}</th>
                <th className="px-3 py-2.5 ">{d.products.colCommissionAmount}</th>
                <th className="px-3 py-2.5 ">{d.products.colPromo}</th>
                <th className="px-3 py-2.5 ">{d.products.colOfferCount}</th>
                {sortTh("created", d.products.colCreated)}
                <th className="sticky right-0 z-30 bg-[#f7f8fa] px-3 py-2.5 shadow-[-1px_0_0_0_rgba(0,0,0,0.06)]">
                  {d.products.colActions}
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const blacklisted = !!p.blacklisted;
                const probe = adProbeFields(p);
                const seq = (page - 1) * PAGE_SIZE + i + 1;
                return (
                  <tr
                    key={p.id}
                    className={
                      blacklisted
                        ? "border-t border-ink/5 bg-ink/[0.04] opacity-60"
                        : "border-t border-ink/5 bg-white hover:bg-ink/[0.02]"
                    }
                  >
                    <td className="sticky left-0 z-10 w-[36px] min-w-[36px] bg-inherit px-2 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleOne(p.id, blacklisted)}
                        disabled={blacklisted}
                        title={
                          blacklisted
                            ? d.products.blacklistedNoCheck
                            : undefined
                        }
                      />
                    </td>
                    <td className="sticky left-[36px] z-10 w-[44px] min-w-[44px] bg-inherit px-2 py-3 text-xs tabular-nums text-ink/50">
                      {seq}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-medium text-ink/70">
                        {kindAbbr(p.networkKind)}
                      </span>
                    </td>
                    <td
                      className="max-w-[160px] truncate whitespace-nowrap px-3 py-2 text-ink/70"
                      title={p.networkName ?? kindLabel(p.networkKind ?? "")}
                    >
                      {p.networkName ?? kindLabel(p.networkKind ?? "")}
                    </td>
                    <td className="px-3 py-2">
                      {p.status === "inactive" ? (
                        <span className="whitespace-nowrap rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60">
                          {d.products.statusInactive}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {d.products.statusActive}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-ink/70">
                      {p.mid ?? "—"}
                    </td>
                    <td
                      className="max-w-[180px] truncate whitespace-nowrap px-3 py-2 text-ink/70"
                      title={p.merchantName ?? undefined}
                    >
                      {p.merchantName ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">
                      {p.settlementRatePct != null
                        ? `${p.settlementRatePct}%`
                        : d.products.settlementUnverified}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">
                      {p.approvalRatePct != null ? `${p.approvalRatePct}%` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">
                      {p.payoutCycleDays != null
                        ? d.products.payoutDays.replace(
                            "{n}",
                            String(p.payoutCycleDays)
                          )
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <select
                        className="rounded-md border border-ink/15 bg-white px-1.5 py-1 text-xs text-ink/80"
                        value={(p.poolStage as PoolStage) ?? "inbox"}
                        disabled={movingStage}
                        onChange={(e) =>
                          void onMovePoolStageOne(
                            p,
                            e.target.value as PoolStage
                          )
                        }
                        aria-label={d.products.colPoolStage}
                      >
                        {(["inbox", "pool", "testing", "live"] as const).map(
                          (st) => (
                            <option key={st} value={st}>
                              {d.products.poolStage[st]}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                    <td
                      className="max-w-[150px] truncate whitespace-nowrap px-3 py-2 text-ink/70"
                      title={p.brand ?? undefined}
                    >
                      {p.brand ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink/70">
                      {p.asin ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {landingPageTypeLabel(p.landingPageType)}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink/70">
                      {fmtNum(p.reviewCount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">
                      {p.recommendationScore != null ? (
                        <span title={d.products.scoreTip ?? "推荐指数"}>
                          <span className="mr-1">⭐</span>
                          {fmtNum(p.recommendationScore)}
                          <span className="ml-1 text-ink/35">ⓘ</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {/* 测试优先分（后端与 Offer 侧同构现算）：分数 + 首条理由小字，
                          全部理由在 title 悬停；仅 priority_desc 时按全局序号点亮
                          前 5 名「先测」徽标（与 Offer 页同一组件、同一口径）。 */}
                      <OfferTestPriorityCell
                        priority={p.testPriority ?? null}
                        rank={priorityRankFor(sort, seq)}
                        dict={{ testFirst: d.products.testFirst }}
                      />
                    </td>
                    <td className="w-[190px] min-w-[170px] max-w-[210px] px-3 py-2">
                      {p.adCount == null && probe.longtail == null ? (
                        <span className="text-xs text-ink/40">
                          {d.products.adsNotCalculated}
                          {probe.policyRisk && (
                            <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                              {d.products.adPolicyRisk}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="block">
                          {/* 首行（条数+档位+趋势+各类徽标）必须可换行收进本格：
                              整行 nowrap 会横向溢出、盖住右侧 sticky 操作列拦截点击。 */}
                          <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                          {p.adCount != null && (
                            <>
                          <span className="tabular-nums text-ink/80">
                            {d.products.adsApprox.replace(
                              "{n}",
                              String(p.adCount)
                            )}
                          </span>
                          {(() => {
                            const tier = adCountTier(p.adCount);
                            if (!tier) return null;
                            const tierLabel =
                              tier.key === "none"
                                ? d.products.adTierNone
                                : tier.key === "small"
                                  ? d.products.adTierSmall
                                  : tier.key === "sweet"
                                    ? d.products.adTierSweet
                                    : tier.key === "hot"
                                      ? d.products.adTierHot
                                      : d.products.adTierRedOcean;
                            const tierCls =
                              tier.key === "none"
                                ? "bg-gray-100 text-gray-600"
                                : tier.key === "small"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : tier.key === "sweet"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : tier.key === "hot"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-red-100 text-red-800";
                            return (
                              <span
                                className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tierCls}`}
                                title={d.products.adTierTip}
                              >
                                {tierLabel}
                              </span>
                            );
                          })()}
                          <AdTrendMark
                            trend={p.adTrend ?? null}
                            lastAdCount={p.lastAdCount ?? null}
                            lastAdCountAt={p.lastAdCountAt ?? null}
                            d={d.products}
                          />
                          {p.adCountCheckedAt &&
                            Date.now() -
                              new Date(p.adCountCheckedAt).getTime() >
                              14 * 24 * 3600 * 1000 && (
                              <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                {d.products.adsExpired}
                              </span>
                            )}
                            </>
                          )}
                          {probe.policyRisk && (
                            <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                              {d.products.adPolicyRisk}
                            </span>
                          )}
                          </span>
                          {p.adCountSelf != null &&
                            p.adCountOthers != null && (
                              <span className="block text-[11px] text-ink/50">
                                {d.products.adsSelfOthers
                                  .replace("{s}", String(p.adCountSelf))
                                  .replace("{o}", String(p.adCountOthers))}
                              </span>
                            )}
                          {(() => {
                            const split = adLandingSplitText(
                              p.adCountHome,
                              p.adCountProduct,
                              d.products
                            );
                            return split ? (
                              <span className="block text-[11px] text-ink/50">
                                {split}
                              </span>
                            ) : null;
                          })()}
                          {probe.longtail != null && (
                            <span className="block text-[11px] text-ink/50">
                              {d.products.adsLongtailShort.replace(
                                "{n}",
                                String(probe.longtail)
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td
                      className="min-w-[220px] max-w-[280px] px-3 py-2"
                      title={p.name}
                    >
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{p.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {p.recommended && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            {d.products.recommendedBadge}
                          </span>
                        )}
                        {blacklisted && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            {d.products.blacklistedBadge}
                          </span>
                        )}
                        {p.whitelisted && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                            {d.products.whitelistedBadge}
                          </span>
                        )}
                        {p.screenVerdict === "kill" && (
                          <span
                            className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                            title={p.screenReason ?? undefined}
                          >
                            {d.products.screenVerdictKill}
                          </span>
                        )}
                        {p.screenVerdict === "review" && (
                          <span
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            title={p.screenReason ?? undefined}
                          >
                            {d.products.screenVerdictReview}
                          </span>
                        )}
                        {p.screenVerdict === "pass" && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            {d.products.screenVerdictPass}
                          </span>
                        )}
                      </span>
                    </td>
                    
                    <td className="whitespace-nowrap px-3 py-2 text-ink/70">
                      {p.countryCode ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/80">
                      {fmtMoney(p.price, p.currency)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/80">
                      {fmtRate(p.commissionRate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/80">
                      {commissionAmountCell(p)}
                    </td>
                    <td className="px-3 py-2">
                      {p.promoUrl ? (
                        <a
                          href={p.promoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="whitespace-nowrap text-signal hover:underline"
                        >
                          {d.products.viewLink}
                        </a>
                      ) : (
                        <span className="text-ink/40">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {(launchCounts[p.id] ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="text-[13px] text-signal hover:underline"
                          onClick={() =>
                            setHistoryFor({ id: p.id, name: p.name })
                          }
                          title={d.products.launchHistoryTip ?? ""}
                        >
                          {(d.products.launchTimes ?? "{n} 次").replace(
                            "{n}",
                            String(launchCounts[p.id])
                          )}
                        </button>
                      ) : (
                        <span className="text-ink/40">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-ink/60">
                      {formatDate(p.createdAt)}
                    </td>
                    <td
                      className={`sticky right-0 z-20 px-3 py-2 shadow-[-1px_0_0_0_rgba(0,0,0,0.06)] ${
                        blacklisted ? "bg-[#f5f5f6]" : "bg-white"
                      }`}
                    >
                      <span className="flex gap-2">
                        <button
                          className="whitespace-nowrap text-xs text-signal hover:underline disabled:opacity-40"
                          onClick={() => void onCreateOfferOne(p.id)}
                          disabled={batching || blacklisted}
                        >
                          {d.products.createOfferOne}
                        </button>
                        {p.screenVerdict === "kill" && (
                          <button
                            className="whitespace-nowrap text-xs text-amber-700 hover:underline disabled:opacity-40"
                            onClick={() => void onForceSelectOne(p.id)}
                            disabled={forceSelectingId !== null}
                            title={p.screenReason ?? undefined}
                          >
                            {forceSelectingId === p.id
                              ? d.products.forceSelecting
                              : d.products.forceSelect}
                          </button>
                        )}
                        <button
                          className="whitespace-nowrap text-xs text-ink/60 hover:underline disabled:opacity-40"
                          onClick={() => void onOfflineOne(p)}
                          disabled={offlining || p.status === "inactive"}
                        >
                          {d.products.offlineOne}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loadingProducts && products.length === 0 && (
            <p className="py-6 text-center text-sm text-ink/50">
              {d.products.empty}
            </p>
          )}
          {loadingProducts && (
            <p className="py-6 text-center text-sm text-ink/50">…</p>
          )}
          {historyFor && (
            <LaunchHistoryModal
              productId={historyFor.id}
              productName={historyFor.name}
              lang={lang}
              onClose={() => setHistoryFor(null)}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          {/* ── 日常操作：选择辅助 + 一键筛选 + 批量动作（每天用） ── */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink/45">
              {d.products.toolbarGroupEveryday}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={sort.startsWith("brand_") ? btnPrimary : btnGhost}
                onClick={() => setSort("brand_asc")}
              >
                {d.products.sortBrandFirst}
              </button>
              <label className="flex items-center gap-2 text-sm text-ink/80">
                {d.products.addedDateLabel}
                <input
                  type="date"
                  className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80"
                  value={addedDate}
                  onChange={(e) => setAddedDate(e.target.value)}
                />
              </label>
              <button
                className={btnGhost}
                onClick={onSelectAddedByDate}
                disabled={selectingAdded}
              >
                {selectingAdded
                  ? d.products.selectingAdded
                  : d.products.selectAddedByDate}
              </button>
              <button
                className={btnGhost}
                onClick={() => void onOneClickScreen("selected")}
                disabled={oneClickBusy || selectedIds.size === 0}
              >
                {oneClickBusy
                  ? d.products.oneClickScreening
                  : `${d.products.oneClickScreen} · ${d.products.oneClickScopeSelected.replace("{n}", String(selectedIds.size))}`}
              </button>
              <button
                className={btnGhost}
                onClick={() => void onOneClickScreen("current")}
                disabled={oneClickBusy}
              >
                {`${d.products.oneClickScreen} · ${d.products.oneClickScopeCurrent}`}
              </button>
              <button
                className={btnGhost}
                onClick={() => void onOneClickScreen("unscreened")}
                disabled={oneClickBusy}
              >
                {`${d.products.oneClickScreen} · ${d.products.oneClickScopeUnscreened}`}
              </button>
              <button
                className={btnPrimary}
                onClick={onBatchCreate}
                disabled={batching || selectedIds.size === 0}
              >
                {batching ? d.products.creating : d.products.batchCreate}
              </button>
              <button
                className={btnGhost}
                onClick={onBatchOffline}
                disabled={offlining || selectedIds.size === 0}
              >
                {offlining
                  ? d.products.offlining
                  : d.products.batchOffline.replace("{n}", String(selectedIds.size))}
              </button>
              <select
                className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80"
                value={batchPoolStage}
                onChange={(e) => setBatchPoolStage(e.target.value as PoolStage)}
                aria-label={d.products.colPoolStage}
              >
                {(["inbox", "pool", "testing", "live"] as const).map((st) => (
                  <option key={st} value={st}>
                    {d.products.poolStage[st]}
                  </option>
                ))}
              </select>
              <button
                className={btnGhost}
                onClick={onBatchMovePoolStage}
                disabled={movingStage || selectedIds.size === 0}
              >
                {movingStage ? d.products.movingPoolStage : d.products.movePoolStage}
              </button>
              <span className="text-sm text-ink/60">
                ({selectedIds.size})
              </span>
            </div>
          </div>

          {/* ── 数据计算 · 偶尔用：付费/后台计算（视觉弱化容器区隔，不折叠） ── */}
          <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-3 pb-2.5 pt-2">
            <p className="mb-1.5 text-xs font-medium text-ink/45">
              {d.products.toolbarGroupCompute}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={btnGhost}
                onClick={onCalcScore}
                disabled={calcScoring || selectedIds.size === 0}
              >
                {calcScoring
                  ? d.products.calculating
                  : d.products.calcScore.replace("{n}", String(selectedIds.size))}
              </button>
              <button
                className={btnGhost}
                onClick={onCalcAdCount}
                disabled={calcAdCounting || adCalcPreviewing || adCalcConfirm !== null}
                title={d.products.calcAdCountAll}
              >
                {calcAdCounting
                  ? d.products.calculatingAds
                  : adCalcPreviewing
                    ? d.products.calcPreviewing
                    : selectedIds.size > 0
                      ? d.products.calcAdCount.replace(
                          "{n}",
                          String(selectedIds.size)
                        )
                      : d.products.calcAdCountAll}
              </button>
              <select
                className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80"
                value={adCalcScope}
                onChange={(e) => setAdCalcScope(e.target.value as CalcAdCountScope)}
                aria-label={d.products.calcScopeLabel}
              >
                <option value="all">{d.products.calcScopeAll}</option>
                <option value="alive">{d.products.calcScopeAlive}</option>
              </select>
              <label className="flex items-center gap-1.5 text-sm text-ink/80">
                <input
                  type="checkbox"
                  checked={adCalcForce}
                  onChange={(e) => setAdCalcForce(e.target.checked)}
                />
                {d.products.calcForceLabel}
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink/80">
                {d.products.calcDepthLabel}
                <select
                  className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80"
                  value={adCalcDepth}
                  onChange={(e) =>
                    setAdCalcDepth(Number(e.target.value) as CalcDepth)
                  }
                  aria-label={d.products.calcDepthLabel}
                >
                  {CALC_DEPTH_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <PaidDataBillingNote
                feature="catalog-ad-count"
                labels={{
                  platform: d.products.billingPlatform,
                  platformNoLimit: d.products.billingPlatformNoLimit,
                  tenantOwn: d.products.billingTenantOwn,
                  owner: d.products.billingOwner,
                  denied: d.products.billingDenied,
                  loading: d.products.billingLoading,
                }}
              />
              <button
                className={btnGhost}
                onClick={onToggleScorePause}
                disabled={togglingPause}
              >
                {togglingPause
                  ? "…"
                  : scorePaused
                    ? d.products.resumeScoreCalc
                    : d.products.pauseScoreCalc}
              </button>
              {scorePaused && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {d.products.scoreCalcPausedBadge}
                </span>
              )}
            </div>
            {adCalcForce && (
              <p className="mt-2 text-xs text-amber-700">
                {d.products.calcForceWarning}
              </p>
            )}
          </div>
        </div>

        {/* ===== 广告数付费计算：预估确认框（防误触，先看数字再确认） ===== */}
        {adCalcConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-ink">
                {d.products.calcConfirmTitle}
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm text-ink/80">
                <li className="font-medium text-ink">
                  {d.products.calcConfirmBillable.replace(
                    "{n}",
                    String(adCalcConfirm.facts.billableGroups)
                  )}
                </li>
                {adCalcConfirm.facts.freshSkipped > 0 && (
                  <li>
                    {d.products.calcConfirmFreshSkipped.replace(
                      "{n}",
                      String(adCalcConfirm.facts.freshSkipped)
                    )}
                  </li>
                )}
                {adCalcConfirm.facts.deadSkipped > 0 && (
                  <li>
                    {d.products.calcConfirmDeadSkipped.replace(
                      "{n}",
                      String(adCalcConfirm.facts.deadSkipped)
                    )}
                  </li>
                )}
                <li className="flex items-center gap-2">
                  <span>
                    {d.products.calcConfirmDepth.replace(
                      "{n}",
                      String(adCalcConfirm.depth)
                    )}
                  </span>
                  <select
                    className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-sm text-ink/80"
                    value={adCalcConfirm.depth}
                    disabled={adCalcRepricing || calcAdCounting}
                    onChange={(e) =>
                      void onConfirmDepthChange(
                        Number(e.target.value) as CalcDepth
                      )
                    }
                    aria-label={d.products.calcDepthLabel}
                  >
                    {CALC_DEPTH_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {adCalcRepricing && (
                    <span className="text-xs text-ink/50">
                      {d.products.calcPreviewing}
                    </span>
                  )}
                </li>
                {adCalcConfirm.facts.expectedQueries !== null && (
                  <li>
                    {d.products.calcConfirmExpectedQueries.replace(
                      "{n}",
                      String(adCalcConfirm.facts.expectedQueries)
                    )}
                  </li>
                )}
                {adCalcConfirm.facts.worstCaseQueries !== null && (
                  <li>
                    {d.products.calcConfirmWorstCaseQueries.replace(
                      "{n}",
                      String(adCalcConfirm.facts.worstCaseQueries)
                    )}
                  </li>
                )}
                {adCalcConfirm.facts.estimatedCostUsd !== null &&
                  adCalcConfirm.facts.unitPriceUsd !== null && (
                    <li className="font-medium text-ink">
                      {d.products.calcConfirmEstCost
                        .replace(
                          "{cost}",
                          formatUsdAmount(adCalcConfirm.facts.estimatedCostUsd)
                        )
                        .replace(
                          "{unit}",
                          formatUsdAmount(adCalcConfirm.facts.unitPriceUsd)
                        )}
                    </li>
                  )}
                <li>
                  {adCalcConfirm.scope === "alive"
                    ? d.products.calcConfirmScopeAlive
                    : d.products.calcConfirmScopeAll}
                </li>
                <li>
                  {adCalcConfirm.force
                    ? d.products.calcConfirmModeForce
                    : d.products.calcConfirmModeIncremental}
                </li>
                {adCalcConfirm.facts.keySource && (
                  <li>
                    {d.products.calcConfirmBilling.replace(
                      "{path}",
                      adCalcConfirm.facts.keySource === "owner"
                        ? d.products.calcBillingOwner
                        : adCalcConfirm.facts.keySource === "tenant-own"
                          ? d.products.calcBillingTenantOwn
                          : d.products.calcBillingPlatform
                    )}
                  </li>
                )}
              </ul>
              {!adCalcConfirm.facts.allowed && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {d.products.calcConfirmDenied}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <button
                  className={btnGhost}
                  onClick={() => setAdCalcConfirm(null)}
                  disabled={calcAdCounting}
                >
                  {d.products.calcConfirmCancel}
                </button>
                <button
                  className={btnPrimary}
                  onClick={onConfirmCalcAdCount}
                  disabled={
                    calcAdCounting ||
                    adCalcRepricing ||
                    !adCalcConfirm.facts.allowed
                  }
                >
                  {calcAdCounting
                    ? d.products.calculatingAds
                    : d.products.calcConfirmSubmit}
                </button>
              </div>
            </div>
          </div>
        )}

          </>
        )}

        {batchResult && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
              {d.products.batchResultCreated.replace(
                "{n}",
                String(batchResult.created.length)
              )}
            </p>
            {batchResult.created.length > 0 && (
              <p className="flex flex-wrap gap-4 px-1 text-sm">
                <Link href="/offers" className="font-medium text-signal hover:underline">
                  {d.products.batchResultGoOffers}
                </Link>
                <Link
                  href={`/ai/analyze?offerId=${encodeURIComponent(batchResult.created[0].offerId)}`}
                  className="font-medium text-signal hover:underline"
                >
                  {d.products.batchResultGoAnalyze}
                </Link>
              </p>
            )}
            {batchResult.skippedExisting &&
              batchResult.skippedExisting.length > 0 && (
                <p className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-ink/70">
                  {d.products.batchResultSkippedExisting.replace(
                    "{n}",
                    String(batchResult.skippedExisting.length)
                  )}
                </p>
              )}
            {batchResult.skippedBlacklist &&
              batchResult.skippedBlacklist.length > 0 && (
                <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  <p className="font-medium">
                    {d.products.skippedBlacklistNote}
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {batchResult.skippedBlacklist.map((s) => (
                      <li key={s.productId}>
                        <span className="font-mono text-xs">
                          {s.productId}
                        </span>
                        ：{s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            {batchResult.failed.length > 0 && (
              <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">
                <p className="font-medium">
                  {d.products.batchResultFailed}：
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {batchResult.failed.map((f) => (
                    <li key={f.productId}>
                      <span className="font-mono text-xs">{f.productId}</span>
                      ：{f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {screenReport && (
          <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-ink/80">
            <p className="font-medium text-ink">{d.products.oneClickReportTitle}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span>{d.products.oneClickProcessed.replace("{n}", String(screenReport.processed))}</span>
              <span>{d.products.oneClickKilledBlacklist.replace("{n}", String(screenReport.killedBlacklist))}</span>
              <span>{d.products.oneClickKilledCommission.replace("{n}", String(screenReport.killedCommission))}</span>
              <span>{d.products.oneClickKilledPreset.replace("{n}", String(screenReport.killedPreset))}</span>
              <span>{d.products.oneClickKilledAdCount.replace("{n}", String(screenReport.killedAdCount))}</span>
              <span>{d.products.oneClickKilledTrafficGate.replace("{n}", String(screenReport.killedTrafficGate))}</span>
              <span>{d.products.oneClickReview.replace("{n}", String(screenReport.review))}</span>
              <span>{d.products.oneClickPassed.replace("{n}", String(screenReport.passed))}</span>
              {typeof screenReport.adStoppedCount === "number" && (
                <span>{d.products.oneClickAdStopped.replace("{n}", String(screenReport.adStoppedCount))}</span>
              )}
              {typeof screenReport.adWaivedCount === "number" && (
                <span>{d.products.oneClickAdWaived.replace("{n}", String(screenReport.adWaivedCount))}</span>
              )}
            </p>
            <p className="mt-1">
              {d.products.oneClickOffers
                .replace("{c}", String(screenReport.offersCreated))
                .replace("{s}", String(screenReport.offersSkippedExisting))
                .replace("{f}", String(screenReport.offersFailed.length))}
            </p>
            {killedTotalOf(screenReport) > 0 && (
              <p className="mt-2">
                <button className={btnGhost} onClick={onViewKilled}>
                  {d.products.oneClickViewKilled.replace(
                    "{n}",
                    String(killedTotalOf(screenReport))
                  )}
                </button>
              </p>
            )}
            <p className="mt-1 text-xs text-ink/60">
              {`${d.products.adTierNone} ${screenReport.adTierDistribution.none} · ${d.products.adTierSmall} ${screenReport.adTierDistribution.small} · ${d.products.adTierSweet} ${screenReport.adTierDistribution.sweet} · ${d.products.adTierHot} ${screenReport.adTierDistribution.hot} · ${d.products.adTierRedOcean} ${screenReport.adTierDistribution.red_ocean}`}
            </p>
            {screenReport.skippedPaidLayer && (
              <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-amber-900">
                {d.products.oneClickSkippedPaid.replace("{reason}", "skipped_paid")}
              </p>
            )}
            {screenReport.truncated && (
              <p className="mt-1 text-amber-700">{d.products.oneClickTruncated}</p>
            )}
            {screenReport.offersFailed.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-red-700">
                {screenReport.offersFailed.slice(0, 5).map((f) => (
                  <li key={f.productId}>
                    <span className="font-mono text-xs">{f.productId}</span>：{f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
        </>
      )}

      {tab === "blacklist" && (
        <BlacklistPanel d={d} isAdmin={isAdmin} showMsg={setMsg} />
      )}
      {tab === "whitelist" && (
        <WhitelistPanel d={d} showMsg={setMsg} />
      )}


      {/* ===== 切换 session 模式的风险确认弹窗 ===== */}
      {modePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink">
              {d.mode.switchTitle}
            </h3>
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-4 text-sm leading-6 text-ink/90">
              {d.mode.riskText}
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={riskChecked}
                onChange={(e) => {
                  setRiskChecked(e.target.checked);
                  if (e.target.checked) setRiskError(false);
                }}
              />
              {d.mode.riskCheckbox}
            </label>
            {riskError && (
              <p className="mt-1 text-xs text-red-700">
                {d.mode.riskCheckboxRequired}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className={btnGhost}
                onClick={() => {
                  setModePending(null);
                  setRiskChecked(false);
                }}
                disabled={modeSaving}
              >
                {d.mode.cancel}
              </button>
              <button
                className={btnPrimary}
                onClick={confirmSessionMode}
                disabled={modeSaving}
              >
                {modeSaving ? d.mode.saving : d.mode.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
