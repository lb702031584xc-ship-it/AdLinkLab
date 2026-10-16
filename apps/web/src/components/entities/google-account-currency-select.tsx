"use client";

/**
 * Google Ads 账户结算货币下拉（账户列表操作列）。
 * 切换时调 updateGoogleAccountCurrencyAction，成功后 router.refresh() 重载列表；
 * 失败时恢复旧值并显示服务端错误。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateGoogleAccountCurrencyAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

export function GoogleAccountCurrencySelect({
  accountId,
  currency,
}: {
  accountId: string;
  currency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(currency);
  const { t } = useI18n();

  // 选项至少含 USD、CNY 和当前货币（去重；老数据可能是其他货币）。
  const options = Array.from(new Set(["USD", "CNY", value.toUpperCase()]));

  function onChange(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    start(async () => {
      const result = await updateGoogleAccountCurrencyAction(accountId, next);
      if (result.ok) {
        router.refresh();
      } else {
        setValue(prev);
        setError(result.error);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t.entities.googleAccounts.columns.currency}
        className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </span>
  );
}
