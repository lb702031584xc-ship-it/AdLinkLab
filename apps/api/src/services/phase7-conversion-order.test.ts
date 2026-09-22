import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
  TenantB,
} from "@adlinklab/database";
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
import {
  GoogleAdsApiProvider,
  MockGoogleAdsProvider,
} from "@adlinklab/google-ads";
import { ConflictError, ValidationError } from "@adlinklab/shared";
import { TrackingLinkResolver } from "@adlinklab/tracking";
import {
  OfferEligibilityService,
  OfferSelectionService,
} from "@adlinklab/offers";
import { ClickIngestionService } from "./click-ingestion.js";
import { AuditService, OrderConversionService } from "./index.js";
import { processConversionUploadJob } from "../queue/conversion-upload-worker.js";

function createHarness(provider: MockGoogleAdsProvider | GoogleAdsApiProvider = new MockGoogleAdsProvider()) {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const svc = new OrderConversionService(
    repos.orders,
    repos.conversions,
    repos.clicks,
    repos.googleAccounts,
    provider,
    repos.unitOfWork,
    audit,
    repos.syncJobs
  );
  return { repos, audit, svc, provider };
}

async function createFreshOrder(
  svc: OrderConversionService,
  key: string,
  clickId = TenantA.click3
) {
  return svc.createOrder({
    tenantId: TenantA.id,
    orderId: `ORDER-P7-${key}`,
    clickId,
    value: "12.5000",
    currency: "USD",
    idempotencyKey: `p7:order:${key}`,
  });
}

