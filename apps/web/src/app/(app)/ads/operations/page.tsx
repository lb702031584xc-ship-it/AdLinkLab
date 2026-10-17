import { AdsOperationsClient } from "@/components/ai/ads-operations-client";
import { getDictionary } from "@/i18n/dictionaries";
import { getLang } from "@/i18n/lang";

export const dynamic = "force-dynamic";

/** P1-16：批量操作审计 + 回滚页。 */
export default async function AdsOperationsPage() {
  const lang = await getLang();
  const t = getDictionary(lang);
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{t.adsAuto.operations.title}</h1>
      <div className="mt-4">
        <AdsOperationsClient dict={t.adsAuto} />
      </div>
    </div>
  );
}
