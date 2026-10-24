"use client";

/**
 * 成本账 — 测算表单（client widget）。
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the cost-ledger server actions only.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  evaluateCostLedgerAction,
  getBidMathAction,
  upsertRiskParamAction,
  type BidMathResult,
  type CostLedgerEvaluation,
} from "@/lib/api/cost-ledger-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const OPERATION_TYPES = ["DIRECT_LINK", "BRAND_KEYWORD", "OTHER"];

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

export function CostLedgerEvaluateForm() {
  const router = useRouter();
  const [offerId, setOfferId] = useState("");
  const [network, setNetwork] = useState("");
  const [operationType, setOperationType] = useState("DIRECT_LINK");
  const [balanceUsd, setBalanceUsd] = useState("0");
  const [pendingUsd, setPendingUsd] = useState("0");
  const [expectedProfitUsd, setExpectedProfitUsd] = useState("");
  const [result, setResult] = useState<CostLedgerEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!network.trim()) {
      setError("请填写网络名称。");
      return;
    }
    setBusy(true);
    try {
      const res = await evaluateCostLedgerAction({
        offerId: offerId.trim() || undefined,
        network: network.trim(),
        operationType,
        balanceUsd: num(balanceUsd) ?? 0,
        pendingUsd: num(pendingUsd) ?? 0,
        expectedProfitUsd: num(expectedProfitUsd) ?? null,
      });
      if (res.ok) {
        setResult(res.data);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "测算失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">成本账测算</h2>
      <p className="mt-1 text-xs text-ink/60">
        只算成本、不拦截任何操作：沉没成本 = 余额 + 待结；预期损失 = 封号概率 ×
        沉没成本；损失/利润比 = 预期损失 ÷ 预期利润（利润无效时为空）。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>Offer ID（可选）</label>
          <input className={inputClass} value={offerId} onChange={(e) => setOfferId(e.target.value)} placeholder="给出时原样展示该 Offer 现有 verdict" />
        </div>
        <div>
          <label className={labelClass}>网络</label>
          <input className={inputClass} value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="例如 Admitad" />
        </div>
        <div>
          <label className={labelClass}>操作类型</label>
          <select className={inputClass} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
            {OPERATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>账户余额（USD）</label>
          <input className={inputClass} value={balanceUsd} onChange={(e) => setBalanceUsd(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className={labelClass}>待结佣金（USD）</label>
          <input className={inputClass} value={pendingUsd} onChange={(e) => setPendingUsd(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className={labelClass}>预期利润（USD，可选）</label>
          <input className={inputClass} value={expectedProfitUsd} onChange={(e) => setExpectedProfitUsd(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "测算中…" : "测算"}
        </button>
      </div>
      {result && (
        <div className="mt-5 space-y-1 rounded-lg bg-ink/5 px-4 py-3 text-sm">
          <p>封号概率：<span className="font-mono">{result.banProbability}</span>（来源：{result.banProbabilitySource === "override" ? "本租户覆盖值" : "代码默认值"}）</p>
          <p>沉没成本：<span className="font-mono">${result.sunkCost}</span></p>
          <p>预期损失：<span className="font-mono">${result.expectedLossUsd}</span></p>
          <p>损失/利润比：<span className="font-mono">{result.lossToProfitRatio ?? "—（预期利润未知或 ≤0）"}</span></p>
          <p>风险档：<span className="font-mono">{result.riskTier}</span></p>
          {result.offer && (
            <p>Offer 现有 verdict：<span className="font-mono">{result.offer.prescreenVerdict ?? "—"}</span>{result.offer.prescreenReason ? `（${result.offer.prescreenReason}）` : ""}</p>
          )}
        </div>
      )}
    </form>
  );
}

export function RiskParamForm() {
  const router = useRouter();
  const [network, setNetwork] = useState("");
  const [operationType, setOperationType] = useState("DIRECT_LINK");
  const [banProbability, setBanProbability] = useState("0.15");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const p = num(banProbability);
    if (!network.trim() || p === undefined || p < 0 || p > 1) {
      setError("网络必填；封号概率必须是 0–1 之间的数字。");
      return;
    }
    setBusy(true);
    try {
      const res = await upsertRiskParamAction({
        network: network.trim(),
        operationType,
        banProbability: p,
      });
      if (res.ok) {
        setDone(`已保存：${res.data.network} × ${res.data.operationType} = ${res.data.banProbability}`);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">风险参数覆盖值</h2>
      <p className="mt-1 text-xs text-ink/60">
        按网络 × 操作类型覆盖封号概率；没有覆盖值时测算用代码默认值（直链 0.15、品牌词 0.25、其他 0.10）。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {done && (
        <div className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {done}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>网络</label>
          <input className={inputClass} value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="例如 Admitad" />
        </div>
        <div>
          <label className={labelClass}>操作类型</label>
          <select className={inputClass} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
            {OPERATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>封号概率（0–1）</label>
          <input className={inputClass} value={banProbability} onChange={(e) => setBanProbability(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "保存中…" : "保存覆盖值"}
        </button>
      </div>
    </form>
  );
}

export function BidMathForm() {
  const [cpcUsd, setCpcUsd] = useState("0.20");
  const [roiTarget, setRoiTarget] = useState("2");
  const [payoutUsd, setPayoutUsd] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("100");
  const [geo, setGeo] = useState("");
  const [format, setFormat] = useState("");
  const [result, setResult] = useState<BidMathResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const cpc = num(cpcUsd);
    const roi = num(roiTarget);
    if (cpc === undefined || cpc <= 0 || roi === undefined || roi <= 0) {
      setError("CPC 与 ROI 目标必须是大于 0 的数字。");
      return;
    }
    setBusy(true);
    try {
      const res = await getBidMathAction({
        cpcUsd: cpc,
        roiTarget: roi,
        payoutUsd: num(payoutUsd) ?? null,
        budgetUsd: num(budgetUsd) ?? null,
        geo: geo.trim() || undefined,
        format: format.trim() || undefined,
      });
      if (res.ok) {
        setResult(res.data);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "测算失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">出价测算</h2>
      <p className="mt-1 text-xs text-ink/60">
        盈亏平衡 EPC = CPC × ROI 目标；所需转化率 = CPC × ROI 目标 ÷
        payout；预算可买点击数 = 预算 ÷ CPC。GEO 与格式仅用于回显覆盖维度，不参与计算。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>CPC（USD，默认 0.20）</label>
          <input className={inputClass} value={cpcUsd} onChange={(e) => setCpcUsd(e.target.value)} inputMode="decimal" placeholder="0.20" />
        </div>
        <div>
          <label className={labelClass}>ROI 目标（默认 2）</label>
          <input className={inputClass} value={roiTarget} onChange={(e) => setRoiTarget(e.target.value)} inputMode="decimal" placeholder="2" />
        </div>
        <div>
          <label className={labelClass}>Payout（USD，可选）</label>
          <input className={inputClass} value={payoutUsd} onChange={(e) => setPayoutUsd(e.target.value)} inputMode="decimal" placeholder="例如 2" />
        </div>
        <div>
          <label className={labelClass}>预算（USD，可选）</label>
          <input className={inputClass} value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} inputMode="decimal" placeholder="100" />
        </div>
        <div>
          <label className={labelClass}>GEO（可选）</label>
          <input className={inputClass} value={geo} onChange={(e) => setGeo(e.target.value)} placeholder="例如 US" />
        </div>
        <div>
          <label className={labelClass}>格式（可选）</label>
          <input className={inputClass} value={format} onChange={(e) => setFormat(e.target.value)} placeholder="例如 pop / push" />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "测算中…" : "测算出价"}
        </button>
      </div>
      {result && (
        <div className="mt-5 space-y-1 rounded-lg bg-ink/5 px-4 py-3 text-sm">
          <p>盈亏平衡 EPC：<span className="font-mono">${result.requiredEpcUsd}</span>（CPC ${result.cpcUsd} × ROI {result.roiTarget}；默认口径 $0.40）</p>
          <p>
            所需转化率：
            <span className="font-mono">
              {result.requiredCr === null
                ? "—（未填 payout，无法反推）"
                : `${result.requiredCr}（${(result.requiredCr * 100).toFixed(2)}%）`}
            </span>
          </p>
          <p>预算可买点击数：<span className="font-mono">{result.clicksForBudget === null ? "—（未填预算）" : result.clicksForBudget}</span></p>
          {(result.geo || result.format) && (
            <p className="text-xs text-ink/60">
              覆盖维度：{result.geo ? `GEO ${result.geo}` : ""}{result.geo && result.format ? " / " : ""}{result.format ? `格式 ${result.format}` : ""}
            </p>
          )}
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {result.scaleNote}
          </div>
        </div>
      )}
    </form>
  );
}