describe("Phase 7 — Order / Conversion attribution + upload", () => {
  it("1. create order linked to click", async () => {
    const { svc } = createHarness();
    const { order, created } = await createFreshOrder(svc, "1");
    expect(created).toBe(true);
    expect(order.clickId).toBe(TenantA.click3);
    expect(order.status).toBe("CONFIRMED");
    expect(order.value).toBe("12.5000");
  });

  it("2. order create is idempotent by key", async () => {
    const { svc } = createHarness();
    const a = await createFreshOrder(svc, "2");
    const b = await createFreshOrder(svc, "2");
    expect(b.created).toBe(false);
    expect(b.order.id).toBe(a.order.id);
  });

  it("3. reject invalid money decimal", async () => {
    const { svc } = createHarness();
    await expect(
      svc.createOrder({
        tenantId: TenantA.id,
        orderId: "BAD-MONEY",
        clickId: TenantA.click3,
        value: "12.99999",
        currency: "USD",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("4. reject invalid currency", async () => {
    const { svc } = createHarness();
    await expect(
      svc.createOrder({
        tenantId: TenantA.id,
        orderId: "BAD-CCY",
        clickId: TenantA.click3,
        value: "10.00",
        currency: "US",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. tenant isolation on getOrder", async () => {
    const { svc } = createHarness();
    await expect(
      svc.getOrder(TenantB.id, TenantA.order1)
    ).rejects.toBeTruthy();
  });

  it("6. order status CONFIRMED → REFUNDED", async () => {
    const { svc } = createHarness();
    const { order } = await createFreshOrder(svc, "6");
    const updated = await svc.changeOrderStatus(
      TenantA.id,
      order.id,
      "REFUNDED"
    );
    expect(updated.status).toBe("REFUNDED");
  });

  it("7. invalid order transition throws", async () => {
    const { svc } = createHarness();
    const { order } = await createFreshOrder(svc, "7");
    await expect(
      svc.changeOrderStatus(TenantA.id, order.id, "PENDING")
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("8. create conversion from order sets Order.conversionId", async () => {
    const { svc } = createHarness();
    const { order } = await createFreshOrder(svc, "8");
    const result = await svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p7:conv:8",
    });
    expect(result.created).toBe(true);
    expect(result.order.conversionId).toBe(result.conversion.id);
    expect(result.conversion.status).toBe("ATTRIBUTED");
    expect(result.conversion.googleUploadStatus).toBe("NOT_UPLOADED");
  });

  it("9. createConversionFromOrder is idempotent via Order.conversionId", async () => {
    const { svc } = createHarness();
    const { order } = await createFreshOrder(svc, "9");
    const a = await svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.orderId,
      conversionAction: "purchase",
      idempotencyKey: "p7:conv:9",
    });
    const b = await svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.orderId,
      conversionAction: "purchase",
      idempotencyKey: "p7:conv:9-other",
    });
    expect(b.created).toBe(false);
    expect(b.conversion.id).toBe(a.conversion.id);
  });

  it("10. missing google click id → SKIPPED", async () => {
    const { svc, repos } = createHarness();
    const click = await repos.clicks.create({
      id: randomUUID(),
      clickId: randomUUID(),
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      occurredAt: new Date(),
    });
    const { order } = await svc.createOrder({
      tenantId: TenantA.id,
      orderId: "ORDER-P7-SKIP",
      clickId: click.id,
      value: "1.00",
      currency: "USD",
      idempotencyKey: "p7:skip:order",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p7:skip:conv",
    });
    expect(conversion.googleUploadStatus).toBe("SKIPPED");
    await expect(
      svc.queueUpload(TenantA.id, conversion.id)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("11. resolveGoogleClickIdentity prefers gclid", () => {
    expect(
      resolveGoogleClickIdentity({
        gclid: "g1",
        gbraid: "gb1",
        wbraid: "wb1",
      })
    ).toEqual({ kind: "gclid", value: "g1" });
  });

  it("12. resolveGoogleClickIdentity falls back to gbraid", () => {
    expect(
      resolveGoogleClickIdentity({ gbraid: " gb1 ", wbraid: "wb1" })
    ).toEqual({ kind: "gbraid", value: "gb1" });
  });

  it("13. resolveGoogleClickIdentity falls back to wbraid", () => {
    expect(resolveGoogleClickIdentity({ wbraid: "wb1" })).toEqual({
      kind: "wbraid",
      value: "wb1",
    });
  });

  it("14. assertMoneyDecimal / currency helpers", () => {
    expect(assertMoneyDecimal("9.99")).toBe("9.99");
    expect(assertCurrencyCode("usd")).toBe("USD");
    expect(() => assertMoneyDecimal("abc")).toThrow(ValidationError);
  });

  it("15. queue upload NOT_UPLOADED → QUEUED", async () => {
    const { svc } = createHarness();
    const queued = await svc.queueUpload(TenantA.id, TenantA.conversion1);
    expect(queued.googleUploadStatus).toBe("QUEUED");
  });

  it("16. queue is idempotent when already QUEUED", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    const again = await svc.queueUpload(TenantA.id, TenantA.conversion1);
    expect(again.googleUploadStatus).toBe("QUEUED");
  });

  it("17. execute upload Mock → UPLOADED", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    const { conversion, skipped } = await svc.executeUpload(
      TenantA.id,
      TenantA.conversion1
    );
    expect(skipped).toBe(false);
    expect(conversion.googleUploadStatus).toBe("UPLOADED");
    expect(conversion.status).toBe("UPLOADED");
    expect(conversion.googleConversionResourceName).toContain("gclid-demo-001");
  });

  it("18. re-execute after UPLOADED is skipped", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await svc.executeUpload(TenantA.id, TenantA.conversion1);
    const second = await svc.executeUpload(TenantA.id, TenantA.conversion1);
    expect(second.skipped).toBe(true);
    expect(second.conversion.googleUploadStatus).toBe("UPLOADED");
  });

  it("19. provider error → FAILED + audit", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "RATE_LIMITED",
    });
    const { svc, audit } = createHarness(provider);
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await expect(
      svc.executeUpload(TenantA.id, TenantA.conversion1)
    ).rejects.toBeTruthy();
    const failed = await svc.getConversion(TenantA.id, TenantA.conversion1);
    expect(failed.googleUploadStatus).toBe("FAILED");
    const logs = await audit.list(TenantA.id, 1, 200);
    expect(
      logs.items.some((l) => l.action === AuditActions.CONVERSION_UPLOAD_FAILED)
    ).toBe(true);
  });

  it("20. retry FAILED → QUEUED then upload", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "TEMPORARY_ERROR",
    });
    const { svc } = createHarness(provider);
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await expect(
      svc.executeUpload(TenantA.id, TenantA.conversion1)
    ).rejects.toBeTruthy();
    provider.configureError(null);
    const retried = await svc.retryUpload(TenantA.id, TenantA.conversion1);
    expect(retried.googleUploadStatus).toBe("QUEUED");
    const { conversion } = await svc.executeUpload(
      TenantA.id,
      TenantA.conversion1
    );
    expect(conversion.googleUploadStatus).toBe("UPLOADED");
  });

  it("21. cancel QUEUED → SKIPPED", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    const cancelled = await svc.cancelUpload(TenantA.id, TenantA.conversion1);
    expect(cancelled.googleUploadStatus).toBe("SKIPPED");
  });

  it("22. cannot cancel UPLOADED", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await svc.executeUpload(TenantA.id, TenantA.conversion1);
    await expect(
      svc.cancelUpload(TenantA.id, TenantA.conversion1)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("23. ApiProvider refuses uploadConversion", async () => {
    const { svc } = createHarness(new GoogleAdsApiProvider());
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await expect(
      svc.executeUpload(TenantA.id, TenantA.conversion1)
    ).rejects.toBeTruthy();
    const failed = await svc.getConversion(TenantA.id, TenantA.conversion1);
    expect(failed.googleUploadStatus).toBe("FAILED");
  });

  it("24. processQueued uses SyncJob idempotency", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    const first = await svc.processQueued(TenantA.id, TenantA.conversion1);
    expect(first.conversion.googleUploadStatus).toBe("UPLOADED");
    const second = await svc.processQueued(TenantA.id, TenantA.conversion1);
    expect(second.sync.skipped).toBe(true);
  });

  it("25. worker helper uploads conversion", async () => {
    const { svc, repos } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    const conversion = await svc.getConversion(TenantA.id, TenantA.conversion1);
    const key = conversion.idempotencyKey!;
    const result = await processConversionUploadJob({
      syncJobs: repos.syncJobs,
      orderConversions: svc,
      tenantId: TenantA.id,
      conversionId: TenantA.conversion1,
      jobId: `conversionUpload:${key}`,
      idempotencyKey: key,
    });
    expect(result.status).toBe("COMPLETED");
    const uploaded = await svc.getConversion(TenantA.id, TenantA.conversion1);
    expect(uploaded.googleUploadStatus).toBe("UPLOADED");
  });

  it("26. gbraid-only click uploads with gbraid", async () => {
    const { svc, repos } = createHarness();
    const click = await repos.clicks.create({
      id: randomUUID(),
      clickId: randomUUID(),
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      gbraid: "gbraid-p7-001",
      occurredAt: new Date(),
    });
    const { order } = await svc.createOrder({
      tenantId: TenantA.id,
      orderId: "ORDER-GBRAID",
      clickId: click.id,
      value: "3.00",
      currency: "USD",
      idempotencyKey: "p7:gbraid:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p7:gbraid:c",
    });
    await svc.queueUpload(TenantA.id, conversion.id);
    const { conversion: uploaded } = await svc.executeUpload(
      TenantA.id,
      conversion.id
    );
    expect(uploaded.googleConversionResourceName).toContain("gbraid-p7-001");
  });

  it("27. wbraid-only click uploads with wbraid", async () => {
    const { svc, repos } = createHarness();
    const click = await repos.clicks.create({
      id: randomUUID(),
      clickId: randomUUID(),
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      wbraid: "wbraid-p7-001",
      occurredAt: new Date(),
    });
    const { conversion } = await svc.createConversion({
      tenantId: TenantA.id,
      clickId: click.id,
      conversionAction: "lead",
      value: "1.00",
      currency: "USD",
      idempotencyKey: "p7:wbraid:c",
    });
    await svc.queueUpload(TenantA.id, conversion.id);
    const { conversion: uploaded } = await svc.executeUpload(
      TenantA.id,
      conversion.id
    );
    expect(uploaded.googleConversionResourceName).toContain("wbraid-p7-001");
  });

  it("28. listOrders is tenant scoped", async () => {
    const { svc } = createHarness();
    const a = await svc.listOrders(TenantA.id);
    const b = await svc.listOrders(TenantB.id);
    expect(a.items.every((o) => o.tenantId === TenantA.id)).toBe(true);
    expect(b.items.every((o) => o.tenantId === TenantB.id)).toBe(true);
    expect(b.items.some((o) => o.id === TenantA.order1)).toBe(false);
  });

  it("29. listConversions is tenant scoped", async () => {
    const { svc } = createHarness();
    const a = await svc.listConversions(TenantA.id);
    expect(a.items.every((c) => c.tenantId === TenantA.id)).toBe(true);
  });

  it("30. ORDER_CREATED audit written", async () => {
    const { svc, audit } = createHarness();
    await createFreshOrder(svc, "30");
    const logs = await audit.list(TenantA.id, 1, 200);
    expect(logs.items.some((l) => l.action === AuditActions.ORDER_CREATED)).toBe(
      true
    );
  });

  it("31. CONVERSION_QUEUED audit written", async () => {
    const { svc, audit } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    const logs = await audit.list(TenantA.id, 1, 200);
    expect(
      logs.items.some((l) => l.action === AuditActions.CONVERSION_QUEUED)
    ).toBe(true);
  });

  it("32. FSM helpers reject illegal google upload transitions", () => {
    expect(() =>
      assertGoogleUploadTransition("UPLOADED", "QUEUED")
    ).toThrow(ConflictError);
    expect(() => assertOrderTransition("ARCHIVED", "CONFIRMED")).toThrow(
      ConflictError
    );
    expect(() =>
      assertConversionTransition("UPLOADED", "ATTRIBUTED")
    ).toThrow(ConflictError);
  });

  it("33. execute without QUEUED rejects", async () => {
    const { svc } = createHarness();
    await expect(
      svc.executeUpload(TenantA.id, TenantA.conversion2)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("34. retry only from FAILED", async () => {
    const { svc } = createHarness();
    await expect(
      svc.retryUpload(TenantA.id, TenantA.conversion1)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("35. createConversion links optional orderUuid", async () => {
    const { svc } = createHarness();
    const { order } = await createFreshOrder(svc, "35");
    const { conversion } = await svc.createConversion({
      tenantId: TenantA.id,
      clickId: TenantA.click3,
      conversionAction: "signup",
      orderUuid: order.id,
      value: "0.00",
      currency: "USD",
      idempotencyKey: "p7:direct:35",
    });
    const linked = await svc.getOrder(TenantA.id, order.id);
    expect(linked.conversionId).toBe(conversion.id);
  });

  it("36. createConversion idempotent by key", async () => {
    const { svc } = createHarness();
    const a = await svc.createConversion({
      tenantId: TenantA.id,
      clickId: TenantA.click3,
      conversionAction: "signup",
      idempotencyKey: "p7:direct:36",
    });
    const b = await svc.createConversion({
      tenantId: TenantA.id,
      clickId: TenantA.click3,
      conversionAction: "signup",
      idempotencyKey: "p7:direct:36",
    });
    expect(b.created).toBe(false);
    expect(b.conversion.id).toBe(a.conversion.id);
  });

  it("37. business orderId passed to provider upload", async () => {
    const provider = new MockGoogleAdsProvider();
    const calls: unknown[] = [];
    const original = provider.uploadConversion.bind(provider);
    provider.uploadConversion = async (input) => {
      calls.push(input);
      return original(input);
    };
    const { svc } = createHarness(provider);
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await svc.executeUpload(TenantA.id, TenantA.conversion1);
    expect(calls[0]).toMatchObject({ orderId: "ORDER-001", gclid: "gclid-demo-001" });
  });

  it("38. Phase 4 click ingestion still works", async () => {
    const { repos } = createHarness();
    const resolver = new TrackingLinkResolver(
      repos.trackingLinks,
      repos.offers,
      repos.landingPages
    );
    const ingestion = new ClickIngestionService(
      resolver,
      repos.clicks,
      repos.unitOfWork
    );
    const eligibility = new OfferEligibilityService(
      repos.offers,
      repos.landingPages
    );
    const selection = new OfferSelectionService(
      repos.trackingLinks,
      repos.offers,
      repos.trackingLinkOffers,
      eligibility
    );
    expect(selection).toBeTruthy();
    const result = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      ingestionId: `p7-click-${randomUUID()}`,
      requestMetadata: {
        queryParameters: { gclid: "gclid-p7-reg" },
      },
    });
    expect(result.click.gclid).toBe("gclid-p7-reg");
  });

  it("39. cross-tenant conversion get fails", async () => {
    const { svc } = createHarness();
    await expect(
      svc.getConversion(TenantB.id, TenantA.conversion1)
    ).rejects.toBeTruthy();
  });

  it("40. missing click on order create fails", async () => {
    const { svc } = createHarness();
    await expect(
      svc.createOrder({
        tenantId: TenantA.id,
        orderId: "NO-CLICK",
        clickId: randomUUID(),
        value: "1.00",
        currency: "USD",
      })
    ).rejects.toBeTruthy();
  });

  it("41. CONVERSION_UPLOADED audit after success", async () => {
    const { svc, audit } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await svc.executeUpload(TenantA.id, TenantA.conversion1);
    const logs = await audit.list(TenantA.id, 1, 200);
    expect(
      logs.items.some((l) => l.action === AuditActions.CONVERSION_UPLOADED)
    ).toBe(true);
  });

  it("42. cancel NOT_UPLOADED → SKIPPED", async () => {
    const { svc } = createHarness();
    const cancelled = await svc.cancelUpload(TenantA.id, TenantA.conversion2);
    expect(cancelled.googleUploadStatus).toBe("SKIPPED");
  });

  it("43. order create by business orderId returns existing", async () => {
    const { svc } = createHarness();
    const again = await svc.createOrder({
      tenantId: TenantA.id,
      orderId: "ORDER-001",
      clickId: TenantA.click1,
      value: "49.9900",
      currency: "USD",
      idempotencyKey: "p7:existing-business",
    });
    expect(again.created).toBe(false);
    expect(again.order.id).toBe(TenantA.order1);
  });

  it("44. processQueued after cancel stays SKIPPED", async () => {
    const { svc } = createHarness();
    await svc.queueUpload(TenantA.id, TenantA.conversion1);
    await svc.cancelUpload(TenantA.id, TenantA.conversion1);
    const result = await svc.executeUpload(TenantA.id, TenantA.conversion1);
    expect(result.skipped).toBe(true);
    expect(result.conversion.googleUploadStatus).toBe("SKIPPED");
  });
});
