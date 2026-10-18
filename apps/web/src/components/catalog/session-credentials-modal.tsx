"use client";

import { useState } from "react";
import { saveSessionCredentialsAction } from "@/lib/api/catalog-actions";

/**
 * 登录账号设置弹窗（从 catalog-client.tsx 抽出的共用组件）。
 *
 * 安全口径（一个不许动）：
 * - 密码用 password 框输入，永不回显；
 * - 后端 AES-256-GCM 加密存储，GET 永不返回密码；
 * - 留空 = 不修改已保存的密码（后端只在非空时覆盖）。
 */
export interface SessionCredentialsModeDict {
  credTitle: string;
  credUsername: string;
  credUsernamePh: string;
  credPassword: string;
  credPasswordPh: string;
  credValidDays: string;
  credValidDaysHint: string;
  credSave: string;
  credSaved: string;
  saving: string;
  cancel: string;
}

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-ink/60";

export function SessionCredentialsModal({
  d,
  networkId,
  networkName,
  initialUsername,
  initialValidDays,
  onClose,
  onSaved,
  showMsg,
}: {
  d: SessionCredentialsModeDict;
  networkId: string;
  networkName: string;
  initialUsername: string;
  initialValidDays: number;
  onClose: () => void;
  /** 保存成功后回调：返回用于乐观更新的字段。 */
  onSaved: (patch: {
    sessionUsername: string | null;
    sessionPasswordSet: boolean;
    sessionValidDays: number;
    lastLoginAt: string;
    sessionExpiresAt: string;
  }) => void;
  showMsg: (m: string | null) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [validDays, setValidDays] = useState(String(initialValidDays));
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (saving) return;
    const days = Number(validDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      showMsg(d.credValidDaysHint);
      return;
    }
    setSaving(true);
    showMsg(null);
    const res = await saveSessionCredentialsAction(networkId, {
      username: username.trim(),
      // 留空 = 不修改已保存的密码（后端只在非空时覆盖）。
      password: password,
      sessionValidDays: days,
    });
    setSaving(false);
    if (!res.ok) {
      showMsg(res.error);
      return;
    }
    const passwordChanged = password.length > 0;
    setPassword("");
    onClose();
    showMsg(d.credSaved);
    const nowMs = Date.now();
    onSaved({
      sessionUsername: username.trim() || null,
      sessionPasswordSet: passwordChanged,
      sessionValidDays: days,
      lastLoginAt: new Date(nowMs).toISOString(),
      sessionExpiresAt: new Date(nowMs + days * 86400000).toISOString(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-ink">
          {d.credTitle} · {networkName}
        </h3>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={labelCls}>{d.credUsername}</span>
            <input
              className={inputCls}
              type="text"
              autoComplete="off"
              placeholder={d.credUsernamePh}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelCls}>{d.credPassword}</span>
            <input
              className={inputCls}
              type="password"
              autoComplete="new-password"
              placeholder={d.credPasswordPh}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelCls}>{d.credValidDays}</span>
            <input
              className={inputCls}
              type="number"
              min={1}
              max={365}
              value={validDays}
              onChange={(e) => setValidDays(e.target.value)}
            />
            <span className="mt-1 block text-xs text-ink/50">
              {d.credValidDaysHint}
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button
            className={btnGhost}
            onClick={() => {
              setPassword("");
              onClose();
            }}
            disabled={saving}
          >
            {d.cancel}
          </button>
          <button className={btnPrimary} onClick={onSave} disabled={saving}>
            {saving ? d.saving : d.credSave}
          </button>
        </div>
      </div>
    </div>
  );
}
