import {
  entityApi,
  type Click,
  type TrackingLink,
  type TrackingLinkOfferBinding,
} from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import {
  DataTable,
  DetailList,
  EntityPageHeader,
  ErrorState,
  SectionTitle,
  StatusBadge,
  type Column,
} from "@/components/entities/ui";
import { OfferSelectionTest } from "@/components/entities/offer-selection-test";
import { TestClickChain } from "@/components/entities/test-click-chain";
import {
  BindingForm,
  type BindingInput,
} from "@/components/entities/binding-form";
import {
  LinkSwapPanel,
  type LinkSwapAccount,
} from "@/components/entities/link-swap-form";
import { HealthConfigPanel } from "@/components/entities/health-config-panel";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

const monoClassName = "font-mono text-[13px]";

export default async function TrackingLinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getDictionary(lang);
  const d = t.entities.trackingLinks.detail;

  const bindingColumns: Array<Column<TrackingLinkOfferBinding>> = [
    {
      header: d.bindingColumns.offerId,
      render: (b) => (
        <span className={`${monoClassName} break-all`} title={b.offerId}>
          {b.offerId}
        </span>
      ),
    },
    { header: d.bindingColumns.priority, render: (b) => String(b.priority) },
    {
      header: d.bindingColumns.fallback,
      render: (b) =>
        b.isFallback ? (
          <StatusBadge value="FALLBACK" />
        ) : (
          <span className="text-sm text-ink/50">—</span>
        ),
    },
  ];

  const clickColumns: Array<Column<Click>> = [
    {
      header: d.clickColumns.clickId,
      render: (c) => (
        <span className={monoClassName} title={c.clickId}>
          {truncate(c.clickId, 24)}
        </span>
      ),
    },
    {
      header: d.clickColumns.gclid,
      render: (c) =>
        c.gclid ? (
          <span className={monoClassName} title={c.gclid}>
            {truncate(c.gclid, 24)}
          </span>
        ) : (
          <span className="text-sm text-ink/50">—</span>
        ),
    },
    { header: d.clickColumns.utmSource, render: (c) => c.utmSource ?? "—" },
    { header: d.clickColumns.country, render: (c) => c.country ?? "—" },
    {
      header: d.clickColumns.occurred,
      render: (c) => formatDateTime(c.occurredAt),
      className: "whitespace-nowrap",
    },
  ];

  let link: TrackingLink | null = null;
  let bindings: TrackingLinkOfferBinding[] = [];
  let clicks: Click[] = [];
  let accounts: LinkSwapAccount[] = [];
  let error: string | null = null;
  try {
    const [l, b, c] = await Promise.all([
      entityApi.trackingLinks.get(id),
      entityApi.trackingLinks.listBindings(id),
      entityApi.trackingLinks.listClicks(id, 1, 10),
    ]);
    link = l;
    // API returns a bare array for bindings
    bindings = Array.isArray(b) ? b : [];
    clicks = c.items;
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }
  // Google Ads accounts for the link-swap panel (non-fatal on failure).
  try {
    const page = await entityApi.googleAccounts.list(1, 100);
    accounts = page.items.map((a) => ({
      id: a.id,
      name: a.name,
      customerId: a.customerId,
    }));
  } catch {
    accounts = [];
  }

  if (error || !link) {
    return (
      <div className="mx-auto max-w-5xl">
        <EntityPageHeader title={d.title} description={d.description} />
        <ErrorState
          message={error ?? d.notFound}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const bindingInputs: BindingInput[] = bindings.map((b) => ({
    offerId: b.offerId,
    priority: b.priority,
    isFallback: b.isFallback,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <EntityPageHeader title={link.publicId} description={d.headerDescription} />
      <DetailList
        items={[
          { label: d.labels.publicId, value: link.publicId, mono: true },
          { label: d.labels.offerId, value: link.offerId, mono: true },
          { label: d.labels.campaignId, value: link.campaignId ?? "—", mono: true },
          { label: d.labels.adGroupId, value: link.adGroupId ?? "—", mono: true },
          { label: d.labels.adId, value: link.adId ?? "—", mono: true },
          {
            label: d.labels.criterionId,
            value: link.criterionId ?? "—",
            mono: true,
          },
          {
            label: d.labels.landingPageId,
            value: link.landingPageId ?? "—",
            mono: true,
          },
          {
            label: t.common.misc.status,
            value: <StatusBadge value={link.status} />,
          },
          { label: t.common.misc.created, value: formatDateTime(link.createdAt) },
          { label: t.common.misc.updated, value: formatDateTime(link.updatedAt) },
        ]}
      />
      <OfferSelectionTest trackingLinkId={link.id} />
      <TestClickChain trackingLinkId={link.id} />
      <div className="mt-6">
        <HealthConfigPanel
          trackingLinkId={link.id}
          initialIntervalSec={link.healthCheckIntervalSec ?? 3600}
          initialSource={link.linkSource ?? "MANUAL"}
        />
      </div>
      <SectionTitle>{d.bindingsTitle}</SectionTitle>
      <DataTable<TrackingLinkOfferBinding>
        columns={bindingColumns}
        rows={bindings}
        emptyText={d.bindingsEmpty}
      />
      <BindingForm trackingLinkId={link.id} bindings={bindingInputs} />
      <LinkSwapPanel trackingLinkId={link.id} accounts={accounts} />
      <SectionTitle>{d.clicksTitle}</SectionTitle>
      <DataTable<Click>
        columns={clickColumns}
        rows={clicks}
        rowHref={(c) => `/clicks/${c.clickId}`}
        emptyText={d.clicksEmpty}
      />
    </div>
  );
}
