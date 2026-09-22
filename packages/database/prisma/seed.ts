/**
 * Phase 1.3 Prisma seed — deterministic + idempotent (upsert by fixed IDs).
 *
 * Development only. Does NOT DROP DATABASE or TRUNCATE production tables.
 * Optional SEED_RESET=1 deletes only known fixture tenant rows before upsert
 * (still scoped to fixture tenant IDs — never a global wipe of unrelated data).
 *
 * Run: pnpm --filter @adlinklab/database seed
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  buildFixtureDataset,
  TenantA,
  TenantB,
} from "../src/fixtures/index.js";

const prisma = new PrismaClient();

async function resetFixtureTenantsOnly() {
  const tenantIds = [TenantA.id, TenantB.id];
  // Child tables first — scoped to fixture tenants only
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.syncJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.urlChangeRequest.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.urlVersion.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.conversion.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.click.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.trackingLinkOffer.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.trackingLink.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.landingPage.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.offer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.adGroupCriterion.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.ad.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.adGroup.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.campaign.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.googleAccount.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

async function upsertDataset() {
  const ds = buildFixtureDataset();

  for (const t of ds.tenants) {
    await prisma.tenant.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        createdAt: t.createdAt,
      },
      update: { name: t.name, slug: t.slug, status: t.status },
    });
  }

  for (const u of ds.users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        tenantId: u.tenantId,
        email: u.email,
        name: u.name,
        status: u.status,
        createdAt: u.createdAt,
      },
      update: {
        email: u.email,
        name: u.name,
        status: u.status,
      },
    });
  }

  for (const a of ds.googleAccounts) {
    await prisma.googleAccount.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        tenantId: a.tenantId,
        userId: a.userId,
        customerId: a.customerId,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        oauthCredentialRef: a.oauthCredentialRef,
        status: a.status,
        createdAt: a.createdAt,
      },
      update: {
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        oauthCredentialRef: a.oauthCredentialRef,
        status: a.status,
      },
    });
  }

  for (const c of ds.campaigns) {
    await prisma.campaign.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        tenantId: c.tenantId,
        googleAccountId: c.googleAccountId,
        googleCampaignId: c.googleCampaignId,
        name: c.name,
        status: c.status,
        createdAt: c.createdAt,
      },
      update: { name: c.name, status: c.status },
    });
  }

  for (const g of ds.adGroups) {
    await prisma.adGroup.upsert({
      where: { id: g.id },
      create: {
        id: g.id,
        tenantId: g.tenantId,
        campaignId: g.campaignId,
        googleAdGroupId: g.googleAdGroupId,
        name: g.name,
        status: g.status,
        createdAt: g.createdAt,
      },
      update: { name: g.name, status: g.status },
    });
  }

  for (const ad of ds.ads) {
    await prisma.ad.upsert({
      where: { id: ad.id },
      create: {
        id: ad.id,
        tenantId: ad.tenantId,
        adGroupId: ad.adGroupId,
        googleAdId: ad.googleAdId,
        name: ad.name,
        status: ad.status,
        createdAt: ad.createdAt,
      },
      update: { name: ad.name, status: ad.status },
    });
  }

  for (const crit of ds.adGroupCriteria) {
    await prisma.adGroupCriterion.upsert({
      where: { id: crit.id },
      create: {
        id: crit.id,
        tenantId: crit.tenantId,
        adGroupId: crit.adGroupId,
        googleCriterionId: crit.googleCriterionId,
        keyword: crit.keyword,
        matchType: crit.matchType,
        status: crit.status,
        createdAt: crit.createdAt,
      },
      update: {
        keyword: crit.keyword,
        matchType: crit.matchType,
        status: crit.status,
      },
    });
  }

  for (const o of ds.offers) {
    await prisma.offer.upsert({
      where: { id: o.id },
      create: {
        id: o.id,
        tenantId: o.tenantId,
        name: o.name,
        network: o.network,
        destinationUrl: o.destinationUrl,
        status: o.status,
        priority: o.priority,
        startsAt: o.startsAt ?? null,
        endsAt: o.endsAt ?? null,
        idempotencyScope: o.idempotencyScope ?? null,
        idempotencyKey: o.idempotencyKey ?? null,
        createdAt: o.createdAt,
      },
      update: {
        name: o.name,
        network: o.network,
        destinationUrl: o.destinationUrl,
        status: o.status,
        priority: o.priority,
        startsAt: o.startsAt ?? null,
        endsAt: o.endsAt ?? null,
        idempotencyScope: o.idempotencyScope ?? null,
        idempotencyKey: o.idempotencyKey ?? null,
      },
    });
  }

  for (const lp of ds.landingPages) {
    await prisma.landingPage.upsert({
      where: { id: lp.id },
      create: {
        id: lp.id,
        tenantId: lp.tenantId,
        offerId: lp.offerId,
        name: lp.name,
        url: lp.url,
        domain: lp.domain,
        status: lp.status,
        createdAt: lp.createdAt,
      },
      update: {
        name: lp.name,
        url: lp.url,
        domain: lp.domain,
        status: lp.status,
      },
    });
  }

  for (const tl of ds.trackingLinks) {
    await prisma.trackingLink.upsert({
      where: { id: tl.id },
      create: {
        id: tl.id,
        tenantId: tl.tenantId,
        publicId: tl.publicId,
        campaignId: tl.campaignId,
        adGroupId: tl.adGroupId,
        adId: tl.adId,
        criterionId: tl.criterionId,
        offerId: tl.offerId,
        landingPageId: tl.landingPageId,
        status: tl.status,
        createdAt: tl.createdAt,
      },
      update: {
        publicId: tl.publicId,
        campaignId: tl.campaignId,
        adGroupId: tl.adGroupId,
        adId: tl.adId,
        criterionId: tl.criterionId,
        offerId: tl.offerId,
        landingPageId: tl.landingPageId,
        status: tl.status,
      },
    });
  }

  for (const v of ds.urlVersions) {
    await prisma.urlVersion.upsert({
      where: { id: v.id },
      create: {
        id: v.id,
        tenantId: v.tenantId,
        entityType: v.entityType,
        entityId: v.entityId,
        finalUrl: v.finalUrl,
        finalMobileUrl: v.finalMobileUrl,
        finalAppUrl: v.finalAppUrl,
        trackingTemplate: v.trackingTemplate,
        customParameters: v.customParameters,
        version: v.version,
        status: v.status,
        effectiveAt: v.effectiveAt,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
      },
      update: {
        // Content append-only: do not rewrite finalUrl on seed re-run
        status: v.status,
        effectiveAt: v.effectiveAt,
      },
    });
  }

  for (const c of ds.clicks) {
    await prisma.click.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        clickId: c.clickId,
        tenantId: c.tenantId,
        trackingLinkId: c.trackingLinkId,
        offerId: c.offerId,
        landingPageId: c.landingPageId,
        campaignId: c.campaignId,
        adGroupId: c.adGroupId,
        adId: c.adId,
        criterionId: c.criterionId,
        gclid: c.gclid,
        utmSource: c.utmSource,
        utmMedium: c.utmMedium,
        utmCampaign: c.utmCampaign,
        userAgent: c.userAgent,
        ipAddress: c.ipAddress,
        referer: c.referer,
        country: c.country,
        deviceType: c.deviceType,
        queryParameters: c.queryParameters ?? undefined,
        ingestionId: c.ingestionId,
        occurredAt: c.occurredAt,
        createdAt: c.createdAt,
      },
      update: {
        clickId: c.clickId,
        offerId: c.offerId,
        landingPageId: c.landingPageId,
        campaignId: c.campaignId,
        adGroupId: c.adGroupId,
        adId: c.adId,
        criterionId: c.criterionId,
        gclid: c.gclid,
        userAgent: c.userAgent,
        ipAddress: c.ipAddress,
        occurredAt: c.occurredAt,
      },
    });
  }

  for (const c of ds.conversions) {
    await prisma.conversion.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        tenantId: c.tenantId,
        clickId: c.clickId,
        conversionAction: c.conversionAction,
        conversionTime: c.conversionTime,
        value: c.value ? new Prisma.Decimal(c.value) : null,
        currency: c.currency,
        status: c.status,
        googleUploadStatus: c.googleUploadStatus,
        idempotencyScope: c.idempotencyScope,
        idempotencyKey: c.idempotencyKey,
        createdAt: c.createdAt,
      },
      update: {
        status: c.status,
        value: c.value ? new Prisma.Decimal(c.value) : null,
        currency: c.currency,
      },
    });
  }

  for (const o of ds.orders) {
    await prisma.order.upsert({
      where: { id: o.id },
      create: {
        id: o.id,
        tenantId: o.tenantId,
        orderId: o.orderId,
        clickId: o.clickId,
        conversionId: o.conversionId,
        value: new Prisma.Decimal(o.value),
        currency: o.currency,
        status: o.status,
        idempotencyScope: o.idempotencyScope,
        idempotencyKey: o.idempotencyKey,
        createdAt: o.createdAt,
      },
      update: {
        status: o.status,
        value: new Prisma.Decimal(o.value),
        currency: o.currency,
      },
    });
  }

  for (const r of ds.urlChangeRequests) {
    await prisma.urlChangeRequest.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        tenantId: r.tenantId,
        entityType: r.entityType,
        entityId: r.entityId,
        fromVersionId: r.fromVersionId,
        toVersionId: r.toVersionId,
        reason: r.reason,
        requestedBy: r.requestedBy,
        status: r.status,
        idempotencyScope: r.idempotencyScope,
        idempotencyKey: r.idempotencyKey,
        jobId: r.jobId,
        scheduledAt: r.scheduledAt,
        executedAt: r.executedAt,
        error: r.error,
        createdAt: r.createdAt,
      },
      update: {
        status: r.status,
        error: r.error,
        jobId: r.jobId,
      },
    });
  }

  for (const j of ds.syncJobs) {
    await prisma.syncJob.upsert({
      where: { id: j.id },
      create: {
        id: j.id,
        tenantId: j.tenantId!,
        type: j.type,
        status: j.status as
          | "PENDING"
          | "RUNNING"
          | "COMPLETED"
          | "FAILED"
          | "CANCELLED",
        provider: j.provider,
        externalAccountId: j.externalAccountId,
        idempotencyScope: j.idempotencyScope,
        idempotencyKey: j.idempotencyKey,
        jobId: j.jobId,
        attempts: j.attempts,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        error: j.error,
        createdAt: j.createdAt,
      },
      update: {
        status: j.status as
          | "PENDING"
          | "RUNNING"
          | "COMPLETED"
          | "FAILED"
          | "CANCELLED",
        attempts: j.attempts,
        error: j.error,
      },
    });
  }

  for (const a of ds.auditLogs) {
    await prisma.auditLog.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        tenantId: a.tenantId,
        actorId: a.actorId,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        before: a.before ?? undefined,
        after: a.after ?? undefined,
        requestId: a.requestId,
        jobId: a.jobId,
        createdAt: a.createdAt,
      },
      update: {
        // append-only semantics: do not mutate historical payload on re-seed
        action: a.action,
      },
    });
  }

  return ds;
}

async function main() {
  if (process.env.SEED_RESET === "1") {
    console.log(
      "SEED_RESET=1 — deleting fixture tenants only (not a production wipe)"
    );
    await resetFixtureTenantsOnly();
  }

  const ds = await upsertDataset();
  console.log("Phase 1.3 seed complete:", {
    tenants: ds.tenants.length,
    campaigns: ds.campaigns.filter((c) => c.tenantId === TenantA.id).length,
    ads: ds.ads.filter((a) => a.tenantId === TenantA.id).length,
    offers: ds.offers.filter((o) => o.tenantId === TenantA.id).length,
    trackingLinks: ds.trackingLinks.filter((t) => t.tenantId === TenantA.id)
      .length,
    orders: ds.orders.filter((o) => o.tenantId === TenantA.id).length,
    urlChangeRequests: ds.urlChangeRequests.length,
    syncJobs: ds.syncJobs.length,
    mode: process.env.SEED_RESET === "1" ? "reset+upsert" : "idempotent-upsert",
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
