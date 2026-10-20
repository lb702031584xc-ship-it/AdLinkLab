"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as catalogZh, en as catalogEn } from "@/i18n/dict/catalog";
import {
  addBlacklistAction,
  addWhitelistAction,
  backfillCatalogProductsAction,
  batchCreateOffersAction,
  calcScoreAction,
  confirmWhitelistAction,
  deleteBlacklistAction,
  deleteWhitelistAction,
  evaluateMerchantsAction,
  getScoreCalcPausedAction,
  getSessionStatusAction,
  importBlacklistAction,
  listBlacklistAction,
  getProductLaunchCountsAction,
  listCatalogProductsAction,
  listMerchantSignalsAction,
  listWhitelistAction,
  offlineProductsAction,
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
  type CatalogChannel,
  type CatalogNetwork,
  type CatalogProduct,
  type MerchantEvaluateResult,
  type MerchantSignal,
  type RecheckResult,
  type ScreeningPreset,
  type SessionStatus,
  type SyncMode,
  type SyncResult,
  type WhitelistEntry,
} from "@/lib/api/catalog-actions";
import { LaunchHistoryModal } from "./launch-history-modal";
import { selectableProducts } from "./list-helpers";
import Link from "next/link";

type Dict = typeof catalogZh;

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
    const res = await evaluateMerchantsAction(channel);
    setEvaluating(false);
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
  }

  async function toggleSignals(merchantId: string) {
    if (expandedId === merchantId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(merchantId);
    if (signals[merchantId] || signalsLoading === merchantId) return;
    setSignalsLoading(merchantId);
    const res = await listMerchantSignalsAction(merchantId, channel);
    setSignalsLoading(null);
    if (!res.ok) {
      showMsg(res.error);
      setExpandedId(null);
      return;
    }
    setSignals((m) => ({ ...m, [merchantId]: res.data }));
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
      const res = await listBlacklistAction(entityType || undefined, ch);
      setLoading(false);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setEntries(res.data);
    },
    [showMsg]
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
    const res = await addBlacklistAction({
      entityType: fType,
      entityId,
      reason,
      channel: fChannel,
    });
    setAdding(false);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    setFId("");
    setFReason("");
    showMsg(d.blacklist.added);
    await load(filter || undefined, channel);
  }

  async function onRecheck(id: string) {
    if (recheckingId) return;
    setRecheckingId(id);
    const res = await recheckBlacklistAction(id);
    setRecheckingId(null);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    setRecheckOutcomes((m) => ({ ...m, [id]: res.data }));
    showMsg(d.blacklist.recheckDone);
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
    const res = await importBlacklistAction(items);
    setImporting(false);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    setImportResult(res.data);
    if (res.data.added > 0) {
      await load(filter || undefined, channel);
    }
  }

  async function confirmDelete() {
    if (!deletingEntry || deleting) return;
    if (!deleteReason.trim()) {
      setDeleteReasonError(true);
      return;
    }
    setDeleting(true);
    const res = await deleteBlacklistAction(
      deletingEntry.id,
      deleteReason.trim()
    );
    setDeleting(false);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    setDeletingEntry(null);
    setDeleteReason("");
    showMsg(d.blacklist.deleted);
    await load(filter || undefined, channel);
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
      const res = await listWhitelistAction(ch);
      setLoading(false);
      if (!res.ok) {
        showMsg(res.error);
        return;
      }
      setEntries(res.data);
    },
    [showMsg]
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
    const note = fNote.trim();
    const res = await addWhitelistAction({
      entityType: fType,
      entityId,
      note: note || undefined,
      channel: fChannel,
    });
    setAdding(false);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    setFId("");
    setFNote("");
    showMsg(d.whitelist.added);
    await load(channel);
  }

  async function onConfirm(id: string) {
    if (confirmingId) return;
    setConfirmingId(id);
    const res = await confirmWhitelistAction(id);
    setConfirmingId(null);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    showMsg(d.whitelist.confirmed);
    await load(channel);
  }

  async function onDelete(id: string) {
    if (deletingId) return;
    if (!window.confirm(d.whitelist.confirmDelete)) return;
    setDeletingId(id);
    const res = await deleteWhitelistAction(id);
    setDeletingId(null);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    showMsg(d.whitelist.deleted);
    await load(channel);
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
  const [syncing, setSyncing] = useState(false);
  const [syncForbidden, setSyncForbidden] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  /** 按商家同步：品牌 ID 输入框。 */
  const [brandIdInput, setBrandIdInput] = useState("");
  /** 正在按商家同步时的 brandId（用于显示状态）。 */
  const [syncingBrandId, setSyncingBrandId] = useState<string | null>(null);

  async function onSync(brandId?: string) {
    if (!selectedId || syncing) return;
    const trimmedBrandId = brandId?.trim() || undefined;
    setSyncing(true);
    setSyncingBrandId(trimmedBrandId ?? null);
    setMsg(null);
    setSyncForbidden(false);
    setSyncResult(null);
    const res = await syncCatalogAction(selectedId, trimmedBrandId);
    setSyncing(false);
    setSyncingBrandId(null);
    if (!res.ok) {
      if (res.forbidden) {
        setSyncForbidden(true);
      } else {
        setMsg(res.error);
      }
      return;
    }
    setSyncResult(res.data);
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
    const res = await setSyncModeAction(networkId, mode, confirmTosRisk);
    setModeSaving(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setNetworks((ns) =>
      ns.map((n) => (n.id === networkId ? { ...n, syncMode: mode } : n))
    );
    setModePending(null);
    setRiskChecked(false);
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
    const res = await saveSessionCookieAction(networkId, value);
    setSavingCookieId(null);
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

  async function onSavePreset(adminFields: boolean) {
    if (savingPreset) return;
    setSavingPreset(true);
    setMsg(null);
    const topN = numOrNull(pAutoTopN);
    const res = await saveScreeningPresetAction({
      minReviews: numOrNull(pMinReviews),
      minCommissionAmount: numOrNull(pMinCommissionAmount),
      minCommissionRate: numOrNull(pMinCommissionRate),
      minPrice: numOrNull(pMinPrice),
      maxPrice: numOrNull(pMaxPrice),
      minScore: numOrNull(pMinScore),
      autoCreateOffer: adminFields ? pAutoCreate : undefined,
      autoCreateTopN: adminFields ? Math.min(50, Math.max(1, Math.round(topN ?? 20))) : undefined,
      admin: adminFields,
    });
    setSavingPreset(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setMsg(d.preset.saved);
  }

  async function onScreenNow() {
    if (screening) return;
    setScreening(true);
    setScreenMsg(null);
    const res = await screenCatalogAction(selectedId || undefined);
    setScreening(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setScreenMsg(d.preset.screened);
    await reloadProducts(1);
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
    const query = (qOverride ?? q).trim();
    const res = await listCatalogProductsAction({
      networkId: selectedId,
      recommended: onlyRecommended ? true : undefined,
      q: query || undefined,
      page: targetPage,
      pageSize: PAGE_SIZE,
      preset: applyPreset ? undefined : false,
      sort,
    });
    setLoadingProducts(false);
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
  }

  async function onBackfill() {
    if (backfilling || !selectedId) return;
    setBackfilling(true);
    setMsg(null);
    const res = await backfillCatalogProductsAction(selectedId);
    setBackfilling(false);
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
  }

  async function onCreateOfferOne(id: string) {
    if (batching) return;
    setBatching(true);
    setMsg(null);
    const res = await batchCreateOffersAction([id]);
    setBatching(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setMsg(d.products.batchResultCreated.replace("{n}", String(res.data.created.length)));
    await reloadProducts(page);
  }

  async function onOfflineOne(p: CatalogProduct) {
    if (offlining) return;
    if (!window.confirm(d.products.offlineConfirm.replace("{n}", "1"))) return;
    setOfflining(true);
    setMsg(null);
    const res = await offlineProductsAction([p.id]);
    setOfflining(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setMsg(d.products.offlineDone.replace("{n}", String(res.data.updated)));
    await reloadProducts(page);
  }

  useEffect(() => {
    void reloadProducts(1);
    setQ("");
    setQDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, onlyRecommended, applyPreset, sort]);

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
    const res = await batchCreateOffersAction(Array.from(selectedIds));
    setBatching(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setBatchResult(res.data);
    setSelectedIds(new Set());
    await reloadProducts(page);
  }

  const [calcScoring, setCalcScoring] = useState(false);
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
    const res = await calcScoreAction(Array.from(selectedIds));
    setCalcScoring(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setMsg(
      d.products.calcScoreDone.replace("{n}", String(res.data.updated))
    );
    setSelectedIds(new Set());
    await reloadProducts(page);
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
    const res = await offlineProductsAction(Array.from(selectedIds));
    setOfflining(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setMsg(d.products.offlineDone.replace("{n}", String(res.data.updated)));
    setSelectedIds(new Set());
    await reloadProducts(page);
  }

  async function onToggleScorePause() {
    if (togglingPause) return;
    setTogglingPause(true);
    setMsg(null);
    const res = await setScoreCalcPausedAction(!scorePaused);
    setTogglingPause(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    setScorePaused(res.data.paused);
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader title={d.page.title} description={d.page.description} />

      {msg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
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
              {syncResult.skipped && syncResult.skipped.length > 0 && (
                <div className="mt-2 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  <p className="font-medium">{d.top.skippedNote}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {syncResult.skipped.map((s) => (
                      <li key={s.networkId}>
                        <span className="font-medium">
                          {s.networkName ?? s.networkId}
                        </span>
                        {s.reason ? `：${s.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
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
            <span className="text-sm text-ink/60">
              {total} · {page}/{totalPages}
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
            className="w-full min-w-[1900px] border-collapse text-sm"
            style={{
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
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
                <th className="min-w-[220px] max-w-[280px] px-3 py-2.5 ">
                  {d.products.colName}
                </th>
                <th className="px-3 py-2.5 ">{d.products.colCountry}</th>
                {sortTh("price", d.products.colPrice)}
                <th className="px-3 py-2.5 ">{d.products.colCommissionRate}</th>
                <th className="px-3 py-2.5 ">{d.products.colCommissionAmount}</th>
                <th className="px-3 py-2.5 ">{d.products.colPromo}</th>
                <th className="px-3 py-2.5 ">{d.products.colOfferCount}</th>
                <th className="px-3 py-2.5 ">{d.products.colAds}</th>
                {sortTh("created", d.products.colCreated)}
                <th className="sticky right-0 z-30 bg-inherit px-3 py-2.5  shadow-[-1px_0_0_0_rgba(0,0,0,0.06)]">
                  {d.products.colActions}
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const blacklisted = !!p.blacklisted;
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
                    <td className="whitespace-nowrap px-3 py-2 text-ink/70">
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
                    <td className="whitespace-nowrap px-3 py-2 text-ink/70">
                      {p.merchantName ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink/70">{p.brand ?? "—"}</td>
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
                    <td
                      className="min-w-[220px] max-w-[280px] px-3 py-2"
                      title={p.name}
                    >
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{p.name}</span>
                      <span className="mt-1 inline-flex gap-1 align-middle">
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
                    <td className="px-3 py-2 text-ink/40">—</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {(launchCounts[p.id] ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="text-xs tabular-nums text-signal hover:underline"
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
                        <span className="text-xs text-ink/40">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-ink/60">
                      {formatDate(p.createdAt)}
                    </td>
                    <td className="sticky right-0 z-10 bg-inherit px-3 py-2 shadow-[-1px_0_0_0_rgba(0,0,0,0.06)]">
                      <span className="flex gap-2">
                        <button
                          className="whitespace-nowrap text-xs text-signal hover:underline disabled:opacity-40"
                          onClick={() => void onCreateOfferOne(p.id)}
                          disabled={batching || blacklisted}
                        >
                          {d.products.createOfferOne}
                        </button>
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className={btnPrimary}
            onClick={onBatchCreate}
            disabled={batching || selectedIds.size === 0}
          >
            {batching ? d.products.creating : d.products.batchCreate}
          </button>
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
            onClick={onBatchOffline}
            disabled={offlining || selectedIds.size === 0}
          >
            {offlining
              ? d.products.offlining
              : d.products.batchOffline.replace("{n}", String(selectedIds.size))}
          </button>
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
          <span className="text-sm text-ink/60">
            ({selectedIds.size})
          </span>
          {scorePaused && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {d.products.scoreCalcPausedBadge}
            </span>
          )}
        </div>

        {batchResult && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
              {d.products.batchResultCreated.replace(
                "{n}",
                String(batchResult.created.length)
              )}
            </p>
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
