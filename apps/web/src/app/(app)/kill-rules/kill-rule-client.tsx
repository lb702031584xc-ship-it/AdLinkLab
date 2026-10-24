"use client";

/**
 * 砍线规则 — 新建 / 开关 / 删除 / seed-defaults / evaluate（client widget）。
 * Never imports server-only modules (@/lib/api/entities); it talks to the
 * API through the kill-rule server actions only.
 * 注意：evaluate 只做判定 + 审计落库，不实际暂停任何广告系列或链接。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createKillRuleAction,
  deleteKillRuleAction,
  evaluateKillRulesAction,
  seedDefaultKillRulesAction,
  updateKillRuleAction,
  type KillRule,
  type KillRuleEvaluation,
} from "@/lib/api/kill-rule-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const ACTIONS = ["WARN", "PAUSE", "LOWER_BID", "EXCLUDE_ZONE"];

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

export function KillRuleForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [offerId, setOfferId] = useState("");
  const [clicksThreshold, setClicksThreshold] = useState("300");
  const [requireZeroConv, setRequireZeroConv] = useState(true);
  const [action, setAction] = useState("WARN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const threshold = num(clicksThreshold);
    if (!name.trim() || threshold === undefined || !Number.isInteger(threshold)) {
      setError("名称必填；点击阈值必须是整数。");
      return;
    }
    setBusy(true);
    try {
      const res = await createKillRuleAction({
        name: name.trim(),
        offerId: offerId.trim() || null,
        clicksThreshold: threshold,
        requireZeroConv,
        action,
        enabled: true,
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">新建砍线规则</h2>
      <p className="mt-1 text-xs text-ink/60">
        判定语义：点击数 ≥ 阈值且（不要求零转化或转化数为 0）即命中；Offer
        为空表示全局规则。命中只写审计事件，不实际暂停广告。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>规则名</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Offer ID（可选，空为全局）</label>
          <input className={inputClass} value={offerId} onChange={(e) => setOfferId(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>点击阈值</label>
          <input className={inputClass} value={clicksThreshold} onChange={(e) => setClicksThreshold(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className={labelClass}>命中动作</label>
          <select className={inputClass} value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={requireZeroConv}
            onChange={(e) => setRequireZeroConv(e.target.checked)}
            className="h-4 w-4"
          />
          要求零转化才命中
        </label>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "新建中…" : "新建规则"}
        </button>
      </div>
    </form>
  );
}

export function KillRuleRowActions({ rule }: { rule: KillRule }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(true);
    try {
      const res = await action();
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? "操作失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => updateKillRuleAction(rule.id, { enabled: !rule.enabled }))}
        className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {rule.enabled ? "关闭" : "开启"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => deleteKillRuleAction(rule.id))}
        className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-700 disabled:opacity-50"
      >
        删除
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

export function SeedDefaultsButton() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSeed() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await seedDefaultKillRulesAction();
      if (res.ok) {
        setMessage(res.data.created ? `已创建 ${res.data.rules.length} 条默认规则。` : "默认规则已存在，未重复创建。");
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleSeed}
        disabled={busy}
        className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "处理中…" : "Seed 默认规则"}
      </button>
      {message && <span className="text-sm text-green-700">{message}</span>}
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}

export function KillRuleEvaluateForm() {
  const [offerId, setOfferId] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [result, setResult] = useState<KillRuleEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const c = num(clicks);
    const v = num(conversions);
    if (!offerId.trim() || c === undefined || !Number.isInteger(c) || v === undefined || !Number.isInteger(v)) {
      setError("Offer ID 必填；点击数与转化数必须是整数。");
      return;
    }
    setBusy(true);
    try {
      const res = await evaluateKillRulesAction({
        offerId: offerId.trim(),
        clicks: c,
        conversions: v,
      });
      if (res.ok) {
        setResult(res.data);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "判定失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-ink">判定一次（evaluate）</h2>
      <p className="mt-1 text-xs text-ink/60">
        只判定 + 写审计事件，不实际暂停任何广告系列或链接；已关闭规则的命中会以 SKIPPED_DISABLED 留痕。
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>Offer ID</label>
          <input className={inputClass} value={offerId} onChange={(e) => setOfferId(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>点击数</label>
          <input className={inputClass} value={clicks} onChange={(e) => setClicks(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className={labelClass}>转化数</label>
          <input className={inputClass} value={conversions} onChange={(e) => setConversions(e.target.value)} inputMode="numeric" />
        </div>
      </div>
      <div className="mt-5">
        <button type="submit" disabled={busy} className="rounded-lg bg-signal px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "判定中…" : "判定"}
        </button>
      </div>
      {result && (
        <div className="mt-5 space-y-1 rounded-lg bg-ink/5 px-4 py-3 text-sm">
          <p>命中 {result.hits.length} 条规则，共写 {result.events.length} 条审计事件。</p>
          {result.hits.map((h) => (
            <p key={h.event.id}>
              {h.rule.name}（阈值 {h.rule.clicksThreshold}，动作 {h.rule.action}）→ {h.event.actionTaken}
            </p>
          ))}
          {result.hits.length === 0 && <p className="text-ink/60">无命中规则。</p>}
        </div>
      )}
    </form>
  );
}
