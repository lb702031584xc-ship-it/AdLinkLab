"use client";

/**
 * P1-27：数据导出 / 导入（admin）。
 * 导出默认脱敏（密钥类字段 → [REDACTED]）；勾选“包含敏感值”才返回真实值。
 * 导入只接受本系统导出的 JSON；受保护 Token 一律跳过并上报，绝不导入；
 * settings / campaigns 只做校验（validate-only），不实际应用。
 */
import { useState } from "react";
import {
  exportDataAction,
  importDataAction,
} from "@/lib/api/data-exchange-actions";
import type { DataExchangeKind } from "@/lib/api/data-exchange";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";

export function DataExchangeClient() {
  const [kind, setKind] = useState<DataExchangeKind>("offers");
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onExport() {
    setBusy(true);
    setMsg(null);
    const res = await exportDataAction(kind, includeSensitive);
    setBusy(false);
    if (!res.ok) {
      setMsg(`导出失败：${res.error}`);
      return;
    }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adlinklab-export-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(
      `已导出 ${res.data.items.length} 条（${kind}）。${res.data.sensitiveIncluded ? "⚠️ 已包含敏感值，请妥善保管。" : "已脱敏：密钥类字段为 [REDACTED]。"}`,
    );
  }

  async function onImport() {
    setBusy(true);
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setBusy(false);
      setMsg("导入失败：不是合法 JSON。");
      return;
    }
    const res = await importDataAction(kind, parsed);
    setBusy(false);
    if (!res.ok) {
      setMsg(`导入失败：${res.error}`);
      return;
    }
    const d = res.data;
    setMsg(
      `导入完成（${d.mode}，applied=${String(d.applied)}）：${d.note}\n` +
        `会导入：${d.wouldImport.length ? d.wouldImport.join("、") : "无"}\n` +
        `跳过受保护：${d.skippedProtected.length ? d.skippedProtected.join("、") : "无"}` +
        (typeof d.created === "number" ? `\n新建：${d.created}，已存在：${d.replayed ?? 0}` : "")
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">导出</h2>
        <p className="mt-1 text-xs text-ink/60">
          分类：google_ads 部分可导入（campaigns 只校验不创建）；ai / proxy / system 设置只做校验，不直接应用。
          导出默认脱敏；只有显式勾选才包含敏感值。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
            value={kind}
            onChange={(e) => setKind(e.target.value as DataExchangeKind)}
          >
            <option value="offers">offers（商品）</option>
            <option value="campaigns">campaigns（广告系列）</option>
            <option value="settings">settings（设置）</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-ink/80">
            <input
              type="checkbox"
              checked={includeSensitive}
              onChange={(e) => setIncludeSensitive(e.target.checked)}
            />
            包含敏感值（显式确认）
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onExport()}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            导出 JSON
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">导入</h2>
        <p className="mt-1 text-xs text-ink/60">
          只接受本系统导出的 JSON（exportedBy=AdLinkLab）。受保护 Token（refresh_token / access_token 等）一律跳过，需重新 OAuth。
        </p>
        <textarea
          className={`${inputClass} mt-3 font-mono text-xs`}
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='粘贴导出的 JSON…'
        />
        <button
          type="button"
          disabled={busy || !importText.trim()}
          onClick={() => void onImport()}
          className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          导入
        </button>
      </div>
      {msg && (
        <p className="whitespace-pre-line rounded-lg border border-ink/10 bg-ink/[0.03] px-4 py-2 text-sm text-ink/80">
          {msg}
        </p>
      )}
    </div>
  );
}
