"use client";

/**
 * 点击对账：Google Ads 点击数 vs 联盟后台点击数。
 * 输入两个数字，直接告诉你损耗率、严重程度和该先查什么。
 */
import { useState } from "react";
import {
  reconcileClicksAction,
  type ClickReconcileResult,
} from "@/lib/api/click-reconcile-actions";

const VERDICT_LABEL: Record<string, { text: string; cls: string }> = {
  ok: { text: "正常", cls: "text-emerald-700" },
  warning: { text: "偏高", cls: "text-amber-700" },
  critical: { text: "结构性损耗", cls: "text-red-600 font-medium" },
  unknown: { text: "无法对账", cls: "text-ink/60" },
};

export default function ClickAuditPage() {
  const [google, setGoogle] = useState("");
  const [network, setNetwork] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClickReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = Number(google);
      const n = Number(network);
      if (!Number.isFinite(g) || !Number.isFinite(n) || g < 0 || n < 0) {
        setError("请填非负数字");
        return;
      }
      const r = await reconcileClicksAction(g, n);
      if (r.ok) setResult(r.data);
      else setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  const v = result ? VERDICT_LABEL[result.verdict] : undefined;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl">点击对账</h1>
        <p className="mt-1 text-sm text-ink/60">
          Google Ads 报的点击，有多少真的到了联盟后台？差额就是你白花的钱。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink/10 p-4">
        <label className="flex flex-col gap-1 text-sm text-ink/60">
          Google Ads 点击
          <input
            value={google}
            onChange={(e) => setGoogle(e.target.value)}
            inputMode="numeric"
            className="w-32 rounded-lg border border-ink/10 bg-white px-2 py-1 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink/60">
          联盟后台点击
          <input
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            inputMode="numeric"
            className="w-32 rounded-lg border border-ink/10 bg-white px-2 py-1 text-ink"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "计算中…" : "对账"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-ink/10 p-4">
            <p className="text-sm">
              损耗率{" "}
              <span className={v?.cls ?? ""}>
                {result.lossRatePct == null ? "—" : `${result.lossRatePct}%`}
              </span>
              {v && <span className={`ml-2 ${v.cls}`}>（{v.text}）</span>}
            </p>
            <p className="mt-1 text-xs text-ink/60">
              Google {result.googleClicks} 次 → 联盟 {result.networkClicks} 次
            </p>
            {result.timezoneSuspected && (
              <p className="mt-2 text-xs text-amber-700">
                检测到某天联盟点击多于 Google：两边时区不同，按天对比会失真，只看总量。
              </p>
            )}
          </div>

          {result.causes.length > 0 && (
            <section className="rounded-xl border border-ink/10 p-4">
              <h2 className="text-sm font-semibold">按可能性排查</h2>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {result.causes.map((c) => (
                  <li key={c.cause}>
                    <div className="flex items-start gap-2">
                      <span
                        className={
                          c.likelihood === "high"
                            ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500"
                            : c.likelihood === "medium"
                              ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"
                              : "mt-1 h-2 w-2 shrink-0 rounded-full bg-ink/30"
                        }
                      />
                      <div>
                        <p className="text-ink/85">{c.cause}</p>
                        <p className="text-xs text-ink/55">怎么查：{c.check}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-ink/10 p-4">
            <h2 className="text-sm font-semibold">下一步</h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/80">
              {result.actions.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
