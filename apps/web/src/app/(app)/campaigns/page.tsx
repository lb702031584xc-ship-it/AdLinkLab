import { entityApi, type Campaign } from "@/lib/api/entities";
import { mapEntityErrorMessage } from "@/lib/api/entities-config";
import {
  EntityPageHeader,
  ErrorState,
  Pagination,
  paginationLabels,
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  zh as campaignToggleZh,
  en as campaignToggleEn,
} from "@/i18n/dict/campaign-toggle";
import { zh as cardsZh, en as cardsEn } from "@/i18n/dict/campaign-cards";
import { getCampaignStatsAction } from "@/lib/api/campaigns-actions";
import { CampaignCards } from "./_components/campaign-cards";
import type { CampaignToggleStrings } from "./_components/campaign-toggle-button";

export const dynamic = "force-dynamic";

/**
 * Build serializable toggle strings for one campaign.
 * `confirmBody` is a *function* in the i18n dict; RSC cannot serialize
 * functions into Client Component props, so it is resolved here on the
 * server (this was the "Application error: a server-side exception" on
 * /campaigns).
 */
function toggleStringsFor(
  c: Campaign,
  tt: typeof campaignToggleZh
): CampaignToggleStrings {
  const action = c.status === "PAUSED" ? "ENABLE" : "PAUSE";
  const { confirmBody, ...rest } = tt.toggle;
  return {
    ...rest,
    confirmBody: confirmBody(
      c.name,
      tt.toggle[action === "ENABLE" ? "enable" : "pause"]
    ),
  };
}

function parsePageParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page, 1);
  const pageSize = parsePageParam(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);
  const cards = lang === "en" ? cardsEn : cardsZh;
  const tt = lang === "en" ? campaignToggleEn : campaignToggleZh;

  let result;
  try {
    result = await entityApi.campaigns.list(page, pageSize);
  } catch (e) {
    // redirect() throws NEXT_REDIRECT — never swallow it, or the login
    // redirect breaks and the user sees a raw "NEXT_REDIRECT" error state.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.campaigns}
          description={t.entities.campaigns.description}
        />
        <ErrorState
          message={mapEntityErrorMessage(e, lang)}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const campaigns = result.items as Campaign[];
  const stats = await getCampaignStatsAction(campaigns.map((c) => c.id));
  const toggles: Record<string, CampaignToggleStrings> = {};
  for (const c of campaigns) toggles[c.id] = toggleStringsFor(c, tt);

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.campaigns}
        description={t.entities.campaigns.description}
      />
      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-ink/60">{t.entities.campaigns.empty}</p>
        </div>
      ) : (
        <>
          <CampaignCards
            campaigns={campaigns}
            stats={stats}
            t={cards}
            toggleStrings={toggles}
          />
          <div className="mt-5">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={result.total}
              basePath="/campaigns"
              labels={paginationLabels(t)}
            />
          </div>
        </>
      )}
      {/* 下一步：广告跑起来后做归因和监控 */}
      <div className="mt-4 rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
        <p className="text-sm font-semibold text-ink">🚀 {t.entities.campaigns.nextTitle}</p>
        <p className="mt-1 text-xs text-ink/55">{t.entities.campaigns.nextHint}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href="/tracking-links"
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            🔗 {t.entities.campaigns.toTracking} →
          </a>
          <a
            href="/monitoring"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            📊 {t.entities.campaigns.toMonitoring} →
          </a>
        </div>
      </div>
    </div>
  );
}
