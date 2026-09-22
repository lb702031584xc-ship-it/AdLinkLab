import { randomUUID } from "node:crypto";
import type {
  ClickRepository,
  Conversion,
  ConversionRepository,
  GoogleAccountRepository,
  Order,
  OrderRepository,
  OrderStatus,
  SyncJobRepository,
  UnitOfWork,
} from "@adlinklab/domain";
import {
  assertConversionTransition,
  assertGoogleUploadTransition,
  assertOrderTransition,
  AuditActions,
} from "@adlinklab/domain";
import {
  assertCurrencyCode,
  assertMoneyDecimal,
  resolveGoogleClickIdentity,
} from "@adlinklab/conversions";
import type { GoogleAdsProvider } from "@adlinklab/google-ads";
import { classifyGoogleAdsError } from "@adlinklab/google-ads";
import {
  ConflictError,
  createIdempotencyKey,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import { processIdempotentJob } from "../queue/jobs.js";
import {
  mutationLockKey,
  withMutationLock,
} from "../queue/execution-guard.js";
import { classifyJobError } from "../queue/retry-policy.js";
import type { JobProducer } from "../queue/producer.js";

const ORDER_SCOPE = "ORDER";
const CONVERSION_SCOPE = "CONVERSION";

export interface ConversionAuditWriter {
  record(input: {
    tenantId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
    jobId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): Promise<unknown> | unknown;
}

/**
 * Phase 7 — Order-first attribution + Conversion upload orchestration.
 * Does not mutate Google Ads URLs. ApiProvider upload remains forbidden.
 */
export class OrderConversionService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly conversions: ConversionRepository,
    private readonly clicks: ClickRepository,
    private readonly googleAccounts: GoogleAccountRepository,
    private readonly provider: GoogleAdsProvider,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: ConversionAuditWriter,
    private readonly syncJobs?: SyncJobRepository,
    private readonly jobProducer?: JobProducer
  ) {}

  listOrders(tenantId: string, page?: number, pageSize?: number) {
    return this.orders.list({ tenantId, page, pageSize });
  }

  listConversions(tenantId: string, page?: number, pageSize?: number) {
    return this.conversions.list({ tenantId, page, pageSize });
  }

  async getOrder(tenantId: string, id: string): Promise<Order> {
    const order = await this.orders.findByIdForTenant(tenantId, id);
    if (!order) throw new NotFoundError("Order", id);
    return order;
  }

  async getConversion(tenantId: string, id: string): Promise<Conversion> {
    const conversion = await this.conversions.findByIdForTenant(tenantId, id);
    if (!conversion) throw new NotFoundError("Conversion", id);
    return conversion;
  }

  /**
   * Create Order attributed to an existing Click (Order-first).
   */
  async createOrder(input: {
    tenantId: string;
    orderId: string;
    clickId: string;
    value: string;
    currency: string;
    status?: OrderStatus;
    idempotencyKey?: string;
    requestId?: string;
  }): Promise<{ order: Order; created: boolean }> {
    const value = assertMoneyDecimal(input.value);
    const currency = assertCurrencyCode(input.currency);
    const orderId = input.orderId.trim();
    if (!orderId) throw new ValidationError("orderId is required");

    const click =
      (await this.clicks.findByClickIdForTenant(
        input.tenantId,
        input.clickId
      )) ??
      (await this.clicks.findByIdForTenant(input.tenantId, input.clickId));
    if (!click) throw new NotFoundError("Click", input.clickId);

    const idempotencyKey =
      input.idempotencyKey ??
      createIdempotencyKey("order", input.tenantId, orderId);

    const existing = await this.orders.findByIdempotencyKey(
      input.tenantId,
      ORDER_SCOPE,
      idempotencyKey
    );
    if (existing) return { order: existing, created: false };

    const byBusinessId = await this.orders.findByOrderId(
      orderId,
      input.tenantId
    );
    if (byBusinessId) return { order: byBusinessId, created: false };

    const status = input.status ?? "CONFIRMED";
    const order = await this.unitOfWork.transaction(async (ctx) => {
      const created = await ctx.orders.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        orderId,
        clickId: click.id,
        value,
        currency,
        status,
        idempotencyScope: ORDER_SCOPE,
        idempotencyKey,
      });
      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: AuditActions.ORDER_CREATED,
        entityType: "Order",
        entityId: created.id,
        requestId: input.requestId,
        after: {
          orderId: created.orderId,
          clickId: created.clickId,
          value: created.value,
          currency: created.currency,
          status: created.status,
        },
      });
      return created;
    });

    return { order, created: true };
  }

  async changeOrderStatus(
    tenantId: string,
    id: string,
    status: OrderStatus,
    requestId?: string
  ): Promise<Order> {
    const existing = await this.getOrder(tenantId, id);
    assertOrderTransition(existing.status, status);
    return this.unitOfWork.transaction(async (ctx) => {
      const updated = await ctx.orders.update(id, {
        status,
        archivedAt: status === "ARCHIVED" ? new Date() : existing.archivedAt,
      });
      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId,
        action: AuditActions.ORDER_STATUS_CHANGED,
        entityType: "Order",
        entityId: id,
        requestId,
        before: { status: existing.status },
        after: { status: updated.status },
      });
      return updated;
    });
  }

  /**
   * Create Conversion from Order (links Order.conversionId).
   * Sets ATTRIBUTED + NOT_UPLOADED, or SKIPPED if Click has no Google click id.
   */
  async createConversionFromOrder(input: {
    tenantId: string;
    orderId: string; // internal UUID or business orderId
    conversionAction: string;
    conversionTime?: Date;
    value?: string;
    currency?: string;
    idempotencyKey?: string;
    requestId?: string;
    googleAccountId?: string;
  }): Promise<{ conversion: Conversion; order: Order; created: boolean }> {
    let order =
      (await this.orders.findByIdForTenant(input.tenantId, input.orderId)) ??
      (await this.orders.findByOrderId(input.orderId, input.tenantId));
    if (!order) throw new NotFoundError("Order", input.orderId);

    if (order.conversionId) {
      const existing = await this.getConversion(
        input.tenantId,
        order.conversionId
      );
      return { conversion: existing, order, created: false };
    }

    if (!order.clickId) {
      throw new ValidationError("Order is missing clickId for attribution");
    }

    const click = await this.clicks.findByIdForTenant(
      input.tenantId,
      order.clickId
    );
    if (!click) throw new NotFoundError("Click", order.clickId);

    const action = input.conversionAction.trim();
    if (!action) throw new ValidationError("conversionAction is required");

    const value = input.value
      ? assertMoneyDecimal(input.value)
      : order.value;
    const currency = input.currency
      ? assertCurrencyCode(input.currency)
      : assertCurrencyCode(order.currency);

    const idempotencyKey =
      input.idempotencyKey ??
      createIdempotencyKey("conversion", input.tenantId, order.orderId);

    const existingKey = await this.conversions.findByIdempotencyKey(
      input.tenantId,
      CONVERSION_SCOPE,
      idempotencyKey
    );
    if (existingKey) {
      if (!order.conversionId) {
        order = await this.orders.update(order.id, {
          conversionId: existingKey.id,
        });
      }
      return { conversion: existingKey, order, created: false };
    }

    const identity = resolveGoogleClickIdentity(click);
    const skipUpload = !identity;

    const result = await this.unitOfWork.transaction(async (ctx) => {
      const conversion = await ctx.conversions.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        clickId: click.id,
        conversionAction: action,
        conversionTime: input.conversionTime ?? new Date(),
        value,
        currency,
        status: "ATTRIBUTED",
        googleUploadStatus: skipUpload ? "SKIPPED" : "NOT_UPLOADED",
        gclid: click.gclid,
        orderId: order!.id,
        idempotencyScope: CONVERSION_SCOPE,
        idempotencyKey,
      });

      const updatedOrder = await ctx.orders.update(order!.id, {
        conversionId: conversion.id,
      });

      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: AuditActions.CONVERSION_CREATED,
        entityType: "Conversion",
        entityId: conversion.id,
        requestId: input.requestId,
        after: {
          clickId: conversion.clickId,
          orderId: updatedOrder.id,
          businessOrderId: updatedOrder.orderId,
          status: conversion.status,
          googleUploadStatus: conversion.googleUploadStatus,
          skipped: skipUpload,
        },
      });

      return { conversion, order: updatedOrder };
    });

    return { ...result, created: true };
  }

  /**
   * Direct Conversion create (requires clickId; optional link to order UUID).
   */
  async createConversion(input: {
    tenantId: string;
    clickId: string;
    conversionAction: string;
    conversionTime?: Date;
    value?: string;
    currency?: string;
    orderUuid?: string;
    idempotencyKey?: string;
    requestId?: string;
  }): Promise<{ conversion: Conversion; created: boolean }> {
    const click =
      (await this.clicks.findByClickIdForTenant(
        input.tenantId,
        input.clickId
      )) ??
      (await this.clicks.findByIdForTenant(input.tenantId, input.clickId));
    if (!click) throw new NotFoundError("Click", input.clickId);

    const action = input.conversionAction.trim();
    if (!action) throw new ValidationError("conversionAction is required");

    let order: Order | null = null;
    if (input.orderUuid) {
      order = await this.getOrder(input.tenantId, input.orderUuid);
    }

    const idempotencyKey =
      input.idempotencyKey ??
      createIdempotencyKey(
        "conversion",
        input.tenantId,
        order?.orderId ?? click.id,
        action
      );

    const existing = await this.conversions.findByIdempotencyKey(
      input.tenantId,
      CONVERSION_SCOPE,
      idempotencyKey
    );
    if (existing) return { conversion: existing, created: false };

    const identity = resolveGoogleClickIdentity(click);
    const value = input.value ? assertMoneyDecimal(input.value) : undefined;
    const currency = input.currency
      ? assertCurrencyCode(input.currency)
      : undefined;

    const conversion = await this.unitOfWork.transaction(async (ctx) => {
      const created = await ctx.conversions.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        clickId: click.id,
        conversionAction: action,
        conversionTime: input.conversionTime ?? new Date(),
        value,
        currency,
        status: "ATTRIBUTED",
        googleUploadStatus: identity ? "NOT_UPLOADED" : "SKIPPED",
        gclid: click.gclid,
        orderId: order?.id,
        idempotencyScope: CONVERSION_SCOPE,
        idempotencyKey,
      });
      if (order && !order.conversionId) {
        await ctx.orders.update(order.id, { conversionId: created.id });
      }
      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: AuditActions.CONVERSION_CREATED,
        entityType: "Conversion",
        entityId: created.id,
        requestId: input.requestId,
        after: {
          clickId: created.clickId,
          status: created.status,
          googleUploadStatus: created.googleUploadStatus,
        },
      });
      return created;
    });

    return { conversion, created: true };
  }

  async queueUpload(
    tenantId: string,
    conversionId: string,
    requestId?: string
  ): Promise<Conversion> {
    const conversion = await this.getConversion(tenantId, conversionId);
    if (conversion.googleUploadStatus === "UPLOADED") {
      return conversion;
    }
    if (conversion.googleUploadStatus === "SKIPPED") {
      throw new ConflictError("Conversion upload was skipped (no Google click id)", {
        googleUploadStatus: conversion.googleUploadStatus,
      });
    }
    if (conversion.googleUploadStatus === "QUEUED") {
      return conversion;
    }

    assertGoogleUploadTransition(conversion.googleUploadStatus, "QUEUED");

    const idempotencyKey =
      conversion.idempotencyKey ??
      createIdempotencyKey("conversionUpload", tenantId, conversion.id);
    const jobId = `conversionUpload:${idempotencyKey}`;

    let syncJobId: string | undefined;
    if (this.syncJobs) {
      const existingJob = await this.syncJobs.findByIdempotencyKey(
        tenantId,
        "SYNC_JOB",
        idempotencyKey
      );
      if (!existingJob) {
        const created = await this.syncJobs.create({
          id: randomUUID(),
          tenantId,
          type: "conversionUpload",
          status: "PENDING",
          provider: "mock",
          idempotencyScope: "SYNC_JOB",
          idempotencyKey,
          jobId,
          attempts: 0,
        });
        syncJobId = created.id;
      } else {
        syncJobId = existingJob.id;
      }
    }

    const updated = await this.conversions.update(conversion.id, {
      googleUploadStatus: "QUEUED",
    });

    await this.audit.record({
      tenantId,
      action: AuditActions.CONVERSION_QUEUED,
      entityType: "Conversion",
      entityId: conversion.id,
      requestId,
      jobId,
      after: { googleUploadStatus: "QUEUED" },
    });

    if (this.jobProducer) {
      await this.jobProducer.enqueueConversionUpload({
        type: "conversionUpload",
        tenantId,
        conversionId: conversion.id,
        idempotencyKey,
        jobId,
        syncJobId,
      });
    }

    return updated;
  }

  async retryUpload(
    tenantId: string,
    conversionId: string,
    requestId?: string
  ): Promise<Conversion> {
    const conversion = await this.getConversion(tenantId, conversionId);
    if (conversion.googleUploadStatus !== "FAILED") {
      throw new ConflictError("Only FAILED conversions can be retried", {
        googleUploadStatus: conversion.googleUploadStatus,
      });
    }
    assertGoogleUploadTransition("FAILED", "QUEUED");
    await this.audit.record({
      tenantId,
      action: AuditActions.CONVERSION_RETRY,
      entityType: "Conversion",
      entityId: conversionId,
      requestId,
      before: { googleUploadStatus: "FAILED" },
    });
    return this.queueUpload(tenantId, conversionId, requestId);
  }

  async cancelUpload(
    tenantId: string,
    conversionId: string,
    requestId?: string
  ): Promise<Conversion> {
    const conversion = await this.getConversion(tenantId, conversionId);
    if (
      conversion.googleUploadStatus !== "NOT_UPLOADED" &&
      conversion.googleUploadStatus !== "QUEUED" &&
      conversion.googleUploadStatus !== "FAILED"
    ) {
      throw new ConflictError("Conversion cannot be cancelled in current upload status", {
        googleUploadStatus: conversion.googleUploadStatus,
      });
    }
    assertGoogleUploadTransition(conversion.googleUploadStatus, "SKIPPED");
    const updated = await this.conversions.update(conversionId, {
      googleUploadStatus: "SKIPPED",
    });
    await this.audit.record({
      tenantId,
      action: AuditActions.CONVERSION_CANCELLED,
      entityType: "Conversion",
      entityId: conversionId,
      requestId,
      after: { googleUploadStatus: "SKIPPED" },
    });
    return updated;
  }

  async processQueued(
    tenantId: string,
    conversionId: string,
    opts?: { customerId?: string; googleAccountId?: string }
  ) {
    if (!this.syncJobs) {
      return this.executeUpload(tenantId, conversionId, opts);
    }
    const conversion = await this.getConversion(tenantId, conversionId);
    const idempotencyKey =
      conversion.idempotencyKey ??
      createIdempotencyKey("conversionUpload", tenantId, conversion.id);
    const sync = await processIdempotentJob(this.syncJobs, {
      type: "conversionUpload",
      jobId: `conversionUpload:${idempotencyKey}`,
      idempotencyKey,
      tenantId,
      payload: { conversionId, tenantId },
      handler: async () => {
        const result = await this.executeUpload(tenantId, conversionId, opts);
        if (result.conversion.googleUploadStatus === "FAILED") {
          throw new Error("Conversion upload failed");
        }
      },
    });
    const latest = await this.getConversion(tenantId, conversionId);
    return { conversion: latest, sync };
  }

  /**
   * Execute Mock/Api provider upload. ApiProvider refuses real mutation.
   * Phase 8.3.3: serializes with Worker via mutation lock on jobId.
   */
  async executeUpload(
    tenantId: string,
    conversionId: string,
    opts?: {
      customerId?: string;
      googleAccountId?: string;
      /** Phase 8.3.4 — Worker soft-retry keeps QUEUED on retryable errors. */
      softRetry?: boolean;
    }
  ): Promise<{ conversion: Conversion; skipped: boolean }> {
    const conversion = await this.getConversion(tenantId, conversionId);

    if (conversion.googleUploadStatus === "UPLOADED") {
      return { conversion, skipped: true };
    }
    if (conversion.googleUploadStatus === "SKIPPED") {
      return { conversion, skipped: true };
    }

    const idempotencyKey =
      conversion.idempotencyKey ??
      createIdempotencyKey("conversionUpload", tenantId, conversion.id);
    const jobId = `conversionUpload:${idempotencyKey}`;

    return withMutationLock(mutationLockKey(jobId), () =>
      this.executeUploadLocked(tenantId, conversionId, opts)
    );
  }

  private async executeUploadLocked(
    tenantId: string,
    conversionId: string,
    opts?: {
      customerId?: string;
      googleAccountId?: string;
      softRetry?: boolean;
    }
  ): Promise<{ conversion: Conversion; skipped: boolean }> {
    const conversion = await this.getConversion(tenantId, conversionId);

    if (conversion.googleUploadStatus === "UPLOADED") {
      return { conversion, skipped: true };
    }
    if (conversion.googleUploadStatus === "SKIPPED") {
      return { conversion, skipped: true };
    }
    if (
      conversion.googleUploadStatus !== "QUEUED" &&
      conversion.googleUploadStatus !== "FAILED"
    ) {
      throw new ConflictError("Conversion must be QUEUED before upload", {
        googleUploadStatus: conversion.googleUploadStatus,
      });
    }

    if (conversion.googleUploadStatus === "FAILED") {
      assertGoogleUploadTransition("FAILED", "QUEUED");
      await this.conversions.update(conversion.id, {
        googleUploadStatus: "QUEUED",
      });
    }

    const click = await this.clicks.findByIdForTenant(
      tenantId,
      conversion.clickId
    );
    if (!click) throw new NotFoundError("Click", conversion.clickId);

    const identity = resolveGoogleClickIdentity(click);
    if (!identity) {
      assertGoogleUploadTransition("QUEUED", "SKIPPED");
      const skipped = await this.conversions.update(conversion.id, {
        googleUploadStatus: "SKIPPED",
      });
      return { conversion: skipped, skipped: true };
    }

    let customerId = opts?.customerId;
    if (!customerId && opts?.googleAccountId) {
      const account = await this.googleAccounts.findByIdForTenant(
        tenantId,
        opts.googleAccountId
      );
      customerId = account?.customerId;
    }
    if (!customerId) {
      const accounts = await this.googleAccounts.list({
        tenantId,
        pageSize: 1,
      });
      customerId = accounts.items[0]?.customerId;
    }
    if (!customerId) {
      throw new ValidationError("customerId is required for conversion upload");
    }

    const linkedOrder = await this.findOrderForConversion(tenantId, conversion);
    const businessOrderId = linkedOrder?.orderId;

    await this.audit.record({
      tenantId,
      action: AuditActions.CONVERSION_UPLOAD_STARTED,
      entityType: "Conversion",
      entityId: conversion.id,
      after: { googleUploadStatus: "QUEUED" },
    });

    try {
      const result = await this.provider.uploadConversion({
        customerId,
        conversionAction: conversion.conversionAction,
        gclid: identity.kind === "gclid" ? identity.value : undefined,
        gbraid: identity.kind === "gbraid" ? identity.value : undefined,
        wbraid: identity.kind === "wbraid" ? identity.value : undefined,
        conversionDateTime: conversion.conversionTime.toISOString(),
        conversionValue: conversion.value
          ? Number(conversion.value)
          : undefined,
        currencyCode: conversion.currency,
        orderId: businessOrderId,
      });

      if (!result.success) {
        throw new Error(result.message ?? "uploadConversion returned success=false");
      }

      assertGoogleUploadTransition("QUEUED", "UPLOADED");
      if (conversion.status === "ATTRIBUTED") {
        assertConversionTransition("ATTRIBUTED", "UPLOADED");
      }

      const uploaded = await this.unitOfWork.transaction(async (ctx) => {
        return ctx.conversions.update(conversion.id, {
          googleUploadStatus: "UPLOADED",
          status: "UPLOADED",
          googleConversionResourceName: result.externalId,
        });
      });

      await this.audit.record({
        tenantId,
        action: AuditActions.CONVERSION_UPLOADED,
        entityType: "Conversion",
        entityId: conversion.id,
        after: {
          googleUploadStatus: "UPLOADED",
          externalId: result.externalId,
        },
      });

      return { conversion: uploaded, skipped: false };
    } catch (error) {
      const classified = classifyJobError(error);
      const message = error instanceof Error ? error.message : String(error);

      if (opts?.softRetry && classified.retryable) {
        // Remain QUEUED for BullMQ retry (do not mark FAILED).
        await this.audit.record({
          tenantId,
          action: AuditActions.CONVERSION_UPLOAD_FAILED,
          entityType: "Conversion",
          entityId: conversion.id,
          after: {
            googleUploadStatus: "QUEUED",
            softRetry: true,
            error: message,
            retryable: true,
            code: classified.code,
          },
        });
        throw error;
      }

      const adsClassified = classifyGoogleAdsError(error);
      assertGoogleUploadTransition("QUEUED", "FAILED");
      await this.conversions.update(conversion.id, {
        googleUploadStatus: "FAILED",
        status:
          conversion.status === "ATTRIBUTED" || conversion.status === "PENDING"
            ? "FAILED"
            : conversion.status,
      });
      await this.audit.record({
        tenantId,
        action: AuditActions.CONVERSION_UPLOAD_FAILED,
        entityType: "Conversion",
        entityId: conversion.id,
        after: {
          googleUploadStatus: "FAILED",
          error: message,
          retryable: adsClassified.retryable,
          code: adsClassified.code,
        },
      });
      throw error;
    }
  }

  /** Prefer Conversion.orderId (Order UUID); else Order.conversionId authority. */
  private async findOrderForConversion(
    tenantId: string,
    conversion: Conversion
  ): Promise<Order | null> {
    if (conversion.orderId) {
      const byId = await this.orders.findByIdForTenant(
        tenantId,
        conversion.orderId
      );
      if (byId) return byId;
    }
    const page = await this.orders.list({ tenantId, pageSize: 500 });
    return page.items.find((o) => o.conversionId === conversion.id) ?? null;
  }
}
