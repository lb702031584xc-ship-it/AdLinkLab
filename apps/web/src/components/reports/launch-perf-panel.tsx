"use client";

/**
 * 投放档案：人工回填 + 止损/低价判断 + 自动止损脚本面板。
 * - 回填：从 Google Ads 抄回真实数据按日期存快照；没回填显示「未回填」，
 *   不参与判断（绝不编造）。
 * - 判断：服务端 shared 确定性规则（perfVerdict），徽标 + 依据数字逐项列明。
 * - 脚本：站内只生成 Google Ads Script，文案明示需粘贴后才生效。
 */
import { useState } from "react";
import type { LaunchArchiveDict } from "@/i18n/dict/launch-archive";
import {
  createPerfSnapshotAction,
  generateStopLossScriptAction,
  type AdPerfVerdictView,
  type LaunchArchive,
  type StopLossScriptResult,
} from "@/lib/api/launch-archive-actions";

type PerfDict = LaunchArchiveDict["perf"];

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-signal";
const btnPrimary =
  "rounded-lg bg-ink px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-85 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-3.5 py-1.5 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-50";

export function verdictLabel(level: AdPerfVerdictView["level"], p: PerfDict): string {
  switch (level) {
    case "stop":
      return p.verdictStop;
    case "market_too_high":
      return p.verdictMarketTooHigh;
    case "low_bid":
      return p.verdictLowBid;
    case "ok":
      return p.verdictOk;
    default:
      return p.verdictInsufficient;
  }
}

export function verdictCls(level: AdPerfVerdictView["level"]): string {
  switch (level) {
    case "stop":
    case "market_too_high":
      return "bg-red-100 text-red-800";
    case "low_bid":
      return "bg-amber-100 text-amber-800";
    case "ok":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function PerfVerdictBadge({
  verdict,
  p,
}: {
  verdict: AdPerfVerdictView;
  p: PerfDict;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${verdictCls(verdict.level)}`}
    >
      {verdictLabel(verdict.level, p)}
    </span>
  );
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : String(v);
}

export function LaunchPerfPanel({
  archive,
  d,
  onChanged,
}: {
  archive: LaunchArchive;
  d: LaunchArchiveDict;
  onChanged: () => void;
}) {
  const p = d.perf;
  const today = new Date().toISOString().slice(0, 10);
  const [perfDate, setPerfDate] = useState(today);
  const [spend, setSpend] = useState("");
  const [avgCpc, setAvgCpc] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [campaignName, setCampaignName] = useState(archive.offerName);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptResult, setScriptResult] = useState<StopLossScriptResult | null>(null);
  const [scriptAt, setScriptAt] = useState<string | null>(
    archive.stopLossScriptAt ?? null
  );

  const verdict = archive.perfVerdict ?? null;
  const backfill = archive.latestBackfill ?? null;
  const basis = verdict?.basis;

  async function onSaveBackfill() {
    const spendN = Number(spend);
    const impN = Number(impressions);
    const clkN = Number(clicks);
    const cvN = Number(conversions);
    if (
      !perfDate ||
      !Number.isFinite(spendN) ||
      !Number.isFinite(impN) ||
      !Number.isFinite(clkN) ||
      !Number.isFinite(cvN)
    ) {
      setError("—");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    const res = await createPerfSnapshotAction(archive.id, {
      perfDate,
      spend: spendN,
      avgCpc: avgCpc.trim() === "" ? null : Number(avgCpc),
      impressions: Math.floor(impN),
      clicks: Math.floor(clkN),
      conversions: Math.floor(cvN),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMsg(p.saved);
    onChanged();
  }

  async function onGenerateScript() {
    setScriptBusy(true);
    setError(null);
    const res = await generateStopLossScriptAction(
      archive.id,
      campaignName.trim() || undefined
    );
    setScriptBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setScriptResult(res.data);
    setScriptAt(res.data.stopLossScriptAt);
  }

  return (
    <div className="mt-6 border-t border-ink/10 pt-4">
      <h3 className="text-sm font-semibold text-ink">{p.backfillTitle}</h3>
      <p className="mt-1 text-xs text-ink/50">{p.backfillHint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {backfill ? (
          <span className="text-ink/60">
            {p.latestManual.replace("{date}", backfill.perfDate)}
            {` · ${p.basisSpend} ${backfill.spend} · ${p.basisImpressions} ${backfill.impressions} · ${p.basisConversions} ${backfill.conversions}`}
          </span>
        ) : (
          <span className="text-ink/40">{p.notFilled}</span>
        )}
        {verdict && <PerfVerdictBadge verdict={verdict} p={p} />}
      </div>

      {verdict && basis && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink/60">{p.basisTitle}</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
            <div>{p.basisSpend}：{fmt(basis.spend)}</div>
            <div>{p.basisPayout}：{fmt(basis.payout)}</div>
            <div>{p.basisRatio}：{fmt(basis.spendPayoutRatio)}</div>
            <div>{p.basisThreshold}：{fmt(basis.stopLossThreshold)}</div>
            <div>{p.basisAvgCpc}：{fmt(basis.avgCpc)}</div>
            <div>{p.basisFloor}：{fmt(basis.topOfPageFloor)}</div>
            <div>{p.basisBreakeven}：{fmt(basis.breakevenCpc)}</div>
            <div>{p.basisImpressions}：{fmt(basis.impressions)}</div>
            <div>{p.basisConversions}：{fmt(basis.conversions)}</div>
          </dl>
        </details>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">{p.date}</span>
          <input type="date" className={inputCls} value={perfDate} onChange={(e) => setPerfDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">{p.spend}</span>
          <input type="number" min={0} step="0.01" className={inputCls} value={spend} onChange={(e) => setSpend(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">{p.avgCpc}</span>
          <input type="number" min={0} step="0.01" className={inputCls} value={avgCpc} onChange={(e) => setAvgCpc(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">{p.impressions}</span>
          <input type="number" min={0} step={1} className={inputCls} value={impressions} onChange={(e) => setImpressions(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">{p.clicks}</span>
          <input type="number" min={0} step={1} className={inputCls} value={clicks} onChange={(e) => setClicks(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">{p.conversions}</span>
          <input type="number" min={0} step={1} className={inputCls} value={conversions} onChange={(e) => setConversions(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className={btnPrimary} onClick={() => void onSaveBackfill()} disabled={saving}>
          {saving ? p.submitting : p.submit}
        </button>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <div className="mt-6 border-t border-ink/10 pt-4">
        <h3 className="text-sm font-semibold text-ink">{p.scriptTitle}</h3>
        <p className="mt-1 text-xs text-ink/50">
          {scriptAt
            ? p.scriptGeneratedAt.replace("{t}", scriptAt.slice(0, 10))
            : p.scriptNotGenerated}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} max-w-xs`}
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder={p.campaignName}
            title={p.campaignName}
          />
          <button type="button" className={btnGhost} onClick={() => void onGenerateScript()} disabled={scriptBusy}>
            {scriptBusy ? p.scriptGenerating : p.scriptGenerate}
          </button>
        </div>
        {scriptResult && (
          <div className="mt-3">
            <textarea
              readOnly
              className="h-64 w-full rounded-lg border border-ink/15 bg-ink/[0.03] p-3 font-mono text-xs"
              value={scriptResult.script}
            />
            <p className="mt-1 text-xs text-ink/50">{p.scriptInstall}</p>
          </div>
        )}
      </div>
    </div>
  );
}
