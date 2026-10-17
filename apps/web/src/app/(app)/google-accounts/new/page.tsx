"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGoogleAccountAction } from "@/lib/api/entity-actions";
import { EntityPageHeader } from "@/components/entities/ui";

export default function NewGoogleAccountPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  /** P1-7：账号类型必填，创建后不可变更。 */
  const [accountType, setAccountType] = useState<"MCC" | "PERSONAL">("MCC");
  const [managerCustomerId, setManagerCustomerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";

  const CURRENCIES = [
    { code: "USD", label: "美元 USD" },
    { code: "CNY", label: "人民币 CNY" },
    { code: "EUR", label: "欧元 EUR" },
    { code: "GBP", label: "英镑 GBP" },
    { code: "JPY", label: "日元 JPY" },
    { code: "HKD", label: "港币 HKD" },
    { code: "AUD", label: "澳元 AUD" },
    { code: "CAD", label: "加元 CAD" },
    { code: "SGD", label: "新元 SGD" },
    { code: "KRW", label: "韩元 KRW" },
  ];

  const TIMEZONES = [
    { value: "America/Los_Angeles", label: "洛杉矶 (UTC-8)" },
    { value: "America/New_York", label: "纽约 (UTC-5)" },
    { value: "Asia/Shanghai", label: "上海 (UTC+8)" },
    { value: "Asia/Hong_Kong", label: "香港 (UTC+8)" },
    { value: "Europe/London", label: "伦敦 (UTC+0)" },
    { value: "Europe/Berlin", label: "柏林 (UTC+1)" },
    { value: "Asia/Tokyo", label: "东京 (UTC+9)" },
    { value: "Australia/Sydney", label: "悉尼 (UTC+11)" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !customerId.trim()) {
      setError("名称和客户 ID 为必填项");
      return;
    }
    setSaving(true);
    try {
      const result = await createGoogleAccountAction({
        name: name.trim(),
        customerId: customerId.trim(),
        currency: currency.trim() || "USD",
        timezone: timezone.trim() || "America/Los_Angeles",
        accountType,
        managerCustomerId: managerCustomerId.trim() || undefined,
      });
      if (result.ok) {
        router.push("/google-accounts");
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <EntityPageHeader
        title="新建 Google 账户"
        description="添加你的 Google Ads 账户，客户 ID 为 10 位数字（不带横杠）"
      />
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            名称 *
          </label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：我的美国账户"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            客户 ID *
          </label>
          <input
            className={inputClass}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="如：1234567890（谷歌广告后台右上角，不带横杠）"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            账号类型 *（创建后不可变更，变更需删除后重建）
          </label>
          <select
            className={inputClass}
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as "MCC" | "PERSONAL")}
          >
            <option value="MCC">MCC（经理账号，可管理多个子账号）</option>
            <option value="PERSONAL">个人（单个广告账号，仅支持单账号操作）</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            上级 MCC 客户 ID（可选，子账号填）
          </label>
          <input
            className={inputClass}
            value={managerCustomerId}
            onChange={(e) => setManagerCustomerId(e.target.value)}
            placeholder="如：1234567890（不带横杠；MCC 本身留空）"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">
              货币
            </label>
            <select
              className={inputClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">
              时区
            </label>
            <select
              className={inputClass}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-ink px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "创建"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/google-accounts")}
            className="rounded-lg border border-ink/15 px-6 py-2 text-sm text-ink/70"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
