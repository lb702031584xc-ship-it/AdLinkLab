"use client";

import { useState } from "react";
import type { SettingsDict } from "@/i18n/dict/settings";
import { useI18n } from "@/i18n/I18nProvider";
import type { Lang } from "@/i18n/dictionaries";
import {
  deleteSettingsAiAction,
  saveSettingsAdsAction,
  saveSettingsAiAction,
  saveSettingsProxiesAction,
  saveSettingsSystemAction,
  testSettingsAiAction,
  type AiProvider,
  type MccConnection,
  type TenantSettings,
} from "@/lib/api/settings-actions";
import type { CatalogNetwork } from "@/lib/api/catalog-actions";

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none disabled:opacity-60";

const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5 disabled:opacity-50";
const btnDanger =
  "rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-600 hover:bg-red-500/5 disabled:opacity-50";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-ink/55">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink/70">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink/45">{hint}</span> : null}
    </label>
  );
}

function Msg({ text, ok }: { text: string; ok: boolean }) {
  if (!text) return null;
  return (
    <p
      className={`mt-3 text-xs ${ok ? "text-emerald-600" : "text-red-600"}`}
      role="status"
    >
      {text}
    </p>
  );
}

export function SettingsClient({
  t,
  initial,
  networks,
  platformAdmin,
}: {
  t: SettingsDict;
  initial: TenantSettings;
  networks: CatalogNetwork[];
  platformAdmin: boolean;
}) {
  const { lang, setLang } = useI18n();
  const readonly = !platformAdmin;

  /* ── AI ── */
  const [aiProvider, setAiProvider] = useState<AiProvider>(
    initial.ai.provider ?? "deepseek"
  );
  const [aiModel, setAiModel] = useState(initial.ai.model || "");
  const [aiCustom, setAiCustom] = useState(
    Boolean(initial.ai.model && aiModelNotListed(initial.ai.provider, initial.ai.model, initial.aiModels))
  );
  const [aiEndpoint, setAiEndpoint] = useState(initial.ai.endpoint || "");
  const [aiKey, setAiKey] = useState("");
  const [aiMsg, setAiMsg] = useState("");
  const [aiOk, setAiOk] = useState(true);
  const [aiBusy, setAiBusy] = useState<"save" | "test" | null>(null);
  const [aiKeyConfigured, setAiKeyConfigured] = useState(
    initial.ai.apiKeyConfigured
  );

  const endpointAuto = aiProvider !== "relay";
  const effectiveEndpoint = endpointAuto
    ? deriveEndpoint(aiProvider, initial.ai.endpoint)
    : aiEndpoint;

  function aiModelNotListed(
    provider: AiProvider | null,
    model: string,
    models: TenantSettings["aiModels"]
  ): boolean {
    if (!provider || !model) return false;
    return !models[provider]?.some((m) => m.id === model);
  }

  async function onAiSave() {
    if (readonly) return setReadonly();
    if (!aiModel.trim()) {
      setAiOk(false);
      setAiMsg(t.ai.modelRequired);
      return;
    }
    setAiBusy("save");
    const res = await saveSettingsAiAction({
      provider: aiProvider,
      model: aiModel.trim(),
      endpoint: endpointAuto ? undefined : aiEndpoint.trim() || undefined,
      apiKey: aiKey.trim() || undefined,
    });
    setAiBusy(null);
    setAiOk(res.ok);
    if (!res.ok) return void setAiMsg(res.error);
    setAiKey("");
    setAiKeyConfigured(res.data.apiKeyConfigured);
    setAiEndpoint(res.data.endpoint);
    setAiModel(res.data.model);
    setAiMsg(t.ai.saved);
  }

  async function onAiTest() {
    if (readonly) return setReadonly();
    setAiBusy("test");
    const res = await testSettingsAiAction({
      provider: aiProvider,
      model: aiModel.trim() || undefined,
      endpoint: endpointAuto ? undefined : aiEndpoint.trim() || undefined,
      apiKey: aiKey.trim() || undefined,
    });
    setAiBusy(null);
    setAiOk(res.ok && res.data.ok);
    setAiMsg(
      res.ok
        ? `${res.data.ok ? t.ai.testOk : t.ai.testFail}: ${res.data.message}`
        : res.error
    );
  }

  async function onAiDelete() {
    if (readonly) return setReadonly();
    if (!window.confirm(t.ai.removeConfirm)) return;
    const res = await deleteSettingsAiAction();
    setAiOk(res.ok);
    if (!res.ok) return void setAiMsg(res.error);
    setAiModel("");
    setAiEndpoint("");
    setAiKey("");
    setAiKeyConfigured(false);
    setAiMsg(t.ai.removed);
  }

  /* ── MCC ── */
  const [mccs, setMccs] = useState<MccConnection[]>(initial.ads.mccs);
  const [mccName, setMccName] = useState("");
  const [mccId, setMccId] = useState("");
  const [mccMode, setMccMode] = useState<"script" | "api">("script");
  const [mccMsg, setMccMsg] = useState("");
  const [mccOk, setMccOk] = useState(true);
  const [mccBusy, setMccBusy] = useState(false);

  function onMccAdd() {
    if (readonly) return setReadonly();
    if (!mccName.trim() || !mccId.trim()) {
      setMccOk(false);
      setMccMsg(`${t.ads.name} / ${t.ads.customerId}`);
      return;
    }
    setMccs((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name: mccName.trim(),
        customerId: mccId.trim(),
        mode: mccMode,
      },
    ]);
    setMccName("");
    setMccId("");
    setMccMsg("");
  }

  async function onMccSave() {
    if (readonly) return setReadonly();
    setMccBusy(true);
    const res = await saveSettingsAdsAction(
      mccs.map((m) => ({ name: m.name, customerId: m.customerId, mode: m.mode }))
    );
    setMccBusy(false);
    setMccOk(res.ok);
    if (!res.ok) return void setMccMsg(res.error);
    setMccs(res.data.mccs);
    setMccMsg(t.ads.saved);
  }

  /* ── 代理 ── */
  const [proxyText, setProxyText] = useState("");
  const [proxyCount, setProxyCount] = useState(initial.proxies.count);
  const [proxyMsg, setProxyMsg] = useState("");
  const [proxyOk, setProxyOk] = useState(true);
  const [proxyBusy, setProxyBusy] = useState(false);

  async function onProxySave(clear = false) {
    if (readonly) return setReadonly();
    if (clear && !window.confirm(t.proxies.clearConfirm)) return;
    setProxyBusy(true);
    const urls = clear ? [] : proxyText.split("\n").map((u) => u.trim()).filter(Boolean);
    const res = await saveSettingsProxiesAction(urls);
    setProxyBusy(false);
    setProxyOk(res.ok);
    if (!res.ok) return void setProxyMsg(res.error);
    setProxyCount(res.data.count);
    setProxyText("");
    setProxyMsg(t.proxies.saved);
  }

  /* ── 系统偏好 ── */
  const [currency, setCurrency] = useState(initial.system.defaultCurrency);
  const [linkCheck, setLinkCheck] = useState(initial.system.linkCheckEnabled);
  const [linkHour, setLinkHour] = useState(initial.system.linkCheckHour);
  const [linkMin, setLinkMin] = useState(initial.system.linkCheckMinute);
  const [sysMsg, setSysMsg] = useState("");
  const [sysOk, setSysOk] = useState(true);
  const [sysBusy, setSysBusy] = useState(false);

  async function onSysSave() {
    if (readonly) return setReadonly();
    setSysBusy(true);
    const res = await saveSettingsSystemAction({
      defaultCurrency: currency,
      linkCheckEnabled: linkCheck,
      linkCheckHour: linkHour,
      linkCheckMinute: linkMin,
    });
    setSysBusy(false);
    setSysOk(res.ok);
    setSysMsg(res.ok ? t.system.saved : res.error);
  }

  function setReadonly() {
    setAiOk(false);
    setAiMsg(t.page.readonlyNotice);
    setMccOk(false);
    setMccMsg(t.page.readonlyNotice);
    setProxyOk(false);
    setProxyMsg(t.page.readonlyNotice);
    setSysOk(false);
    setSysMsg(t.page.readonlyNotice);
  }

  const modelOptions = initial.aiModels[aiProvider] ?? [];

  return (
    <div className="space-y-5">
      {/* 配置说明 */}
      <section className="rounded-xl border border-signal/30 bg-signal/[0.05] p-5">
        <h2 className="text-sm font-semibold text-ink">ℹ️ {t.guide.title}</h2>
        <ul className="mt-2 space-y-1.5 text-xs text-ink/65">
          {t.guide.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-signal">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
      {readonly ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700">
          ⚠️ {t.page.readonlyNotice}
        </p>
      ) : null}

      {/* AI 引擎 */}
      <Section title={t.ai.title} subtitle={t.ai.subtitle}>
        <p className="mb-4 text-[11px] text-ink/45">{t.ai.stepsHint}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.ai.providerRequired} hint={t.ai.providerHint}>
            <select
              className={inputCls}
              value={aiProvider}
              disabled={readonly}
              onChange={(e) => {
                const p = e.target.value as AiProvider;
                setAiProvider(p);
                setAiModel("");
                setAiCustom(false);
                setAiEndpoint("");
              }}
            >
              <option value="deepseek">{t.ai.providers.deepseek}</option>
              <option value="gemini">{t.ai.providers.gemini}</option>
              <option value="relay">{t.ai.providers.relay}</option>
            </select>
          </Field>
          <Field label={t.ai.modelRequired} hint={t.ai.modelHint}>
            {aiProvider === "relay" || aiCustom ? (
              <input
                className={inputCls}
                value={aiModel}
                disabled={readonly}
                placeholder={t.ai.modelCustomPlaceholder}
                onChange={(e) => setAiModel(e.target.value)}
              />
            ) : (
              <select
                className={inputCls}
                value={aiModel}
                disabled={readonly}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setAiCustom(true);
                    setAiModel("");
                  } else setAiModel(e.target.value);
                }}
              >
                <option value="">—</option>
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">✏️ {t.ai.modelCustomPlaceholder}</option>
              </select>
            )}
          </Field>
          <Field
            label={t.ai.endpoint}
            hint={endpointAuto ? t.ai.endpointAuto : undefined}
          >
            <input
              className={inputCls}
              value={endpointAuto ? effectiveEndpoint : aiEndpoint}
              disabled={readonly || endpointAuto}
              placeholder={endpointAuto ? "" : t.ai.endpointRelayPlaceholder}
              onChange={(e) => setAiEndpoint(e.target.value)}
            />
          </Field>
          <Field label={t.ai.apiKeyRequired}>
            <input
              type="password"
              className={inputCls}
              value={aiKey}
              disabled={readonly}
              autoComplete="new-password"
              placeholder={
                aiKeyConfigured ? t.ai.apiKeyConfiguredPlaceholder : t.ai.apiKeyPlaceholder
              }
              onChange={(e) => setAiKey(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={readonly || aiBusy !== null} onClick={onAiSave}>
            {aiBusy === "save" ? t.ai.saving : t.ai.save}
          </button>
          <button className={btnGhost} disabled={readonly || aiBusy !== null} onClick={onAiTest}>
            {aiBusy === "test" ? t.ai.testing : t.ai.test}
          </button>
          {aiKeyConfigured ? (
            <button className={btnDanger} disabled={readonly} onClick={onAiDelete}>
              {t.ai.remove}
            </button>
          ) : null}
        </div>
        <Msg text={aiMsg} ok={aiOk} />
      </Section>

      {/* 广告发布设置 */}
      <Section title={t.ads.title} subtitle={t.ads.subtitle}>
        {mccs.length === 0 ? (
          <p className="mb-4 text-xs text-ink/50">{t.ads.empty}</p>
        ) : (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {mccs.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-ink/[0.02] px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{m.name}</p>
                  <p className="font-mono text-xs text-ink/60">{m.customerId}</p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${
                      m.mode === "script"
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-amber-500/10 text-amber-700"
                    }`}
                  >
                    {t.ads.modes[m.mode]}
                    {m.mode === "api" ? ` · ${t.ads.apiPlanned}` : ""}
                  </span>
                </div>
                <button
                  className="text-xs text-red-600 hover:underline disabled:opacity-40"
                  disabled={readonly}
                  onClick={() => setMccs((prev) => prev.filter((x) => x.id !== m.id))}
                >
                  {t.ads.remove}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto]">
          <Field label={t.ads.name}>
            <input
              className={inputCls}
              value={mccName}
              disabled={readonly}
              placeholder={t.ads.namePlaceholder}
              onChange={(e) => setMccName(e.target.value)}
            />
          </Field>
          <Field label={t.ads.customerId}>
            <input
              className={inputCls}
              value={mccId}
              disabled={readonly}
              placeholder={t.ads.customerIdPlaceholder}
              onChange={(e) => setMccId(e.target.value)}
            />
          </Field>
          <Field label={t.ads.mode}>
            <select
              className={inputCls}
              value={mccMode}
              disabled={readonly}
              onChange={(e) => setMccMode(e.target.value as "script" | "api")}
            >
              <option value="script">{t.ads.modes.script}</option>
              <option value="api">{t.ads.modes.api}</option>
            </select>
          </Field>
          <div className="flex items-end">
            <button className={btnGhost} disabled={readonly} onClick={onMccAdd}>
              ＋ {t.ads.add}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={readonly || mccBusy} onClick={onMccSave}>
            {mccBusy ? t.ads.saving : t.ads.save}
          </button>
          <a href="/google-accounts" className="text-xs text-signal hover:underline">
            {t.ads.manageAccounts}
          </a>
        </div>
        <p className="mt-2 text-[11px] text-ink/45">{t.ads.hint}</p>
        <Msg text={mccMsg} ok={mccOk} />
      </Section>

      {/* 代理设置 */}
      <Section title={t.proxies.title} subtitle={t.proxies.subtitle}>
        <p className="mb-3 text-xs text-ink/55">
          {proxyCount > 0 ? t.proxies.configured.replace("{n}", String(proxyCount)) : t.proxies.none}
        </p>
        <Field label={t.proxies.label} hint={t.proxies.formatHint}>
          <textarea
            className={`${inputCls} min-h-[110px] font-mono`}
            value={proxyText}
            disabled={readonly}
            placeholder={t.proxies.placeholder}
            onChange={(e) => setProxyText(e.target.value)}
          />
        </Field>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={readonly || proxyBusy} onClick={() => onProxySave(false)}>
            {proxyBusy ? t.proxies.saving : t.proxies.save}
          </button>
          {proxyCount > 0 ? (
            <button className={btnDanger} disabled={readonly || proxyBusy} onClick={() => onProxySave(true)}>
              {t.proxies.clear}
            </button>
          ) : null}
        </div>
        <Msg text={proxyMsg} ok={proxyOk} />
      </Section>

      {/* 联盟账号配置 */}
      <Section title={t.networks.title} subtitle={t.networks.subtitle}>
        {networks.length === 0 ? (
          <p className="text-xs text-ink/50">{t.networks.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {networks.map((n) => (
                  <tr key={n.id} className="border-b border-ink/5 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-ink">{n.name}</td>
                    <td className="py-2.5 pr-4 text-xs">
                      {n.apiConfigured ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700">
                          {t.networks.apiConfigured}
                        </span>
                      ) : n.sessionConfigured ? (
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-700">
                          {t.networks.sessionConfigured}
                        </span>
                      ) : (
                        <span className="text-ink/40">{t.networks.notConfigured}</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <a href="/catalog" className="text-xs text-signal hover:underline">
                        {t.networks.manage}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 系统偏好 */}
      <Section title={t.system.title} subtitle={t.system.subtitle}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.system.defaultCurrency}>
            <select
              className={inputCls}
              value={currency}
              disabled={readonly}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="CNY">{t.system.currencies.CNY}</option>
              <option value="USD">{t.system.currencies.USD}</option>
              <option value="EUR">{t.system.currencies.EUR}</option>
              <option value="JPY">{t.system.currencies.JPY}</option>
            </select>
          </Field>
          <Field label={t.system.language}>
            <select
              className={inputCls}
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              <option value="zh">简体中文</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={t.system.linkCheck} hint={t.system.linkCheckHint}>
            <select
              className={inputCls}
              value={linkCheck ? "on" : "off"}
              disabled={readonly}
              onChange={(e) => setLinkCheck(e.target.value === "on")}
            >
              <option value="on">{t.system.enabled}</option>
              <option value="off">{t.system.disabled}</option>
            </select>
          </Field>
          <Field label={t.system.linkCheckTime}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                className={inputCls}
                value={linkHour}
                disabled={readonly}
                onChange={(e) => setLinkHour(Number(e.target.value))}
              />
              <span className="text-ink/50">:</span>
              <input
                type="number"
                min={0}
                max={59}
                className={inputCls}
                value={linkMin}
                disabled={readonly}
                onChange={(e) => setLinkMin(Number(e.target.value))}
              />
            </div>
          </Field>
        </div>
        <div className="mt-4">
          <button className={btnPrimary} disabled={readonly || sysBusy} onClick={onSysSave}>
            {sysBusy ? t.system.saving : t.system.save}
          </button>
        </div>
        <Msg text={sysMsg} ok={sysOk} />
      </Section>
    </div>
  );
}

function deriveEndpoint(provider: AiProvider, configuredEndpoint: string): string {
  if (provider === "deepseek") return "https://api.deepseek.com";
  if (provider === "gemini")
    return "https://generativelanguage.googleapis.com/v1beta/openai";
  return configuredEndpoint;
}
