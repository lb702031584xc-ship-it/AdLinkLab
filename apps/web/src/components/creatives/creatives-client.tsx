"use client";

import { useMemo, useState } from "react";
import type { CreativesDict } from "@/i18n/dict/creatives";
import {
  createCreativeAction,
  deleteCreativeAction,
  importArchiveCreativesAction,
  listCreativesAction,
  updateCreativeAction,
  type Creative,
} from "@/lib/api/creatives-actions";

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none disabled:opacity-60";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-50";

const STATUS_STYLE: Record<Creative["status"], string> = {
  DRAFT: "bg-ink/5 text-ink/60",
  USED: "bg-emerald-500/10 text-emerald-700",
  ARCHIVED: "bg-amber-500/10 text-amber-700",
};

interface FormState {
  title: string;
  description: string;
  finalUrl: string;
  angle: string;
}

const EMPTY_FORM: FormState = { title: "", description: "", finalUrl: "", angle: "" };

export function CreativesClient({
  t,
  initial,
}: {
  t: CreativesDict;
  initial: Creative[];
}) {
  const [items, setItems] = useState<Creative[]>(initial);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Creative | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const counts = useMemo(
    () => ({
      total: items.length,
      DRAFT: items.filter((i) => i.status === "DRAFT").length,
      USED: items.filter((i) => i.status === "USED").length,
      ARCHIVED: items.filter((i) => i.status === "ARCHIVED").length,
    }),
    [items]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (status && i.status !== status) return false;
      if (!needle) return true;
      return (
        i.title.toLowerCase().includes(needle) ||
        i.description.toLowerCase().includes(needle) ||
        (i.angle ?? "").toLowerCase().includes(needle)
      );
    });
  }, [items, status, q]);

  async function reload() {
    const res = await listCreativesAction({ pageSize: 100 });
    if (res.ok) setItems(res.data.items);
  }

  async function onSave() {
    if (!form.title.trim() || !form.description.trim()) {
      setMsgOk(false);
      setMsg(t.form.titleRequired);
      return;
    }
    setBusy(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      finalUrl: form.finalUrl.trim() || undefined,
      angle: form.angle.trim() || undefined,
    };
    const res = editing
      ? await updateCreativeAction(editing.id, {
          ...payload,
          finalUrl: payload.finalUrl ?? null,
          angle: payload.angle ?? null,
        })
      : await createCreativeAction(payload);
    setBusy(false);
    if (!res.ok) {
      setMsgOk(false);
      setMsg(res.error);
      return;
    }
    setMsgOk(true);
    setMsg(t.form.saved);
    setForm(EMPTY_FORM);
    setEditing(null);
    setFormOpen(false);
    await reload();
  }

  async function onStatus(c: Creative, next: Creative["status"]) {
    const res = await updateCreativeAction(c.id, { status: next });
    if (!res.ok) {
      setMsgOk(false);
      setMsg(res.error);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === c.id ? res.data : i)));
  }

  async function onDelete(c: Creative) {
    if (!window.confirm(t.form.deleteConfirm)) return;
    const res = await deleteCreativeAction(c.id);
    if (!res.ok) {
      setMsgOk(false);
      setMsg(res.error);
      return;
    }
    setMsgOk(true);
    setMsg(t.form.deleted);
    setItems((prev) => prev.filter((i) => i.id !== c.id));
  }

  async function onImport() {
    setImporting(true);
    const res = await importArchiveCreativesAction();
    setImporting(false);
    if (!res.ok) {
      setMsgOk(false);
      setMsg(res.error);
      return;
    }
    setMsgOk(true);
    setMsg(
      res.data.created === 0
        ? t.import.empty
        : t.import.done
            .replace("{c}", String(res.data.created))
            .replace("{s}", String(res.data.skipped))
    );
    await reload();
  }

  return (
    <div>
      {/* 统计卡片 */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [t.stats.total, counts.total, "text-ink"],
            [t.stats.draft, counts.DRAFT, "text-ink/70"],
            [t.stats.used, counts.USED, "text-emerald-600"],
            [t.stats.archived, counts.ARCHIVED, "text-amber-600"],
          ] as Array<[string, number, string]>
        ).map(([label, value, cls]) => (
          <div key={label} className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
            <p className="text-xs text-ink/50">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-xs`}
          placeholder={t.filters.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t.filters.statusAll}</option>
          <option value="DRAFT">{t.filters.statuses.DRAFT}</option>
          <option value="USED">{t.filters.statuses.USED}</option>
          <option value="ARCHIVED">{t.filters.statuses.ARCHIVED}</option>
        </select>
        <button className={btnGhost} onClick={() => void reload()}>
          ⟳ {t.filters.refresh}
        </button>
        <div className="flex-1" />
        <button className={btnGhost} disabled={importing} onClick={() => void onImport()}>
          {importing ? t.import.importing : `📥 ${t.import.button}`}
        </button>
        <button
          className={btnPrimary}
          onClick={() => {
            setEditing(null);
            setForm(EMPTY_FORM);
            setFormOpen((v) => !v);
          }}
        >
          ＋ {t.form.create}
        </button>
      </div>

      {msg ? (
        <p
          className={`mb-4 text-xs ${msgOk ? "text-emerald-600" : "text-red-600"}`}
          role="status"
        >
          {msg}
        </p>
      ) : null}

      {/* 新建/编辑表单 */}
      {formOpen ? (
        <div className="mb-5 rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-ink">
            {editing ? t.form.edit : t.form.create}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-ink/70">{t.form.title}</span>
              <input
                className={inputCls}
                value={form.title}
                placeholder={t.form.titlePlaceholder}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-ink/70">
                {t.form.description}
              </span>
              <textarea
                className={`${inputCls} min-h-[72px]`}
                value={form.description}
                placeholder={t.form.descriptionPlaceholder}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/70">{t.form.finalUrl}</span>
              <input
                className={inputCls}
                value={form.finalUrl}
                placeholder="https://…"
                onChange={(e) => setForm({ ...form, finalUrl: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/70">{t.form.angle}</span>
              <input
                className={inputCls}
                value={form.angle}
                placeholder={t.form.anglePlaceholder}
                onChange={(e) => setForm({ ...form, angle: e.target.value })}
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={() => void onSave()}>
              {busy ? t.form.saving : t.form.save}
            </button>
            <button
              className={btnGhost}
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
                setForm(EMPTY_FORM);
              }}
            >
              {t.form.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {/* 创意卡片 */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-ink/60">{t.page.empty}</p>
          <p className="mt-2 text-xs text-ink/40">{t.note.ctr}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <article
              key={c.id}
              className="flex flex-col rounded-xl border border-ink/10 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 text-[15px] font-semibold text-ink">{c.title}</h3>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c.status]}`}
                >
                  {t.filters.statuses[c.status]}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-ink/65">{c.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-ink/55">
                  {t.form.source}：{t.filters.sources[c.source]}
                </span>
                {c.angle ? (
                  <span className="rounded-full bg-signal/10 px-2 py-0.5 text-signal">
                    {c.angle}
                  </span>
                ) : null}
                {c.offerName ? (
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-ink/55">
                    {c.offerName}
                  </span>
                ) : null}
              </div>
              {c.finalUrl ? (
                <p className="mt-2 truncate font-mono text-[11px] text-ink/45">{c.finalUrl}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink/8 pt-3 text-xs">
                <button
                  className="text-signal hover:underline"
                  onClick={() => {
                    setEditing(c);
                    setForm({
                      title: c.title,
                      description: c.description,
                      finalUrl: c.finalUrl ?? "",
                      angle: c.angle ?? "",
                    });
                    setFormOpen(true);
                  }}
                >
                  ✏️ {t.form.edit}
                </button>
                {c.status !== "USED" ? (
                  <button
                    className="text-emerald-600 hover:underline"
                    onClick={() => void onStatus(c, "USED")}
                  >
                    ✓ {t.form.markUsed}
                  </button>
                ) : (
                  <button
                    className="text-ink/60 hover:underline"
                    onClick={() => void onStatus(c, "DRAFT")}
                  >
                    {t.form.markDraft}
                  </button>
                )}
                {c.status !== "ARCHIVED" ? (
                  <button
                    className="text-amber-600 hover:underline"
                    onClick={() => void onStatus(c, "ARCHIVED")}
                  >
                    {t.form.archive}
                  </button>
                ) : null}
                <button
                  className="ml-auto text-red-600 hover:underline"
                  onClick={() => void onDelete(c)}
                >
                  {t.form.delete}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-ink/45">{t.note.ctr}</p>
    </div>
  );
}
