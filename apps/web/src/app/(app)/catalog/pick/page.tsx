"use client";

/**
 * 商品库挑选 —— 零输入：点一下，直接看判定 + 完整参数。
 *
 * 页面要把「顾问在聊天里算给你听的那套」完整摆出来：
 *   判据（为什么能做 / 为什么不能）、
 *   参数（保本 CPC / 出价上限 / 需要 CVR / 验证成本 / 每日预算 / 止损线）、
 *   步骤（怎么开）、
 *   淘汰明细（哪些被砍、砍在哪个数上）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  catalogPickAction,
  type CatalogPickPayload,
} from "@/lib/api/catalog-pick-actions";
import {
  catalogAuditAction,
  type AuditPayload,
} from "@/lib/api/catalog-audit-actions";
import { batchCreateOffersAction } from "@/lib/api/catalog-actions";

const CODE_LABEL: Record<string, string> = {
  PAYOUT_UNKNOWN: "佣金未知",
  BELOW_MIN_PAYOUT: "佣金太低",
  CANNOT_COVER_CPC: "覆盖不了 CPC",
  OUT_OF_STOCK: "缺货",
  BRAND_DEDUP: "同品牌重复",
  OVER_LIMIT: "超出上限",
};

const SOURCE_LABEL: Record<string, string> = {
  exact: "该类目实测",
  broad: "大类推算",
  global: "全站推算",
  assumed: "假定值",
};

/** 验证周期（天）：7 天是一个可执行又不至于太慢的窗口。 */
const PROBE_DAYS = 7;

function buildPlan(breakevenCpcUsd: number, categoryCpcUsd: number, payoutUsd: number) {
  const bidCap = breakevenCpcUsd * 0.6;
  const neededCvrPct =
    breakevenCpcUsd > 0 ? ((0.025 * categoryCpcUsd) / breakevenCpcUsd) * 100 : null;
  const clicksNeeded =
    neededCvrPct && neededCvrPct > 0
      ? Math.min(2000, Math.ceil(3 / (neededCvrPct / 100)))
      : null;
  const budgetUsd = clicksNeeded != null ? clicksNeeded * categoryCpcUsd : null;
  const dailyBudgetUsd = budgetUsd != null ? budgetUsd / PROBE_DAYS : null;
  const expectedOrders =
    clicksNeeded != null && neededCvrPct != null
      ? (clicksNeeded * neededCvrPct) / 100
      : null;
  return {
    bidCap,
    neededCvrPct,
    clicksNeeded,
    budgetUsd,
    dailyBudgetUsd,
    expectedOrders,
    stopLossUsd: payoutUsd * 3,
  };
}

