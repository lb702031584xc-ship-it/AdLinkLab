"use client";

/**
 * 租户自备 DataForSEO key（BYOK）设置区。
 * login/password 只写（密码框永不回填明文），状态只显示已配置与验证时间。
 * 本区不受系统设置的 platformAdmin 只读限制：这是租户自己的凭证，
 * 租户内任何登录用户可管理（API 侧按 tenant 隔离 + 会话鉴权）。
 */
import { useEffect, useState } from "react";
import type { SettingsDict } from "@/i18n/dict/settings";
import {
  deleteTenantDataForSeoAction,
  getTenantDataForSeoStatusAction,
  saveTenantDataForSeoAction,
  verifyTenantDataForSeoAction,
} from "@/lib/api/paid-data-actions";

type DfsDict = SettingsDict["dataforseo"];

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none disabled:opacity-60";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-50";
const btnDanger =
  "rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-600 hover:bg-red-500/5 disabled:opacity-50";

export function DataForSeoSection({ t }: { t: DfsDict }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [configured, setConfigured] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(true);
  const [busy, setBusy] = useState<"save" | "verify" | "delete" | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getTenantDataForSeoStatusAction()
      .then((r) => {
        if (r.ok) {
          setConfigured(r.data.configured);
          setVerifiedAt(r.data.verifiedAt);
        } else {
          setOk(false);
          setMsg(r.error || t.loadFailed);
        }
      })
      .catch(() => {
        setOk(false);
        setMsg(t.loadFailed);
      })
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave() {
    setBusy("save");
    setMsg("");
    const res = await saveTenantDataForSeoAction(login.trim(), password);
    setBusy(null);
    setOk(res.ok);
    if (res.ok) {
      setConfigured(true);
      setVerifiedAt(null);
      setPassword("");
      setMsg(t.saved);
    } else {
      setMsg(res.error);
    }
  }

  async function onVerify() {
    setBusy("verify");
    setMsg("");
    // 表单里填了未保存的凭证 → 验表单那对；没填 → 验已保存的那对。
    const res = await verifyTenantDataForSeoAction(
      login.trim() && password ? login.trim() : undefined,
      login.trim() && password ? password : undefined
    );
    setBusy(null);
    setOk(res.ok);
    if (res.ok) {
      setMsg(
        res.data.balance !== null
          ? t.verifyBalance.replace("{n}", String(res.data.balance))
          : t.verifiedOk
      );
      // 验的是已保存凭证时后端已落验证时间，刷新状态。
      const st = await getTenantDataForSeoStatusAction();
      if (st.ok) {
        setConfigured(st.data.configured);
        setVerifiedAt(st.data.verifiedAt);
      }
    } else {
      setMsg(res.error);
    }
  }

  async function onDelete() {
    setBusy("delete");
    setMsg("");
    const res = await deleteTenantDataForSeoAction();
    setBusy(null);
    setOk(res.ok);
    if (res.ok) {
      setConfigured(false);
      setVerifiedAt(null);
      setLogin("");
      setPassword("");
      setMsg(t.deleted);
    } else {
      setMsg(res.error);
    }
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{t.title}</h2>
      <p className="mt-0.5 text-xs text-ink/55">{t.subtitle}</p>
      <div className="mt-4">
        {configured && (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
              {t.configuredBadge}
            </span>
            <span className="text-ink/55">
              {verifiedAt
                ? t.verifiedAt.replace("{t}", verifiedAt.slice(0, 10))
                : t.notVerified}
            </span>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/70">{t.login}</span>
            <input
              className={inputCls}
              value={login}
              autoComplete="off"
              onChange={(e) => setLogin(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/70">{t.password}</span>
            <input
              type="password"
              className={inputCls}
              value={password}
              autoComplete="new-password"
              placeholder={
                configured ? t.passwordConfiguredPlaceholder : t.passwordPlaceholder
              }
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={btnPrimary}
            onClick={() => void onSave()}
            disabled={!loaded || busy !== null || !login.trim() || !password}
          >
            {busy === "save" ? t.saving : t.save}
          </button>
          <button
            className={btnGhost}
            onClick={() => void onVerify()}
            disabled={!loaded || busy !== null || (!configured && !(login.trim() && password))}
          >
            {busy === "verify" ? t.verifying : t.verify}
          </button>
          {configured && (
            <button
              className={btnDanger}
              onClick={() => void onDelete()}
              disabled={busy !== null}
            >
              {busy === "delete" ? t.deleting : t.delete}
            </button>
          )}
        </div>
        {msg && (
          <p className={`mt-3 text-xs ${ok ? "text-emerald-600" : "text-red-600"}`} role="status">
            {msg}
          </p>
        )}
      </div>
    </section>
  );
}
