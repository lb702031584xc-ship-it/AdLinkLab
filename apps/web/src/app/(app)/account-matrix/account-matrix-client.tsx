"use client";

/**
 * 账号矩阵 — 表单与行操作（client widget）。
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the account-matrix server actions only.
 * accountLabel 只是自由文本标签，绝不存任何账号凭证。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  assignAccountSlotAction,
  createTemplateSlotsAction,
  getPortfolioAction,
  markSlotBannedAction,
  type AccountSlot,
  type PortfolioView,
} from "@/lib/api/account-matrix-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const btnClass =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const OPERATION_TYPES = ["DIRECT_LINK", "BRAND_KEYWORD", "OTHER"];

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

export function TemplateForm() {
  const router = useRouter();
  const [network, setNetwork] = useState("");
  const [labelPrefix, setLabelPrefix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!network.trim() || !labelPrefix.trim()) {
      setError("网络与标签前缀必填。");
      return;
    }
    setBusy(true);
    try {
      const res = await createTemplateSlotsAction({
        network: network.trim(),
        labelPrefix: labelPrefix.trim(),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">10 槽位模板创建</h2>
      <p className="mt-1 text-xs text-ink/60">
        为一个网络一次建 10 个 EMPTY 槽位（标签为「前缀-01」…「前缀-10」）；该网络已有槽位时会拒绝重复创建。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>网络</label>
          <input className={inputClass} value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="例如 Admitad" />
        </div>
        <div>
          <label className={labelClass}>标签前缀</label>
          <input className={inputClass} value={labelPrefix} onChange={(e) => setLabelPrefix(e.target.value)} placeholder="例如 admitad" />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className={btnClass}>
          {busy ? "创建中…" : "创建 10 个槽位"}
        </button>
      </div>
    </form>
  );
}

export function SlotActions({ slot }: { slot: AccountSlot }) {
  const router = useRouter();
  const [offerId, setOfferId] = useState(slot.offerId ?? "");
  const [operationType, setOperationType] = useState("DIRECT_LINK");
  const [lostBalanceUsd, setLostBalanceUsd] = useState("");
  const [lostPendingUsd, setLostPendingUsd] = useState("");
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refillHint, setRefillHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAssign() {
    setError(null);
    setWarnings([]);
    if (!offerId.trim()) {
      setError("请填写要挂的 Offer ID。");
      return;
    }
    setBusy(true);
    try {
      const res = await assignAccountSlotAction(slot.id, offerId.trim());
      if (res.ok) {
        setWarnings(res.data.warnings);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "挂 offer 失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkBanned() {
    setError(null);
    setRefillHint(null);
    setBusy(true);
    try {
      const res = await markSlotBannedAction(slot.id, {
        operationType,
        lostBalanceUsd: num(lostBalanceUsd) ?? 0,
        lostPendingUsd: num(lostPendingUsd) ?? 0,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        setRefillHint(
          `已标 BANNED 并写复盘记录；已自动补位：${res.data.refillSlot.accountLabel}（槽位 ${res.data.refillSlot.slotIndex}，EMPTY），请把后续投放挂到补位槽位。`
        );
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记封号失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-44 rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
          value={offerId}
          onChange={(e) => setOfferId(e.target.value)}
          placeholder="Offer ID"
        />
        <button
          type="button"
          onClick={handleAssign}
          disabled={busy || slot.status === "BANNED"}
          className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          挂 Offer
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
          value={operationType}
          onChange={(e) => setOperationType(e.target.value)}
        >
          {OPERATION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          className="w-24 rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
          value={lostBalanceUsd}
          onChange={(e) => setLostBalanceUsd(e.target.value)}
          inputMode="decimal"
          placeholder="损失余额"
        />
        <input
          className="w-24 rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
          value={lostPendingUsd}
          onChange={(e) => setLostPendingUsd(e.target.value)}
          inputMode="decimal"
          placeholder="损失待结"
        />
        <button
          type="button"
          onClick={handleMarkBanned}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          标封号
        </button>
      </div>
      <input
        className="w-full rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="封号备注（标封号时一并写入复盘记录）"
      />
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      {refillHint && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          {refillHint}
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function PortfolioPanel({ initial }: { initial: PortfolioView | null }) {
  const [expectedSurvivors, setExpectedSurvivors] = useState("2");
  const [perSlotCommissionUsd, setPerSlotCommissionUsd] = useState("");
  const [portfolio, setPortfolio] = useState<PortfolioView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await getPortfolioAction({
        expectedSurvivors: num(expectedSurvivors) ?? 2,
        perSlotCommissionUsd: num(perSlotCommissionUsd) ?? null,
      });
      if (res.ok) {
        setPortfolio(res.data);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-ink/10 bg-white p-5">
      <h2 className="text-base font-semibold text-ink">组合视图</h2>
      <p className="mt-1 text-xs text-ink/60">
        预算公式：总投入上限 totalBudgetCap = 预期存活槽位数 × 单槽位佣金；单槽位预算 perSlotBudget =
        totalBudgetCap ÷ 10（分母 10 = 起手模板槽位数）。不填单槽位佣金时两项为 null（不是 0）。
        提现提醒：余额 + 待结 ≥ $180 的槽位接近 $200 提现线。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>预期存活槽位数</label>
          <input className={inputClass} value={expectedSurvivors} onChange={(e) => setExpectedSurvivors(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className={labelClass}>单槽位佣金（USD，可选）</label>
          <input className={inputClass} value={perSlotCommissionUsd} onChange={(e) => setPerSlotCommissionUsd(e.target.value)} inputMode="decimal" />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={busy} className={btnClass}>
            {busy ? "计算中…" : "重新计算"}
          </button>
        </div>
      </form>
      {portfolio ? (
        <div className="mt-5 space-y-1 text-sm">
          <p>总投入：<span className="font-mono">${portfolio.totalInvested}</span>；总佣金：<span className="font-mono">${portfolio.totalEarned}</span>；组合 ROI：<span className="font-mono">{portfolio.portfolioRoi === null ? "—" : portfolio.portfolioRoi}</span></p>
          <p>活号数（ACTIVE）：<span className="font-mono">{portfolio.liveSlots}</span>；已封槽位数：<span className="font-mono">{portfolio.bannedSlots}</span>；在险金额（活号余额 + 待结）：<span className="font-mono">${portfolio.totalAtRisk}</span></p>
          <p>总投入上限：<span className="font-mono">{portfolio.totalBudgetCap === null ? "—（未填单槽位佣金）" : `$${portfolio.totalBudgetCap}`}</span>；单槽位预算：<span className="font-mono">{portfolio.perSlotBudget === null ? "—" : `$${portfolio.perSlotBudget}`}</span></p>
          {portfolio.withdrawAlerts.length > 0 ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-medium">提现提醒（接近 $200 提现线）：</p>
              {portfolio.withdrawAlerts.map((a) => (
                <p key={`${a.network}-${a.slotIndex}`}>
                  {a.accountLabel}（{a.network}，槽位 {a.slotIndex}）：${a.amountUsd}，超提现线 ${a.excessOverPayoutLineUsd}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink/60">暂无提现提醒。</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink/60">组合视图加载失败，请稍后重试。</p>
      )}
    </div>
  );
}
