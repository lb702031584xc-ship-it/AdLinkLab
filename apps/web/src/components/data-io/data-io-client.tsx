"use client";

import { useRef, useState } from "react";
import type { DataIoDict } from "@/i18n/dict/data-io";
import {
  exportDataAction,
  importSettingsAction,
} from "@/lib/api/data-io-actions";

const inputCls =
  "rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-50";

export function DataIoClient({ t }: { t: DataIoDict }) {
  const [exportType, setExportType] = useState<"offers" | "campaigns" | "settings">("offers");
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
  const [exporting, setExporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(true);
  const [importResult, setImportResult] = useState<{ applied: string[]; skipped: string[] } | null>(null);

  async function onExport() {
    setExporting(true);
    const res = await exportDataAction(exportType, exportFormat);
    setExporting(false);
    if (!res.ok) {
      setMsgOk(false);
      setMsg(res.error);
      return;
    }
    setMsgOk(true);
    setMsg("");
    const blob = new Blob([res.data.content], { type: res.data.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      setMsgOk(false);
      setMsg(t.import.invalidJson);
      return;
    }
    setImporting(true);
    const res = await importSettingsAction(doc);
    setImporting(false);
    if (!res.ok) {
      setMsgOk(false);
      setMsg(res.error);
      return;
    }
    setMsgOk(true);
    setImportResult(res.data);
    setMsg(t.import.done);
  }

  return (
    <div className="space-y-5">
      {msg ? (
        <p className={`text-xs ${msgOk ? "text-emerald-600" : "text-red-600"}`} role="status">
          {msg}
        </p>
      ) : null}

      {/* 数据导出 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">{t.export.title}</h2>
        <p className="mt-0.5 text-xs text-ink/55">{t.export.subtitle}</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/70">{t.export.type}</span>
            <select
              className={inputCls}
              value={exportType}
              onChange={(e) => {
                const v = e.target.value as typeof exportType;
                setExportType(v);
                if (v === "settings") setExportFormat("json");
              }}
            >
              <option value="offers">{t.export.types.offers}</option>
              <option value="campaigns">{t.export.types.campaigns}</option>
              <option value="settings">{t.export.types.settings}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink/70">{t.export.format}</span>
            <select
              className={inputCls}
              value={exportFormat}
              disabled={exportType === "settings"}
              onChange={(e) => setExportFormat(e.target.value as "json" | "csv")}
            >
              <option value="json">{t.export.formats.json}</option>
              <option value="csv">{t.export.formats.csv}</option>
            </select>
          </label>
          <button className={btnPrimary} disabled={exporting} onClick={() => void onExport()}>
            {exporting ? t.export.exporting : `⬇️ ${t.export.button}`}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink/45">{t.export.noteSettings}</p>
      </section>

      {/* 配置导入 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">{t.import.title}</h2>
        <p className="mt-0.5 text-xs text-ink/55">{t.import.subtitle}</p>
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700">
          ⚠️ {t.import.warn}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={btnGhost + " cursor-pointer"}>
            {t.import.pickFile}
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </label>
          <span className="text-xs text-ink/50">{fileName ?? t.import.noFile}</span>
          <button
            className={btnPrimary}
            disabled={importing || !fileName}
            onClick={() => void onImport()}
          >
            {importing ? t.import.importing : t.import.button}
          </button>
        </div>
        {importResult ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-emerald-500/[0.06] px-4 py-3 text-xs">
              <p className="font-medium text-emerald-700">
                ✓ {t.import.applied}（{importResult.applied.length}）
              </p>
              <p className="mt-1 text-ink/60">{importResult.applied.join("、") || "—"}</p>
            </div>
            <div className="rounded-lg bg-ink/[0.03] px-4 py-3 text-xs">
              <p className="font-medium text-ink/70">
                {t.import.skipped}（{importResult.skipped.length}）
              </p>
              <p className="mt-1 text-ink/60">{importResult.skipped.join("；") || "—"}</p>
            </div>
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-ink/45">{t.import.note}</p>
      </section>

      {/* 分类说明表 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-ink">{t.table.title}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/50">
                <th className="py-2 pr-4">{t.table.columns.category}</th>
                <th className="py-2 pr-4">{t.table.columns.desc}</th>
                <th className="py-2 text-right">{t.table.columns.importable}</th>
              </tr>
            </thead>
            <tbody>
              {t.table.rows.map((r) => (
                <tr key={r.category} className="border-b border-ink/5 last:border-0">
                  <td className="py-2.5 pr-4 font-mono text-[13px] text-ink">{r.category}</td>
                  <td className="py-2.5 pr-4 text-xs text-ink/65">{r.desc}</td>
                  <td className="py-2.5 text-right text-xs text-ink/70">{r.importable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