export default function CatalogPickPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CatalogPickPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [audit, setAudit] = useState<AuditPayload | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const runAudit = async () => {
    setAuditBusy(true);
    setAuditError(null);
    try {
      const r = await catalogAuditAction({ minReviews: 20 });
      if (r.ok) setAudit(r.data);
      else setAuditError(r.error);
    } finally {
      setAuditBusy(false);
    }
  };
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<Set<string>>(new Set());

  const createOffer = async (productId: string) => {
    setCreating(productId);
    setError(null);
    setNotice(null);
    try {
      const r = await batchCreateOffersAction([productId]);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // HTTP 200 不代表建出来了：接口会返回四个桶，必须逐个看
      const d = (r.data ?? {}) as {
        created?: unknown[];
        skippedExisting?: unknown[];
        failed?: Array<{ reason?: string }>;
        skippedBlacklist?: Array<{ reason?: string }>;
      };
      const createdN = d.created?.length ?? 0;
      const existN = d.skippedExisting?.length ?? 0;
      const failN = d.failed?.length ?? 0;
      const blackN = d.skippedBlacklist?.length ?? 0;
      if (createdN > 0) {
        setCreated((prev) => new Set(prev).add(productId));
        setNotice(`已创建 ${createdN} 个 Offer`);
      } else if (existN > 0) {
        setCreated((prev) => new Set(prev).add(productId));
        setNotice(
          "这个商品之前已经建过 Offer，系统没有重复创建（去 Offer 列表按全部状态查看）"
        );
      } else if (failN > 0) {
        setError(`建 Offer 失败：${d.failed?.[0]?.reason ?? "未知原因"}`);
      } else if (blackN > 0) {
        setError(`被黑名单拦截：${d.skippedBlacklist?.[0]?.reason ?? ""}`);
      } else {
        setError("接口返回成功但没有创建任何 Offer，请查看 api 日志");
      }
    } finally {
      setCreating(null);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await catalogPickAction({});
      if (r.ok) setData(r.data);
      else setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  const cpc = data?.baseline.cpcUsd ?? 0;
  const droppedByCode = data
    ? data.result.dropped.reduce<Record<string, number>>((acc, d) => {
        acc[d.code] = (acc[d.code] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-ink/15 px-2.5 py-1 text-xs text-ink/60 hover:bg-ink/5"
            title="回到上一页（例如广告创建页）"
          >
            ← 返回
          </button>
          <h1 className="font-display text-2xl">商品库挑选</h1>
        </div>
        <p className="mt-1 text-sm text-ink/60">
          点一下就行。系统用「单笔佣金 → 保本 CPC」和这个类目的点击成本比，
          直接给出判定、参数和下一步。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "计算中…" : "开始挑选"}
        </button>
        <button
          type="button"
          onClick={runAudit}
          disabled={auditBusy}
          className="rounded-lg border border-ink/20 px-4 py-2 text-sm text-ink/75 hover:bg-ink/5 disabled:opacity-50"
          title="按类目 CPC 判全站商品，只读不写库"
        >
          {auditBusy ? "全站体检中…" : "全站体检"}
        </button>
        {data && (
          <span className="text-xs text-ink/55">
            类目 CPC ${cpc.toFixed(2)}/点击（
            {SOURCE_LABEL[data.baseline.source] ?? data.baseline.source}，样本{" "}
            {data.baseline.samples} 条）
          </span>
        )}
        {data && (data.suggestedMinCommissionUsd ?? 0) > 0 && (
          <span className="text-xs text-ink/70">
            建议佣金门槛 ${(data.suggestedMinCommissionUsd ?? 0).toFixed(2)}
            （按类目 CPC 反推）
          </span>
        )}
      </div>

      {auditError && <p className="text-sm text-red-600">{auditError}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {audit && (
        <section className="rounded-xl border border-ink/10 p-4">
          <h2 className="text-sm font-semibold">
            全站体检：{audit.picked.length} 个候选
            <span className="ml-2 text-xs font-normal text-ink/50">
              （共 {audit.counts.total} 条 · {audit.counts.categories} 个类目 ·
              淘汰 {audit.counts.dropped}）
            </span>
          </h2>
          {audit.probe && (
            <p className="mt-1 text-xs text-ink/60">
              DataForSEO 探针：{audit.probe.used ? "已生效" : "未取到数据"}
              {audit.probe.categories > 0
                ? ` · 覆盖 ${audit.probe.categories} 个类目`
                : ""}
              {audit.probe.note ? ` · ${audit.probe.note}` : ""}
            </p>
          )}
          {audit.picked.some((p) => !(p.cpcUsd > 0)) && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              ⚠️ 有 {audit.picked.filter((p) => !(p.cpcUsd > 0)).length} 个商品没有类目 CPC 基线，它们的「能做」不成立——只是佣金够，并不知道点击要多少钱。只有 CPC 大于 0 的才算真正通过判定。
            </p>
          )}
          {audit.picked.length === 0 ? (
            <p className="mt-2 text-sm text-amber-700">
              没有通过判定的商品。{audit.notes[0] ?? ""}
            </p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-xs text-ink/50">
                <tr>
                  <th className="text-left font-normal">商品</th>
                  <th className="text-left font-normal">类目</th>
                  <th className="text-right font-normal">佣金 / 预期</th>
                  <th className="text-right font-normal">保本 CPC</th>
                  <th className="text-right font-normal">类目 CPC</th>
                  <th className="text-right font-normal">ROI</th>
                  <th className="text-right font-normal">基线</th>
                  <th className="text-right font-normal">结论</th>
                  <th className="text-right font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {audit.picked.slice(0, 25).map((p) => (
                  <tr key={p.productId} className="border-t border-ink/5">
                    <td className="py-1 text-ink/85">{p.name.slice(0, 46)}</td>
                    <td className="text-ink/60">{p.category}</td>
                    <td className="text-right">
                      ${p.payoutUsd.toFixed(2)}
                      <span className="ml-1 text-xs text-ink/45">
                        / ${p.expectedPayoutUsd.toFixed(2)}
                      </span>
                    </td>
                    <td className="text-right">
                      ${p.breakevenCpcUsd.toFixed(2)}
                    </td>
                    <td className="text-right text-ink/70">
                      {p.cpcUsd > 0 ? `${p.cpcUsd.toFixed(2)}` : "—"}
                    </td>
                    <td className="text-right">
                      {p.roi == null ? (
                        <span className="text-xs text-ink/40">—</span>
                      ) : (
                        <span
                          className={
                            p.roi >= 1.5
                              ? "font-medium text-emerald-700"
                              : "text-amber-700"
                          }
                        >
                          {p.roi.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="text-right text-xs text-ink/50">
                      {p.cpcUsd > 0 ? p.baselineSource : "无"}
                    </td>
                    <td className="text-right text-xs">
                      {p.verdict === "invest" ? (
                        <span className="font-medium text-emerald-700">可投</span>
                      ) : p.verdict === "breakeven" ? (
                        <span className="text-amber-700">保本</span>
                      ) : (
                        <span className="text-ink/40">无基线</span>
                      )}
                    </td>
                    <td className="text-right">
                      {p.verdict === "invest" && (
                        <button
                          type="button"
                          onClick={() => void createOffer(p.productId)}
                          disabled={
                            creating === p.productId ||
                            created.has(p.productId)
                          }
                          className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {created.has(p.productId)
                            ? "已建"
                            : creating === p.productId
                              ? "创建中"
                              : "建 Offer"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {audit.notes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink/55">
              {audit.notes.slice(0, 6).map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <section className="rounded-xl border border-ink/10 p-4">
            <h2 className="text-sm font-semibold">
              能做 {data.result.counts.picked} 个
              <span className="ml-2 text-xs font-normal text-ink/50">
                （商品库共 {data.result.counts.total} 个）
              </span>
            </h2>

            {data.result.picked.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                {data.result.notes.join("；")}
              </p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-ink/50">
                  <tr>
                    <th className="text-left font-normal">商品</th>
                    <th className="text-left font-normal">国家</th>
                    <th className="text-right font-normal">页面 / 预期佣金</th>
                    <th className="text-right font-normal">保本 CPC</th>
                    <th className="text-right font-normal">结论</th>
                  </tr>
                </thead>
                <tbody>
                  {data.result.picked.map((p) => {
                    const margin =
                      cpc > 0 ? (p.breakevenCpcUsd / cpc - 1) * 100 : null;
                    return (
                      <tr key={p.productId} className="border-t border-ink/5">
                        <td className="py-1 text-ink/85">{p.name}</td>
                        <td className="text-ink/60">{p.countryCode ?? "—"}</td>
                        <td className="text-right">
                          ${p.payoutUsd.toFixed(2)}
                          <span className="ml-1 text-xs text-ink/45">页面</span>
                          <br />
                          <span className="text-xs text-ink/60">
                            ${(p.expectedPayoutUsd ?? p.payoutUsd * 0.6).toFixed(2)} 预期
                          </span>
                        </td>
                        <td className="text-right">
                          ${p.breakevenCpcUsd.toFixed(2)}
                        </td>
                        <td className="text-right">
                          <span className="text-emerald-700">能做</span>
                          {margin !== null && (
                            <span className="ml-1 text-xs text-ink/50">
                              余量 {margin > 0 ? "+" : ""}
                              {margin.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {data.result.picked.slice(0, 3).map((p) => {
            const plan = buildPlan(p.breakevenCpcUsd, cpc, p.payoutUsd);
            const marginPct = cpc > 0 ? (p.breakevenCpcUsd / cpc - 1) * 100 : 0;
            return (
              <section
                key={`plan-${p.productId}`}
                className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">判定与参数：{p.name}</h2>
                  <button
                    type="button"
                    onClick={() => void createOffer(p.productId)}
                    disabled={creating === p.productId || created.has(p.productId)}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {created.has(p.productId)
                      ? "已建 Offer ✓"
                      : creating === p.productId
                        ? "创建中…"
                        : "建 Offer"}
                  </button>
                </div>

                {/* 判据：为什么能做 */}
                <ul className="mt-2 flex flex-col gap-0.5 text-sm text-ink/80">
                  <li>
                    ① 保本 CPC ${p.breakevenCpcUsd.toFixed(2)} ≥ 类目 CPC $
                    {cpc.toFixed(2)} → 通过（余量 {marginPct > 0 ? "+" : ""}
                    {marginPct.toFixed(0)}%）
                  </li>
                  <li>
                    ② 需要的转化率 {plan.neededCvrPct?.toFixed(2) ?? "—"}%，
                    低于 2.5% 基准 → {plan.neededCvrPct != null && plan.neededCvrPct < 2.5 ? "容易达成" : "偏难，要有心理准备"}
                  </li>
                  <li>
                    ③ 单笔佣金 ${p.payoutUsd.toFixed(2)} 已达门槛 $
                    {(data.suggestedMinCommissionUsd ?? 0).toFixed(2)} → 过
                  </li>
                </ul>

                {/* 参数表 */}
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm md:grid-cols-3">
                  <p>
                    <span className="text-ink/55">建议出价上限</span>{" "}
                    <span className="font-medium">${plan.bidCap.toFixed(2)}</span>
                    <span className="ml-1 text-xs text-ink/45">保本×0.6</span>
                  </p>
                  <p>
                    <span className="text-ink/55">验证预算</span>{" "}
                    <span className="font-medium">
                      {plan.budgetUsd != null
                        ? `$${plan.budgetUsd.toFixed(0)}`
                        : "—"}
                    </span>
                  </p>
                  <p>
                    <span className="text-ink/55">每日预算</span>{" "}
                    <span className="font-medium">
                      {plan.dailyBudgetUsd != null
                        ? `$${plan.dailyBudgetUsd.toFixed(2)}`
                        : "—"}
                    </span>
                    <span className="ml-1 text-xs text-ink/45">
                      × {PROBE_DAYS} 天
                    </span>
                  </p>
                  <p>
                    <span className="text-ink/55">需要点击</span>{" "}
                    <span className="font-medium">
                      {plan.clicksNeeded ?? "—"}
                    </span>
                  </p>
                  <p>
                    <span className="text-ink/55">预期单量</span>{" "}
                    <span className="font-medium">
                      {plan.expectedOrders != null
                        ? plan.expectedOrders.toFixed(1)
                        : "—"}
                    </span>
                  </p>
                  <p>
                    <span className="text-ink/55">止损线</span>{" "}
                    <span className="font-medium">
                      ${plan.stopLossUsd.toFixed(0)}
                    </span>
                    <span className="ml-1 text-xs text-ink/45">3×佣金</span>
                  </p>
                </div>

                <ol className="mt-3 flex flex-col gap-0.5 text-sm text-ink/80">
                  <li>1. 建 Offer（只建这一个，别批量）</li>
                  <li>2. 跑初筛 —— 看有没有广告信号</li>
                  <li>3. 生成关键词，只留「可测」的</li>
                  <li>
                    4. 建计划：CPC 上限 ${plan.bidCap.toFixed(2)}，先建成暂停
                  </li>
                  <li>
                    5. 每日 ${plan.dailyBudgetUsd?.toFixed(2) ?? "—"}，跑满{" "}
                    {plan.clicksNeeded ?? "—"} 点击再判断
                  </li>
                  <li>
                    6. 判定：CVR ≥ {plan.neededCvrPct?.toFixed(2) ?? "—"}% 算成立；
                    花费达 ${plan.stopLossUsd.toFixed(0)} 且 0 单 → 停
                  </li>
                </ol>
              </section>
            );
          })}

          {data.result.dropped.length > 0 && (
            <section className="rounded-xl border border-ink/10 p-4">
              <h2 className="text-sm font-semibold">
                不能做 {data.result.counts.dropped} 个
              </h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/70">
                {Object.entries(droppedByCode)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, num]) => (
                    <li key={code}>
                      · {CODE_LABEL[code] ?? code}：{num} 个
                    </li>
                  ))}
              </ul>

              {/* 淘汰明细：砍在哪个数上 */}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink/60">
                  查看逐条淘汰原因
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink/65">
                  {data.result.dropped.slice(0, 30).map((d) => (
                    <li key={d.productId}>
                      <span className="text-ink/45">
                        [{CODE_LABEL[d.code] ?? d.code}]
                      </span>{" "}
                      {d.name} —— {d.reason}
                    </li>
                  ))}
                </ul>
                {data.result.dropped.length > 30 && (
                  <p className="mt-1 text-xs text-ink/45">
                    仅显示前 30 条，共 {data.result.dropped.length} 条
                  </p>
                )}
              </details>
            </section>
          )}

          <p className="text-xs text-ink/50">{data.baseline.note}</p>
        </>
      )}
    </div>
  );
}
