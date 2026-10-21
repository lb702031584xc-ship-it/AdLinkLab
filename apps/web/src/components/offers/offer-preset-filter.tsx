"use client";

/**
 * P1-30：商品筛选预设栏（客户端表单，GET 提交走 URL 参数，服务端过滤）。
 * 阈值全部来自用户输入或默认预设；默认预设为讲师经验，非普适真理。
 */
export interface OfferPresetFilterDict {
  title: string;
  note: string;
  preset: string;
  apply: string;
  clear: string;
  minReviews: string;
  minCommission: string;
  minRate: string;
  minPrice: string;
  maxPrice: string;
  minScore: string;
  defaults: string;
}

export interface OfferPresetFilterValues {
  minReviews: string;
  minCommission: string;
  minRate: string;
  minPrice: string;
  maxPrice: string;
  minScore: string;
}

export function OfferPresetFilterBar({
  dict,
  tab,
  values,
}: {
  dict: OfferPresetFilterDict;
  tab: string;
  values: OfferPresetFilterValues;
}) {
  const inputClass =
    "w-24 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink";
  const labelClass = "flex items-center gap-1.5 text-xs text-ink/70";
  const presetHref = `/offers?tab=${encodeURIComponent(tab)}&preset=1&minCommission=10&minRate=10&minPrice=80`;
  const clearHref = `/offers?tab=${encodeURIComponent(tab)}`;
  return (
    <form
      method="get"
      action="/offers"
      className="mt-4 rounded-xl border border-ink/10 bg-ink/[0.02] p-3"
    >
      <input type="hidden" name="tab" value={tab} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-ink">{dict.title}</span>
        <label className={labelClass}>
          {dict.minReviews}
          <input type="number" name="minReviews" min="0" className={inputClass} defaultValue={values.minReviews} />
        </label>
        <label className={labelClass}>
          {dict.minCommission}
          <input type="number" name="minCommission" min="0" step="0.01" className={inputClass} defaultValue={values.minCommission} />
        </label>
        <label className={labelClass}>
          {dict.minRate}
          <input type="number" name="minRate" min="0" max="100" step="0.1" className={inputClass} defaultValue={values.minRate} />
        </label>
        <label className={labelClass}>
          {dict.minPrice}
          <input type="number" name="minPrice" min="0" step="0.01" className={inputClass} defaultValue={values.minPrice} />
        </label>
        <label className={labelClass}>
          {dict.maxPrice}
          <input type="number" name="maxPrice" min="0" step="0.01" className={inputClass} defaultValue={values.maxPrice} />
        </label>
        <label className={labelClass}>
          {dict.minScore}
          <input type="number" name="minScore" min="0" max="100" step="1" className={inputClass} defaultValue={values.minScore} />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90"
        >
          {dict.apply}
        </button>
        <a href={presetHref} className="text-sm text-signal hover:underline">
          {dict.preset}
        </a>
        <a href={clearHref} className="text-sm text-ink/60 hover:underline">
          {dict.clear}
        </a>
      </div>
      <p className="mt-2 text-xs text-ink/60">
        {dict.note} {dict.defaults}
      </p>
    </form>
  );
}
