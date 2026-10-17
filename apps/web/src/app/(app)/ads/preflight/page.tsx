import { PreflightClient } from "@/components/ai/preflight-client";
import { getDictionary } from "@/i18n/dictionaries";
import { getLang } from "@/i18n/lang";

export const dynamic = "force-dynamic";

/** P1-14：Preflight 双类型上线前检查页。 */
export default async function PreflightPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = getDictionary(lang);
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{t.adsAuto.preflight.title}</h1>
      <div className="mt-4">
        <PreflightClient dict={t.adsAuto} initialAccountId={sp.accountId} />
      </div>
    </div>
  );
}
