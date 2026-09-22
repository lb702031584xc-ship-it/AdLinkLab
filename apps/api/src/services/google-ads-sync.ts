import { randomUUID } from "node:crypto";
import type {
  GoogleAccountRepository,
  SyncJob,
  TransactionContext,
  UnitOfWork,
} from "@adlinklab/domain";
import { AuditActions, assertSameTenant } from "@adlinklab/domain";
import type { GoogleAdsProvider } from "@adlinklab/google-ads";
import {
  classifyGoogleAdsError,
  GoogleAdsProviderError,
} from "@adlinklab/google-ads";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createIdempotencyKey,
} from "@adlinklab/shared";
import {
  mapAdFromGoogle,
  mapAdGroupFromGoogle,
  mapCampaignFromGoogle,
  mapCriterionFromGoogle,
} from "./google-ads-mappers.js";

const SYNC_JOB_SCOPE = "SYNC_JOB";
const SYNC_TYPE = "googleAdsSync";

export interface GoogleAdsSyncSummary {
  campaignsCreated: number;
  campaignsUpdated: number;
  adGroupsCreated: number;
  adGroupsUpdated: number;
  adsCreated: number;
  adsUpdated: number;
  criteriaCreated: number;
  criteriaUpdated: number;
  startedAt: string;
  completedAt: string;
}

export interface GoogleAdsSyncResult {
  job: SyncJob;
  summary: GoogleAdsSyncSummary | null;
  created: boolean;
  replayed: boolean;
}

export interface GoogleAdsSyncInput {
  tenantId: string;
  googleAccountId: string;
  idempotencyKey?: string;
  /** Optional filter of Google external campaign IDs */
  campaignIds?: string[];
  requestId?: string;
}

/**
 * Phase 3 — sync Google Ads hierarchy into local DB.
 * Provider network I/O is always outside DB transactions.
 */
export class GoogleAdsSyncService {
  constructor(
    private readonly googleAccounts: GoogleAccountRepository,
    private readonly provider: GoogleAdsProvider,
    private readonly unitOfWork: UnitOfWork
  ) {}

