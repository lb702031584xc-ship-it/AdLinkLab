"use client";

/**
 * #19 赠金规划附表（lead菌表格口径）：localStorage 驱动，不调后端，空表起步、不编造默认数据。
 *
 * 公式（每行自动计算，只读列）：
 * - 基础 ROI = 佣金 ÷ 已完成消费（总花费口径，不含赠金调整）
 * - 现金 ROI（含赠金口径）= 佣金 ÷ 自付花费，其中 自付花费 = 已完成消费 − 已使用赠金
 *   赠金抵扣了真实支出，所以同一笔佣金除以更小的自付花费，现金 ROI 更高——
 *   但这只是阶段性资金效率，判断 Offer 仍优先看基础 ROI（表头口径注已写明）。
 * - 分母 ≤ 0（没消费 / 赠金已用 ≥ 消费）时 ROI 无定义，显示 "—"，不编数字。
 */
import { useEffect, useState } from "react";
import type { AdsAutoDict } from "@/i18n/dict/ads-auto";

type BonusPlanDict = AdsAutoDict["bonusPlan"];

const LS_KEY = "adlinklab-bonus-plan-rows";

export interface BonusPlanRow {
  id: string;
  account: string;
  tier: string;
  /** 以下金额字段以字符串存（编辑态），计算时 parseFloat。单位 USD。 */
  spendRequired: string;
  spendDone: string;
  bonusReceived: string;
  bonusUsed: string;
  commission: string;
}

const emptyRow = (): BonusPlanRow => ({
  id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  account: "",
  tier: "",
  spendRequired: "",
  spendDone: "",
  bonusReceived: "",
  bonusUsed: "",
  commission: "",
});

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 基础 ROI（小数）：佣金 ÷ 已完成消费；消费为 0 → null（无定义，显示 —）。 */
export function bonusBaseRoi(row: BonusPlanRow): number | null {
  const spend = num(row.spendDone);
  if (spend <= 0) return null;
  return num(row.commission) / spend;
}

/** 现金 ROI（含赠金）：佣金 ÷ (已完成消费 − 已使用赠金)；自付 ≤ 0 → null。 */
export function bonusCashRoi(row: BonusPlanRow): number | null {
  const selfPaid = num(row.spendDone) - num(row.bonusUsed);
  if (selfPaid <= 0) return null;
  return num(row.commission) / selfPaid;
}

function fmtRoi(r: number | null): string {
  return r === null ? "—" : `${(r * 100).toFixed(2)}%`;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function readRows(): BonusPlanRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as BonusPlanRow[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const inputClass =
  "w-full min-w-[72px] rounded-md border border-ink/20 px-2 py-1 text-sm";

export function BonusPlanTable({ dict }: { dict: BonusPlanDict }) {
  const d = dict;
  const [rows, setRows] = useState<BonusPlanRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRows(readRows());
    setReady(true);
  }, []);

  function persist(next: BonusPlanRow[]) {
    setRows(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function update(id: string, field: keyof BonusPlanRow, value: string) {
    persist(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function remove(id: string) {
    if (window.confirm(d.removeConfirm)) {
      persist(rows.filter((r) => r.id !== id));
    }
  }

  if (!ready) return null;

  const totalBonus = rows.reduce((s, r) => s + num(r.bonusReceived), 0);

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
      <p className="mt-1 text-xs font-medium text-amber-700">{d.note}</p>
      <p className="mt-1 text-xs text-ink/55">{d.cashRoiHint}</p>

      <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink/80">
        <span>
          {d.summaryAccounts}：<strong className="text-ink">{rows.length}</strong>
        </span>
        <span>
          {d.summaryBonus}：<strong className="text-ink">{fmtMoney(totalBonus)}</strong>
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
              <th className="py-2 pr-2">{d.account}</th>
              <th className="py-2 pr-2">{d.tier}</th>
              <th className="py-2 pr-2">{d.spendRequired}</th>
              <th className="py-2 pr-2">{d.spendDone}</th>
              <th className="py-2 pr-2">{d.bonusReceived}</th>
              <th className="py-2 pr-2">{d.bonusUsed}</th>
              <th className="py-2 pr-2">{d.commission}</th>
              <th className="py-2 pr-2">{d.baseRoi}</th>
              <th className="py-2 pr-2">{d.cashRoi}</th>
              <th className="py-2 pr-2">{d.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ink/5">
                <td className="py-2 pr-2">
                  <input
                    className={inputClass}
                    value={r.account}
                    placeholder={d.accountPlaceholder}
                    onChange={(e) => update(r.id, "account", e.target.value)}
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    className={inputClass}
                    value={r.tier}
                    placeholder={d.tierPlaceholder}
                    onChange={(e) => update(r.id, "tier", e.target.value)}
                  />
                </td>
                {(
                  [
                    "spendRequired",
                    "spendDone",
                    "bonusReceived",
                    "bonusUsed",
                    "commission",
                  ] as const
                ).map((f) => (
                  <td key={f} className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={inputClass}
                      value={r[f]}
                      onChange={(e) => update(r.id, f, e.target.value)}
                    />
                  </td>
                ))}
                <td className="py-2 pr-2 font-medium text-ink/80">
                  {fmtRoi(bonusBaseRoi(r))}
                </td>
                <td className="py-2 pr-2 font-medium text-ink/80">
                  {fmtRoi(bonusCashRoi(r))}
                </td>
                <td className="py-2 pr-2">
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    className="text-xs text-red-600 underline hover:opacity-80"
                  >
                    {d.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/50">{d.empty}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => persist([...rows, emptyRow()])}
        className="mt-3 rounded-md border border-ink/20 px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
      >
        {d.addRow}
      </button>
    </div>
  );
}
