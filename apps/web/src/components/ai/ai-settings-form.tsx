"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { saveAiSettingsAction, testAiConnectionAction } from "@/lib/api/ai-actions";
import type { AiSettings } from "@/lib/api/ai";
import type { AiConnectionTestResult } from "@/lib/api/ai";

const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
} as const;

type PresetKey = keyof typeof PRESETS | "custom";

export function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const t = useDict();
  const [preset, setPreset] = useState<PresetKey>("custom");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(initial.hasKey);
  const [amazonAccessKey, setAmazonAccessKey] = useState("");
  const [amazonSecretKey, setAmazonSecretKey] = useState("");
  const [amazonPartnerTag, setAmazonPartnerTag] = useState("");
  const [amazonRegion, setAmazonRegion] = useState("us-east-1");
  const [hasAmazonPaapi, setHasAmazonPaapi] = useState(initial.hasAmazonPaapi);
  const [similarwebKey, setSimilarwebKey] = useState("");
  const [dataforseoLogin, setDataforseoLogin] = useState("");
  const [dataforseoPassword, setDataforseoPassword] = useState("");
  const [hasSimilarweb, setHasSimilarweb] = useState(initial.hasTrafficSimilarweb === true);
  const [hasDataforseo, setHasDataforseo] = useState(initial.hasTrafficDataforseo === true);
  const [keepaKey, setKeepaKey] = useState("");
  const [hasKeepa, setHasKeepa] = useState(initial.hasKeepa === true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  function applyPreset(p: PresetKey) {
    setPreset(p);
    if (p !== "custom") {
      setBaseUrl(PRESETS[p].baseUrl);
      setModel(PRESETS[p].model);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const amazonPaapi =
        amazonAccessKey.trim() || amazonSecretKey.trim() || amazonPartnerTag.trim()
          ? {
              accessKey: amazonAccessKey.trim(),
              secretKey: amazonSecretKey.trim(),
              partnerTag: amazonPartnerTag.trim(),
              region: amazonRegion.trim() || "us-east-1",
            }
          : undefined;
      const res = await saveAiSettingsAction({
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        amazonPaapi,
        traffic:
          similarwebKey.trim() || dataforseoLogin.trim() || dataforseoPassword.trim()
            ? {
                similarwebKey: similarwebKey.trim() || undefined,
                dataforseoLogin: dataforseoLogin.trim() || undefined,
                dataforseoPassword: dataforseoPassword.trim() || undefined,
              }
            : undefined,
        keepaKey: keepaKey.trim() || undefined,
      });
      if (res.ok) {
        setMessage(t.ai.admin.settings.saved);
        if (apiKey.trim()) {
          setHasKey(true);
          setApiKey("");
        }
        if (amazonPaapi) {
          setHasAmazonPaapi(true);
          setAmazonAccessKey("");
          setAmazonSecretKey("");
          setAmazonPartnerTag("");
        }
        if (similarwebKey.trim()) {
          setHasSimilarweb(true);
          setSimilarwebKey("");
        }
        if (dataforseoLogin.trim() || dataforseoPassword.trim()) {
          setHasDataforseo(true);
          setDataforseoLogin("");
          setDataforseoPassword("");
        }
        if (keepaKey.trim()) {
          setHasKeepa(true);
          setKeepaKey("");
        }
      } else {
        setError(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <EntityPageHeader
        title={t.ai.admin.settings.title}
        description={t.ai.admin.settings.description}
      />

      <form
        onSubmit={onSubmit}
        className="mt-6 max-w-xl rounded-xl border border-ink/10 bg-white/70 p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink/80">
            {t.ai.admin.settings.preset}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              hasKey
                ? "bg-green-100 text-green-800"
                : "bg-ink/10 text-ink/60"
            }`}
          >
            {hasKey
              ? t.ai.admin.settings.configuredBadge
              : t.ai.admin.settings.notConfiguredBadge}
          </span>
        </div>
        <div className="mt-2 inline-flex rounded-lg bg-ink/5 p-1" role="group">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>)
            .concat()
            .map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  preset === p
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink/60 hover:text-ink"
                }`}
              >
                {t.ai.admin.settings.presets[p]}
              </button>
            ))}
          <button
            type="button"
            onClick={() => applyPreset("custom")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              preset === "custom"
                ? "bg-white text-ink shadow-sm"
                : "text-ink/60 hover:text-ink"
            }`}
          >
            {t.ai.admin.settings.presets.custom}
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className={labelClass} htmlFor="ai-base-url">
              {t.ai.admin.settings.baseUrl}
            </label>
            <input
              id="ai-base-url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setPreset("custom");
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ai-model">
              {t.ai.admin.settings.model}
            </label>
            <input
              id="ai-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setPreset("custom");
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ai-key">
              {t.ai.admin.settings.apiKey}
            </label>
            <input
              id="ai-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t.ai.admin.settings.apiKeyPlaceholder}
              autoComplete="off"
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-6 border-t border-ink/10 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">
              Amazon PA-API
            </h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                hasAmazonPaapi
                  ? "bg-green-100 text-green-800"
                  : "bg-ink/10 text-ink/60"
              }`}
            >
              {hasAmazonPaapi ? "已配置" : "未配置"}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink/55">
            用于 Amazon 自动选品。在 Amazon Associates 后台申请 PA-API 后填入。
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className={labelClass} htmlFor="amazon-access-key">
                Access Key
              </label>
              <input
                id="amazon-access-key"
                type="password"
                value={amazonAccessKey}
                onChange={(e) => setAmazonAccessKey(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="amazon-secret-key">
                Secret Key
              </label>
              <input
                id="amazon-secret-key"
                type="password"
                value={amazonSecretKey}
                onChange={(e) => setAmazonSecretKey(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="amazon-partner-tag">
                Partner Tag（联盟 ID）
              </label>
              <input
                id="amazon-partner-tag"
                value={amazonPartnerTag}
                onChange={(e) => setAmazonPartnerTag(e.target.value)}
                placeholder="例如 yourtag-20"
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="amazon-region">
                Region
              </label>
              <input
                id="amazon-region"
                value={amazonRegion}
                onChange={(e) => setAmazonRegion(e.target.value)}
                placeholder="us-east-1"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-ink/10 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">
              {t.ai.admin.settings.traffic.title}
            </h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                hasSimilarweb || hasDataforseo
                  ? "bg-green-100 text-green-800"
                  : "bg-ink/10 text-ink/60"
              }`}
            >
              {hasSimilarweb || hasDataforseo
                ? t.ai.admin.settings.configuredBadge
                : t.ai.admin.settings.notConfiguredBadge}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink/55">
            {t.ai.admin.settings.traffic.hint}
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className={labelClass} htmlFor="traffic-similarweb-key">
                {t.ai.admin.settings.traffic.similarwebKey}
              </label>
              <input
                id="traffic-similarweb-key"
                type="password"
                value={similarwebKey}
                onChange={(e) => setSimilarwebKey(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink/55">
                {t.ai.admin.settings.traffic.similarwebHelp}
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="traffic-dataforseo-login">
                {t.ai.admin.settings.traffic.dataforseoLogin}
              </label>
              <input
                id="traffic-dataforseo-login"
                value={dataforseoLogin}
                onChange={(e) => setDataforseoLogin(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="traffic-dataforseo-password">
                {t.ai.admin.settings.traffic.dataforseoPassword}
              </label>
              <input
                id="traffic-dataforseo-password"
                type="password"
                value={dataforseoPassword}
                onChange={(e) => setDataforseoPassword(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink/55">
                {t.ai.admin.settings.traffic.dataforseoHelp}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-ink/10 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">
              {t.ai.admin.settings.keepa.title}
            </h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                hasKeepa
                  ? "bg-green-100 text-green-800"
                  : "bg-ink/10 text-ink/60"
              }`}
            >
              {hasKeepa
                ? t.ai.admin.settings.configuredBadge
                : t.ai.admin.settings.notConfiguredBadge}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink/55">
            {t.ai.admin.settings.keepa.hint}
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className={labelClass} htmlFor="keepa-key">
                {t.ai.admin.settings.keepa.keyLabel}
              </label>
              <input
                id="keepa-key"
                type="password"
                value={keepaKey}
                onChange={(e) => setKeepaKey(e.target.value)}
                placeholder={t.ai.admin.settings.keepa.keyPlaceholder}
                autoComplete="off"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorState title={t.common.error.title} message={error} />
          </div>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {saving ? t.ai.admin.settings.saving : t.ai.admin.settings.save}
        </button>
        <button
          type="button"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            setTestResult(null);
            try {
              // 用当前表单值测试（key 为空则用已保存的 key），不用先点保存
              const res = await testAiConnectionAction({
                baseUrl: baseUrl.trim() || undefined,
                model: model.trim() || undefined,
                apiKey: apiKey.trim() || undefined,
              });
              setTestResult(
                res.ok ? res.data : { ok: false, stage: "config", message: res.error }
              );
            } finally {
              setTesting(false);
            }
          }}
          className="ml-2 mt-5 rounded-lg border border-ink/20 px-5 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
        >
          {testing ? t.ai.admin.settings.testing : t.ai.admin.settings.testConnection}
        </button>

        {testResult && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              testResult.ok
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {testResult.ok ? "✅" : "❌"} {testResult.message}
          </div>
        )}

        <p className="mt-5 text-xs text-ink/55">
          {t.ai.admin.settings.keyNote}
        </p>
        <p className="mt-1 text-xs text-ink/55">{t.ai.admin.settings.guide}</p>
      </form>
    </div>
  );
}
