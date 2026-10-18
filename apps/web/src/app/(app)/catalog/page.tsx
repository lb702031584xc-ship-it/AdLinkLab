import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { zh as catalogZh, en as catalogEn } from "@/i18n/dict/catalog";
import { getCurrentUser } from "@/lib/api/auth";
import {
  getScreeningPresetAction,
  listCatalogNetworksAction,
} from "@/lib/api/catalog-actions";
import { CatalogClient } from "@/components/catalog/catalog-client";

export const dynamic = "force-dynamic";

/** 商品库 — PartnerBoost / YeahPromos product catalog. */
export default async function CatalogPage() {
  const lang = await getLang();
  const t = getDictionary(lang);
  const d = lang === "en" ? catalogEn : catalogZh;

  const user = await getCurrentUser();
  // "owner" not yet in the AuthUser type — admin gate covers both for now.
  const isAdmin = user?.role === "admin" || (user?.role as string) === "owner";

  const [netRes, presetRes] = await Promise.all([
    listCatalogNetworksAction(),
    getScreeningPresetAction(),
  ]);

  if (!netRes.ok) {
    return (
      <div>
        <EntityPageHeader
          title={d.page.title}
          description={d.page.description}
        />
        <ErrorState title={t.common.error.title} message={netRes.error} />
      </div>
    );
  }

  const preset = presetRes.ok ? presetRes.data.preset : null;

  return (
    <CatalogClient
      initialNetworks={netRes.data}
      initialPreset={preset}
      isAdmin={isAdmin}
    />
  );
}
