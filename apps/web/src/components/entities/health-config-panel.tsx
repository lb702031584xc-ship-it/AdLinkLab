"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { updateLinkHealthConfigAction } from "@/lib/api/dead-link-actions";

/** Check interval presets (seconds). Min 600 enforced server-side. */
const INTERVAL_OPTIONS = [
  { sec: 900, zh: "每 15 分钟", en: "Every 15 min" },
  { sec: 1800, zh: "每 30 分钟", en: "Every 30 min" },
  { sec: 3600, zh: "每小时", en: "Hourly" },
  { sec: 21600, zh: "每 6 小时", en: "Every 6 hours" },
  { sec: 43200, zh: "每 12 小时", en: "Every 12 hours" },
  { sec: 86400, zh: "每天", en: "Daily" },
];

export function HealthConfigPanel({
  trackingLinkId,
  initialIntervalSec,
  initialSource,
}: {
  trackingLinkId: string;
  initialIntervalSec: number;
  initialSource: string;
}) {
  const router = useRouter();
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }

  const [intervalSec, setIntervalSec] = useState(initialIntervalSec);
  const [source, setSource] = useState(initialSource);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty =
    intervalSec !== initialIntervalSec || source !== initialSource;

  async function onSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await updateLinkHealthConfigAction(trackingLinkId, {
        healthCheckIntervalSec: intervalSec,
        linkSource: source,
      });
      if (res.ok) {
        setMsg(lang === "zh" ? "已保存" : "Saved");
        router.refresh();
      } else {
        setMsg(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5">
      <h3 className="mb-1 text-base font-semibold text-ink">
        {lang === "zh" ? "链接健康检查" : "Link Health Check"}
      </h3>
      <p className="mb-4 text-sm text-ink/60">
        {lang === "zh"
          ? "每次检查会实际打开链接，确认不是空白页或出错页。死链会自动暂停并告警。"
          : "Each check opens the link and verifies it is not a blank or error page. Dead links auto-pause with an alert."}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink/70">
            {lang === "zh" ? "检查频率" : "Check interval"}
          </span>
          <select
            value={intervalSec}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.sec} value={o.sec}>
                {lang === "zh" ? o.zh : o.en}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink/70">
            {lang === "zh" ? "链接来源" : "Link source"}
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="MANUAL">{lang === "zh" ? "手动填写" : "Manual"}</option>
            <option value="AUTO">{lang === "zh" ? "自动同步" : "Auto-synced"}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {saving
            ? lang === "zh"
              ? "保存中…"
              : "Saving…"
            : lang === "zh"
              ? "保存"
              : "Save"}
        </button>
        {msg && <span className="text-sm text-ink/70">{msg}</span>}
      </div>
    </section>
  );
}
