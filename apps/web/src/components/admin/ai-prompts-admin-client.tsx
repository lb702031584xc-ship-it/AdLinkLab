"use client";

/**
 * P1-18：提示词 DB 化 — 管理页（admin/owner）。
 * 编辑 = 新建版本行并激活（旧行保留，可回滚）；也可切换激活到已有版本。
 */
import { useEffect, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";

import {
  getAiPromptsByKeyAction,
  listAiPromptsAction,
  saveAiPromptAction,
  type AiPromptRow,
} from "@/lib/api/ai-prompts-actions";

export function AiPromptsAdminClient() {
  const [rows, setRows] = useState<AiPromptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("terms");
  const [content, setContent] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const res = await listAiPromptsAction();
    if (res.ok) setRows(res.data.items ?? []);
    else setError(res.error);
  };

  useEffect(() => {
    void load();
  }, []);

  async function loadContent(key: string, rowVersion?: string) {
    const res = await getAiPromptsByKeyAction(key);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const items: AiPromptRow[] = res.data.items ?? [];
    const target =
      items.find((r) => r.version === rowVersion) ?? items.find((r) => r.isActive);
    if (target) setContent(target.content ?? "");
  }

  async function save() {
    if (!version.trim() || !content.trim()) {
      setMsg("请填写 version 与 content。");
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await saveAiPromptAction({
      key: selectedKey,
      version: version.trim(),
      content,
    });
    if (res.ok) {
      setMsg(`已创建 ${selectedKey}@${version.trim()} 并激活。`);
      await load();
    } else {
      setMsg(res.error);
    }
    setBusy(false);
  }

  async function activate(rowVersion: string) {
    setBusy(true);
    setMsg(null);
    const res = await saveAiPromptAction({ key: selectedKey, version: rowVersion });
    if (res.ok) {
      setMsg(`已激活 ${selectedKey}@${rowVersion}。`);
      await load();
    } else {
      setMsg(res.error);
    }
    setBusy(false);
  }

  const keyRows = rows.filter((r) => r.key === selectedKey);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/70">
        提示词存 DB：编辑会新建版本行并激活，旧行保留可回滚。文案改动时请同步 bump 版本（P0-6 规则）。
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {["terms", "analyze", "ad-plan", "traffic"].map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-lg border px-3 py-1.5 text-sm ${selectedKey === k ? "bg-ink text-white" : "bg-white text-ink"}`}
            onClick={() => {
              setSelectedKey(k);
              setVersion("");
              setContent("");
              void loadContent(k);
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">版本列表（{selectedKey}）</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {keyRows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{r.version}</span>
              {r.isActive && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">active</span>
              )}
              <span className="text-ink/50">{new Date(r.updatedAt).toLocaleString()}</span>
              {!r.isActive && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void activate(r.version)}
                  className="rounded border border-ink/15 px-2 py-0.5 text-xs disabled:opacity-50"
                >
                  激活此版本
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadContent(selectedKey, r.version)}
                className="rounded border border-ink/15 px-2 py-0.5 text-xs"
              >
                查看内容
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">新建版本并激活</h2>
        <input
          className={`${inputClass} mt-2`}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="新版本号，如 v3"
        />
        <textarea
          className={`${inputClass} mt-2 font-mono text-xs`}
          rows={12}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="提示词内容（system prompt）…"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          保存并激活
        </button>
        {msg && <p className="mt-2 text-sm text-ink/70">{msg}</p>}
      </div>
    </div>
  );
}
