"use client";

import { useEffect, useState } from "react";
import {
  applyGrantAction,
  approveGrantAction,
  listGrantApplicationsAction,
  listGrantAuditsAction,
  listGrantsAction,
  listMyGrantApplicationsAction,
  rejectGrantAction,
  revokeGrantAction,
  type Grant,
  type GrantApplication,
  type GrantAudit,
} from "@/lib/api/admin-grants-actions";

/**
 * §5：管理员授权页。
 * 默认关闭：普通用户只有“申请”入口，没有启用按钮；审批需管理员且 ≠ 申请人。
 * 白名单逐个填写（禁止通配符 / “全部网站”）；有效期 7–90 天，默认 30 天，无永久。
 */
const CAPABILITIES = [
  { value: "tracking-link-resolve", label: "只读解析（tracking-link-resolve）" },
  { value: "catalog-sync", label: "商品库同步（catalog-sync，暂无执行代码）" },
  { value: "direct-api-write", label: "直连 API 写入（direct-api-write，暂无执行代码）" },
];

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

function fmtWhitelist(w: unknown): string {
  return Array.isArray(w) ? w.join("、") : "—";
}

export function AdminGrantsClient() {
  const [capability, setCapability] = useState(CAPABILITIES[0].value);
  const [purpose, setPurpose] = useState("");
  const [whitelistText, setWhitelistText] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [days, setDays] = useState("30");
  const [mine, setMine] = useState<GrantApplication[]>([]);
  const [allApps, setAllApps] = useState<GrantApplication[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [audits, setAudits] = useState<GrantAudit[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [m, g, a] = await Promise.all([
        listMyGrantApplicationsAction(),
        listGrantsAction().catch(() => null),
        listGrantAuditsAction().catch(() => null),
      ]);
      setMine(m.items);
      if (g) setGrants(g.items);
      if (a) setAudits(a.items);
      const all = await listGrantApplicationsAction().catch(() => null);
      if (all) setAllApps(all.items);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onApply(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const whitelist = whitelistText
      .split(/[\n,、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    let evidence: Array<Record<string, unknown>> = [];
    try {
      const parsed = evidenceText.trim() ? JSON.parse(evidenceText) : [];
      if (!Array.isArray(parsed)) throw new Error("证据必须是 JSON 数组");
      evidence = parsed;
    } catch (err) {
      setMsg(`证据 JSON 无效：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSubmitting(true);
    try {
      await applyGrantAction({
        capability,
        purpose: purpose.trim(),
        whitelist,
        evidence,
        requestedDays: Number(days) || 30,
      });
      setMsg("申请已提交，等待管理员审批。");
      setPurpose("");
      setWhitelistText("");
      setEvidenceText("");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "申请失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onApprove(id: string) {
    const note = window.prompt("审批备注（可选）");
    if (note === null) return;
    if (!window.confirm("确认审批通过？请确认已逐项核对：能力 + 用途 + 白名单逐个 + 证据 + 上限 + 有效期。")) return;
    try {
      await approveGrantAction(id, { decisionNote: note || undefined });
      setMsg("已审批通过。");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "审批失败");
    }
  }

  async function onReject(id: string) {
    const note = window.prompt("拒绝原因");
    if (note === null) return;
    try {
      await rejectGrantAction(id, { decisionNote: note });
      setMsg("已拒绝。");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "拒绝失败");
    }
  }

  async function onRevoke(id: string) {
    const reason = window.prompt("吊销原因（必填）");
    if (!reason) return;
    if (!window.confirm("确认吊销该授权？吊销后能力立即回到默认关闭。")) return;
    try {
      await revokeGrantAction(id, reason);
      setMsg("已吊销。");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "吊销失败");
    }
  }

  if (loading) return <p className="mt-4 text-sm text-ink/60">加载中…</p>;

  return (
    <div className="space-y-8">
      {msg && (
        <div className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm text-ink">
          {msg}
        </div>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">申请授权</h2>
        <p className="mt-1 text-xs text-ink/60">
          默认关闭：申请只是申请，不直接启用。白名单逐个填写（禁止通配符 / “全部网站”）；有效期 7–90 天，默认 30
          天，无永久授权；证据按 §5.3 填写（JSON 数组，如 [{`{"type":"account-proof","url":"..."}`}])。
        </p>
        <form onSubmit={onApply} className="mt-4 space-y-3">
          <label className="block text-sm">
            能力
            <select
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              className={inputClass}
            >
              {CAPABILITIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            用途（必填）
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="例如：解析自有追踪链接的最终落地页"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            白名单（每行/逗号一个，具体域名，禁止通配符）
            <textarea
              value={whitelistText}
              onChange={(e) => setWhitelistText(e.target.value)}
              placeholder={"example.com\npartner.com"}
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            证据（JSON 数组，§5.3）
            <textarea
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              placeholder='[{"type":"account-proof","url":"https://..."}]'
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            有效期（天，7–90）
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? "提交中…" : "提交申请"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">我的申请</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">暂无申请。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {mine.map((a) => (
              <li key={a.id} className="rounded-lg border border-ink/10 p-3">
                <p>
                  <b>{a.capability}</b> · 状态：{a.status} · 白名单：{fmtWhitelist(a.whitelist)} ·
                  有效期：{a.requestedDays} 天
                </p>
                <p className="text-ink/60">用途：{a.purpose}</p>
                {a.decisionNote && <p className="text-ink/60">审批备注：{a.decisionNote}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">待审批申请（管理员）</h2>
        {allApps.filter((a) => a.status === "pending").length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">暂无待审批申请（非管理员看不到此列表）。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {allApps
              .filter((a) => a.status === "pending")
              .map((a) => (
                <li key={a.id} className="rounded-lg border border-ink/10 p-3">
                  <p>
                    <b>{a.capability}</b> · 申请人：{a.applicantId} · 白名单：
                    {fmtWhitelist(a.whitelist)} · 有效期：{a.requestedDays} 天
                  </p>
                  <p className="text-ink/60">用途：{a.purpose}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={btnPrimary} onClick={() => void onApprove(a.id)}>
                      审批通过
                    </button>
                    <button type="button" className={btnGhost} onClick={() => void onReject(a.id)}>
                      拒绝
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">有效授权（管理员）</h2>
        {grants.filter((g) => g.status === "active").length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">暂无有效授权（全部默认关闭）。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {grants
              .filter((g) => g.status === "active")
              .map((g) => (
                <li key={g.id} className="rounded-lg border border-ink/10 p-3">
                  <p>
                    <b>{g.capability}</b> · 白名单：{fmtWhitelist(g.whitelist)} · 用量：
                    {g.usageCount} · 到期：{new Date(g.endsAt).toLocaleString()}
                  </p>
                  <button type="button" className={btnGhost} onClick={() => void onRevoke(g.id)}>
                    吊销
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">审计日志（管理员）</h2>
        {audits.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">暂无审计记录。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {audits.slice(0, 50).map((a) => (
              <li key={a.id} className="text-ink/70">
                {new Date(a.createdAt).toLocaleString()} · {a.action} · {a.actorId}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