  async sync(input: GoogleAdsSyncInput): Promise<GoogleAdsSyncResult> {
    const account = await this.googleAccounts.findByIdForTenant(
      input.tenantId,
      input.googleAccountId
    );
    if (!account) {
      throw new NotFoundError("GoogleAccount", input.googleAccountId);
    }
    assertSameTenant(input.tenantId, account.tenantId, "GoogleAccount");

    if (account.status === "DISABLED" || account.status === "ARCHIVED") {
      throw new ValidationError("GoogleAccount is not syncable", {
        status: account.status,
        googleAccountId: account.id,
      });
    }

    const customerId = account.customerId ?? account.googleCustomerId;
    if (!customerId) {
      throw new ValidationError("GoogleAccount missing customerId");
    }

    const idempotencyKey =
      input.idempotencyKey ??
      createIdempotencyKey(
        SYNC_TYPE,
        input.tenantId,
        input.googleAccountId,
        input.campaignIds?.join(",") ?? "all"
      );

    const acquired = await this.acquireRunningJob({
      tenantId: input.tenantId,
      googleAccountId: input.googleAccountId,
      customerId,
      idempotencyKey,
      campaignIds: input.campaignIds,
    });

    if (!acquired.owner) {
      return {
        job: acquired.job,
        summary: (acquired.job.payload?.summary as GoogleAdsSyncSummary) ?? null,
        created: false,
        replayed: true,
      };
    }

    let job = acquired.job;
    const startedAt = new Date();
    await this.unitOfWork.transaction(async (ctx) => {
      await this.writeAudit(ctx, {
        tenantId: input.tenantId,
        action: AuditActions.SYNC_STARTED,
        entityId: job.id,
        requestId: input.requestId,
        after: {
          googleAccountId: input.googleAccountId,
          customerId,
          idempotencyKey,
        },
      });
    });

    try {
      // Provider I/O — outside DB transaction
      await this.provider.getCustomer(customerId);
      let campaigns = await this.provider.listCampaigns(customerId);
      if (input.campaignIds?.length) {
        const allow = new Set(input.campaignIds);
        campaigns = campaigns.filter((c) => allow.has(c.campaignId));
      }

      const tree: Array<{
        campaign: (typeof campaigns)[number];
        adGroups: Awaited<ReturnType<GoogleAdsProvider["listAdGroups"]>>;
        ads: Awaited<ReturnType<GoogleAdsProvider["listAds"]>>;
        criteria: Awaited<
          ReturnType<GoogleAdsProvider["listAdGroupCriteria"]>
        >;
      }> = [];

      for (const campaign of campaigns) {
        const adGroups = await this.provider.listAdGroups(campaign.campaignId);
        const ads = [];
        const criteria = [];
        for (const ag of adGroups) {
          ads.push(...(await this.provider.listAds(ag.adGroupId)));
          criteria.push(
            ...(await this.provider.listAdGroupCriteria(ag.adGroupId))
          );
        }
        tree.push({ campaign, adGroups, ads, criteria });
      }

      const summary = await this.unitOfWork.transaction(async (ctx) => {
        const counts: GoogleAdsSyncSummary = {
          campaignsCreated: 0,
          campaignsUpdated: 0,
          adGroupsCreated: 0,
          adGroupsUpdated: 0,
          adsCreated: 0,
          adsUpdated: 0,
          criteriaCreated: 0,
          criteriaUpdated: 0,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
        };

        for (const node of tree) {
          const campaignRow = await this.upsertCampaign(
            ctx,
            input.tenantId,
            account.id,
            node.campaign,
            counts
          );

          for (const ag of node.adGroups) {
            const adGroupRow = await this.upsertAdGroup(
              ctx,
              input.tenantId,
              campaignRow.id,
              ag,
              counts
            );

            for (const ad of node.ads.filter(
              (a) => a.adGroupId === ag.adGroupId
            )) {
              await this.upsertAd(ctx, input.tenantId, adGroupRow.id, ad, counts);
            }

            for (const crit of node.criteria.filter(
              (c) => c.adGroupId === ag.adGroupId
            )) {
              await this.upsertCriterion(
                ctx,
                input.tenantId,
                adGroupRow.id,
                crit,
                counts
              );
            }
          }
        }

        counts.completedAt = new Date().toISOString();

        job = await ctx.syncJobs.update(job.id, {
          status: "COMPLETED",
          completedAt: new Date(),
          error: undefined,
          errorMessage: undefined,
          payload: {
            ...(job.payload ?? {}),
            summary: counts,
          },
        });

        await this.writeAudit(ctx, {
          tenantId: input.tenantId,
          action: AuditActions.SYNC_COMPLETED,
          entityId: job.id,
          requestId: input.requestId,
          after: { summary: counts },
        });

        return counts;
      });

      return { job, summary, created: acquired.created, replayed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const classified = classifyGoogleAdsError(error);
      await this.unitOfWork.transaction(async (ctx) => {
        job = await ctx.syncJobs.update(job.id, {
          status: "FAILED",
          error: message,
          errorMessage: message,
          completedAt: new Date(),
          payload: {
            ...(job.payload ?? {}),
            errorCode:
              error instanceof GoogleAdsProviderError
                ? error.googleCode
                : classified.code,
            retryable: classified.retryable,
          },
        });
        await this.writeAudit(ctx, {
          tenantId: input.tenantId,
          action: AuditActions.SYNC_FAILED,
          entityId: job.id,
          requestId: input.requestId,
          after: {
            error: message,
            retryable: classified.retryable,
          },
        });
      });
      throw error;
    }
  }

  private async acquireRunningJob(input: {
    tenantId: string;
    googleAccountId: string;
    customerId: string;
    idempotencyKey: string;
    campaignIds?: string[];
  }): Promise<{ job: SyncJob; owner: boolean; created: boolean }> {
    return this.unitOfWork.transaction(async (ctx) => {
      const existing = await ctx.syncJobs.findByIdempotencyKey(
        input.tenantId,
        SYNC_JOB_SCOPE,
        input.idempotencyKey
      );
      if (existing) {
        const status = existing.status.toUpperCase();
        if (status === "COMPLETED" || status === "RUNNING") {
          return { job: existing, owner: false, created: false };
        }
        const job = await ctx.syncJobs.update(existing.id, {
          status: "RUNNING",
          attempts: existing.attempts + 1,
          startedAt: new Date(),
          error: undefined,
          errorMessage: undefined,
          externalAccountId: input.customerId,
        });
        return { job, owner: true, created: false };
      }

      try {
        const job = await ctx.syncJobs.create({
          id: randomUUID(),
          tenantId: input.tenantId,
          type: SYNC_TYPE,
          status: "RUNNING",
          provider: "mock",
          externalAccountId: input.customerId,
          idempotencyScope: SYNC_JOB_SCOPE,
          idempotencyKey: input.idempotencyKey,
          jobId: `googleAdsSync:${input.googleAccountId}:${input.idempotencyKey}`,
          attempts: 1,
          startedAt: new Date(),
          payload: {
            tenantId: input.tenantId,
            googleAccountId: input.googleAccountId,
            campaignIds: input.campaignIds,
          },
        });
        return { job, owner: true, created: true };
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        const raced = await ctx.syncJobs.findByIdempotencyKey(
          input.tenantId,
          SYNC_JOB_SCOPE,
          input.idempotencyKey
        );
        if (!raced) throw error;
        return { job: raced, owner: false, created: false };
      }
    });
  }

  private async upsertCampaign(
    ctx: TransactionContext,
    tenantId: string,
    googleAccountId: string,
    dto: Parameters<typeof mapCampaignFromGoogle>[0],
    counts: GoogleAdsSyncSummary
  ) {
    const listed = await ctx.campaigns.list({
      googleAccountId,
      tenantId,
      pageSize: 500,
    });
    const existing = listed.items.find(
      (c) => c.googleCampaignId === dto.campaignId
    );
    if (existing) {
      assertSameTenant(tenantId, existing.tenantId, "Campaign");
      counts.campaignsUpdated += 1;
      return ctx.campaigns.update(existing.id, {
        name: dto.name,
        status: mapCampaignFromGoogle(dto, {
          id: existing.id,
          tenantId,
          googleAccountId,
        }).status,
      });
    }
    counts.campaignsCreated += 1;
    try {
      return await ctx.campaigns.create(
        mapCampaignFromGoogle(dto, {
          id: randomUUID(),
          tenantId,
          googleAccountId,
        })
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = (
        await ctx.campaigns.list({ googleAccountId, tenantId, pageSize: 500 })
      ).items.find((c) => c.googleCampaignId === dto.campaignId);
      if (!raced) throw error;
      counts.campaignsCreated -= 1;
      counts.campaignsUpdated += 1;
      return ctx.campaigns.update(raced.id, {
        name: dto.name,
        status: mapCampaignFromGoogle(dto, {
          id: raced.id,
          tenantId,
          googleAccountId,
        }).status,
      });
    }
  }

  private async upsertAdGroup(
    ctx: TransactionContext,
    tenantId: string,
    campaignId: string,
    dto: Parameters<typeof mapAdGroupFromGoogle>[0],
    counts: GoogleAdsSyncSummary
  ) {
    const listed = await ctx.adGroups.list({
      campaignId,
      tenantId,
      pageSize: 500,
    });
    const existing = listed.items.find(
      (g) => g.googleAdGroupId === dto.adGroupId
    );
    if (existing) {
      assertSameTenant(tenantId, existing.tenantId, "AdGroup");
      counts.adGroupsUpdated += 1;
      return ctx.adGroups.update(existing.id, {
        name: dto.name,
        status: mapAdGroupFromGoogle(dto, {
          id: existing.id,
          tenantId,
          campaignId,
        }).status,
      });
    }
    counts.adGroupsCreated += 1;
    try {
      return await ctx.adGroups.create(
        mapAdGroupFromGoogle(dto, {
          id: randomUUID(),
          tenantId,
          campaignId,
        })
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = (
        await ctx.adGroups.list({ campaignId, tenantId, pageSize: 500 })
      ).items.find((g) => g.googleAdGroupId === dto.adGroupId);
      if (!raced) throw error;
      counts.adGroupsCreated -= 1;
      counts.adGroupsUpdated += 1;
      return ctx.adGroups.update(raced.id, {
        name: dto.name,
        status: mapAdGroupFromGoogle(dto, {
          id: raced.id,
          tenantId,
          campaignId,
        }).status,
      });
    }
  }

  private async upsertAd(
    ctx: TransactionContext,
    tenantId: string,
    adGroupId: string,
    dto: Parameters<typeof mapAdFromGoogle>[0],
    counts: GoogleAdsSyncSummary
  ) {
    const listed = await ctx.ads.list({ adGroupId, tenantId, pageSize: 500 });
    const existing = listed.items.find((a) => a.googleAdId === dto.adId);
    if (existing) {
      assertSameTenant(tenantId, existing.tenantId, "Ad");
      counts.adsUpdated += 1;
      const mapped = mapAdFromGoogle(dto, {
        id: existing.id,
        tenantId,
        adGroupId,
      });
      return ctx.ads.update(existing.id, {
        name: mapped.name,
        status: mapped.status,
        finalUrl: mapped.finalUrl,
        trackingTemplate: mapped.trackingTemplate,
      });
    }
    counts.adsCreated += 1;
    try {
      return await ctx.ads.create(
        mapAdFromGoogle(dto, { id: randomUUID(), tenantId, adGroupId })
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = (
        await ctx.ads.list({ adGroupId, tenantId, pageSize: 500 })
      ).items.find((a) => a.googleAdId === dto.adId);
      if (!raced) throw error;
      counts.adsCreated -= 1;
      counts.adsUpdated += 1;
      const mapped = mapAdFromGoogle(dto, {
        id: raced.id,
        tenantId,
        adGroupId,
      });
      return ctx.ads.update(raced.id, {
        name: mapped.name,
        status: mapped.status,
        finalUrl: mapped.finalUrl,
        trackingTemplate: mapped.trackingTemplate,
      });
    }
  }

  private async upsertCriterion(
    ctx: TransactionContext,
    tenantId: string,
    adGroupId: string,
    dto: Parameters<typeof mapCriterionFromGoogle>[0],
    counts: GoogleAdsSyncSummary
  ) {
    const listed = await ctx.adGroupCriteria.list({
      adGroupId,
      tenantId,
      pageSize: 500,
    });
    const existing = listed.items.find(
      (c) => c.googleCriterionId === dto.criterionId
    );
    if (existing) {
      assertSameTenant(tenantId, existing.tenantId, "AdGroupCriterion");
      counts.criteriaUpdated += 1;
      const mapped = mapCriterionFromGoogle(dto, {
        id: existing.id,
        tenantId,
        adGroupId,
      });
      return ctx.adGroupCriteria.update(existing.id, {
        keyword: mapped.keyword,
        keywordText: mapped.keywordText,
        matchType: mapped.matchType,
        status: mapped.status,
      });
    }
    counts.criteriaCreated += 1;
    try {
      return await ctx.adGroupCriteria.create(
        mapCriterionFromGoogle(dto, {
          id: randomUUID(),
          tenantId,
          adGroupId,
        })
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = (
        await ctx.adGroupCriteria.list({ adGroupId, tenantId, pageSize: 500 })
      ).items.find((c) => c.googleCriterionId === dto.criterionId);
      if (!raced) throw error;
      counts.criteriaCreated -= 1;
      counts.criteriaUpdated += 1;
      const mapped = mapCriterionFromGoogle(dto, {
        id: raced.id,
        tenantId,
        adGroupId,
      });
      return ctx.adGroupCriteria.update(raced.id, {
        keyword: mapped.keyword,
        keywordText: mapped.keywordText,
        matchType: mapped.matchType,
        status: mapped.status,
      });
    }
  }

  private writeAudit(
    ctx: TransactionContext,
    input: {
      tenantId: string;
      action: string;
      entityId: string;
      requestId?: string;
      after?: Record<string, unknown>;
    }
  ) {
    return ctx.auditLogs.create({
      id: randomUUID(),
      tenantId: input.tenantId,
      action: input.action,
      entityType: "SyncJob",
      entityId: input.entityId,
      requestId: input.requestId,
      after: input.after ?? {},
      resourceType: "SyncJob",
      resourceId: input.entityId,
      metadata: input.after ?? {},
    });
  }
}
