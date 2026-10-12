"use client";

import { useState } from "react";
import { calcProfit } from "@/lib/profit-calc";

/**
 * Offer 列表"快速测算"按钮：弹窗输入 payout / 预估 CPC / 可选 CVR，
 * 复用 @/lib/profit-calc 的 calcProfit（与 /ai/profit 同一套公式），
 * 展示 EPC / 盈亏平衡 CVR / 推荐出价 / 单次点击利润。
 * 纯客户端计算，不调后端。
 */
export interface QuickCalcDict {
  button: string;
  title: string;
  payout: string;
  payoutPlaceholder: string;
  cpc: string;
  cpcPlaceholder: string;
  cvr: string;
  cvrPlaceholder: string;
  calculate: string;
  epc: string;
  breakEvenCvr: string;
  recommendedBid: string;
  perClickProfit: string;
  verdictProfitable: string;
  verdictLoss: string;
  verdictNeedCvr: string;
  close: string;
}

const inputClassName =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClassName = "mb-1 block text-sm font-medium text-ink/70";

function fmtMoney(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

export function QuickCalcButton({ dict }: { dict: QuickCalcDict }) {
  const [open, setOpen] = useState(false);
  const [payout, setPayout] = useState("");
  const [cpc, setCpc] = useState("");
  const [cvrPct, setCvrPct] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calcProfit> | null>(
    null
  );

  function onCalculate() {
    const p = Number(payout);
    const c = Number(cpc);
    const cvrRaw = cvrPct.trim() === "" ? NaN : Number(cvrPct);
    setResult(
      calcProfit({
        payout: p,
        cpc: c,
        cvrF: Number.isFinite(cvrRaw) ? cvrRaw / 100 : NaN,
      })
    );
  }

  const verdict = result
    ? result.perClickProfit > 0
      ? { text: dict.verdictProfitable, cls: "text-emerald-700" }
      : result.perClickProfit < 0
        ? { text: dict.verdictLoss, cls: "text-rose-700" }
        : { text: dict.verdictNeedCvr, cls: "text-ink/60" }
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="rounded-lg border border-ink/15 bg-white/70 px-3 py-1.5 text-xs font-medium hover:bg-white"
      >
        {dict.button}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">{dict.title}</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className={labelClassName}>{dict.payout}</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputClassName}
                  value={payout}
                  onChange={(e) => setPayout(e.target.value)}
                  placeholder={dict.payoutPlaceholder}
                />
              </div>
              <div>
                <label className={labelClassName}>{dict.cpc}</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputClassName}
                  value={cpc}
                  onChange={(e) => setCpc(e.target.value)}
                  placeholder={dict.cpcPlaceholder}
                />
              </div>
              <div>
                <label className={labelClassName}>{dict.cvr}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  className={inputClassName}
                  value={cvrPct}
                  onChange={(e) => setCvrPct(e.target.value)}
                  placeholder={dict.cvrPlaceholder}
                />
              </div>
            </div>
            {result ? (
              <dl className="mt-5 space-y-2 rounded-lg bg-ink/5 p-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink/60">{dict.epc}</dt>
                  <dd className="font-mono font-medium">
                    {fmtMoney(result.epc)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink/60">{dict.breakEvenCvr}</dt>
                  <dd className="font-mono font-medium">
                    {result.breakEvenCvrPct === null
                      ? "—"
                      : `${result.breakEvenCvrPct.toFixed(2)}%`}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink/60">{dict.recommendedBid}</dt>
                  <dd className="font-mono font-medium">
                    {fmtMoney(result.maxCpc30)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink/60">{dict.perClickProfit}</dt>
                  <dd
                    className={`font-mono font-medium ${result.perClickProfit > 0 ? "text-emerald-700" : result.perClickProfit < 0 ? "text-rose-700" : ""}`}
                  >
                    {fmtMoney(result.perClickProfit)}
                  </dd>
                </div>
                {verdict ? (
                  <p className={`pt-1 text-sm font-medium ${verdict.cls}`}>
                    {verdict.text}
                  </p>
                ) : null}
              </dl>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium hover:bg-ink/5"
              >
                {dict.close}
              </button>
              <button
                type="button"
                onClick={onCalculate}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/85"
              >
                {dict.calculate}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
