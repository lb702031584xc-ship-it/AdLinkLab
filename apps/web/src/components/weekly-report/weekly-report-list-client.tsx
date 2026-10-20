"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as weeklyReportZh, en as weeklyReportEn } from "@/i18n/dict/weekly-report";
import {
  generateWeeklyReportAction,
  type WeeklyReportRow,
} from "@/lib/api/weekly-report-actions";

/** Automation round 2 — weekly report list + manual generation. */
export function WeeklyReportListClient({
  initial,
}: {
  initial: WeeklyReportRow[];
}) {
  const router = useRouter();
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d = lang === "en" ? weeklyReportEn : weeklyReportZh;

  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onGenerate() {
    setGenerating(true);
    setMsg(null);
    try {
      const res = await generateWeeklyReportAction();
      if (res.ok) {
        const r = res.data.data;
        setMsg(
          d.list.generatedOk +
            " " +
            d.list.generatedSummary
              .replace("{s}", r.weekStart)
              .replace("{e}", r.weekEnd)
              .replace("{c}", String(r.conversions))
              .replace("{a}", String(r.alerts))
              .replace("{t}", String(r.newTasks))
              .replace("{d}", String(r.deadLinks))
        );
        router.refresh();
      } else {
        setMsg(`${d.list.generateFailedPrefix}${res.error}`);
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.list.title}
        description={d.list.description}
        actions={
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {generating ? d.list.generating : d.list.generateNow}
          </button>
        }
      />

      {msg && (
        <div className="rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink">
          {msg}
        </div>
      )}

      {initial.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white px-6 py-10 text-center text-sm text-ink/60">
          {d.list.empty}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-ink/5 text-ink/60">
              <tr>
                <th className="px-3 py-2">{d.list.week}</th>
                <th className="px-3 py-2">{d.list.status}</th>
                <th className="px-3 py-2">{d.list.createdAt}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {initial.map((r) => (
                <tr key={r.id} className="border-t border-ink/10">
                  <td className="px-3 py-2 font-medium text-ink">
                    {formatDateTime(r.weekStart)} ~ {formatDateTime(r.weekEnd)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.status === "SENT"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {r.status === "SENT"
                        ? d.list.statusSent
                        : d.list.statusGenerated}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink/70">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/reports/weekly/${r.id}`}
                      className="text-signal hover:underline"
                    >
                      {d.list.view}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
