"use server";

/**
 * Server Actions for entity management pages.
 * All mutations go through the tenant API key; never expose it to the browser.
 */
import { revalidatePath } from "next/cache";
import { entityApi } from "./entities";
import { mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type EntityActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<EntityActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

/* ---------- Google Accounts ---------- */

export async function listGoogleAccountsAction() {
  return attempt(() => entityApi.googleAccounts.list(1, 100), [
    "/google-accounts",
  ]);
}

export async function syncGoogleAccountAction(accountId: string) {
  return attempt(() => entityApi.googleAccounts.sync(accountId), [
    "/google-accounts",
  ]);
}

export async function createGoogleAccountAction(input: {
  name: string;
  customerId: string;
  currency?: string;
  timezone?: string;
}) {
  return attempt(() => entityApi.googleAccounts.create(input), [
    "/google-accounts",
  ]);
}

export async function updateGoogleAccountCurrencyAction(
  id: string,
  currency: string
) {
  return attempt(
    () => entityApi.googleAccounts.update(id, { currency }),
    ["/google-accounts"]
  );
}

/* ---------- Offers ---------- */

/** 取单条 offer（ads-auto 用 offerId 带入佣金时用；只读，不 revalidate）。 */
export async function getOfferAction(id: string) {
  return attempt(() => entityApi.offers.get(id), []);
}

export async function createOfferAction(input: {
  name: string;
  network: string;
  source?: string;
  destinationUrl: string;
  status?: string;
  priority?: number;
  startsAt?: string;
  endsAt?: string;
  commissionValue?: number;
  commissionType?: string;
  avgPrice?: number;
  pickedAt?: string;
  brandName?: string;
  brandNameSource?: string;
  brandNameConfidence?: number;
  festivalTheme?: string;
}) {
  return attempt(() => entityApi.offers.create(input), ["/offers"]);
}

export async function updateOfferAction(
  id: string,
  input: {
    name?: string;
    network?: string;
    destinationUrl?: string;
    priority?: number;
    startsAt?: string | null;
    endsAt?: string | null;
  }
) {
  return attempt(() => entityApi.offers.update(id, input), [
    "/offers",
    `/offers/${id}`,
  ]);
}

export async function changeOfferStatusAction(id: string, status: string) {
  return attempt(() => entityApi.offers.changeStatus(id, status), [
    "/offers",
    `/offers/${id}`,
  ]);
}

export async function deleteOfferAction(id: string) {
  return attempt(() => entityApi.offers.remove(id), ["/offers"]);
}

/** 批量删除 Offer（逐个调用单删 API，租户隔离；最多 100 个）。 */
export async function deleteOffersAction(ids: string[]) {
  const clean = [...new Set(ids)].filter(Boolean).slice(0, 100);
  return attempt(async () => {
    let deleted = 0;
    for (const id of clean) {
      await entityApi.offers.remove(id);
      deleted++;
    }
    return { deleted };
  }, ["/offers"]);
}

/* ---------- Tracking Links ---------- */

export async function replaceTrackingLinkBindingsAction(
  id: string,
  bindings: Array<{ offerId: string; priority?: number; isFallback?: boolean }>
) {
  return attempt(() => entityApi.trackingLinks.replaceBindings(id, bindings), [
    "/tracking-links",
    `/tracking-links/${id}`,
  ]);
}

export async function selectOfferAction(id: string) {
  return attempt(() => entityApi.trackingLinks.selectOffer(id), [
    `/tracking-links/${id}`,
  ]);
}

export async function testClickChainAction(id: string) {
  return attempt(() => entityApi.trackingLinks.testClick(id), [
    `/tracking-links/${id}`,
  ]);
}

/* ---------- Conversions ---------- */

export async function createConversionAction(input: {
  clickId: string;
  conversionAction: string;
  conversionTime?: string;
  value?: string;
  currency?: string;
  orderUuid?: string;
}) {
  return attempt(() => entityApi.conversions.create(input), ["/conversions"]);
}

export async function createConversionFromOrderAction(input: {
  orderId: string;
  conversionAction: string;
  conversionTime?: string;
  value?: string;
  currency?: string;
}) {
  return attempt(() => entityApi.conversions.createFromOrder(input), [
    "/conversions",
  ]);
}

function conversionLifecycle(
  id: string,
  op: "queue" | "execute" | "retry" | "cancel"
) {
  const fns = {
    queue: entityApi.conversions.queue,
    execute: entityApi.conversions.execute,
    retry: entityApi.conversions.retry,
    cancel: entityApi.conversions.cancel,
  };
  return attempt(() => fns[op](id), ["/conversions", `/conversions/${id}`]);
}

export const queueConversionAction = async (id: string) =>
  conversionLifecycle(id, "queue");
export const executeConversionAction = async (id: string) =>
  conversionLifecycle(id, "execute");
export const retryConversionAction = async (id: string) =>
  conversionLifecycle(id, "retry");
export const cancelConversionAction = async (id: string) =>
  conversionLifecycle(id, "cancel");

/* ---------- Orders ---------- */

export async function createOrderAction(input: {
  orderId: string;
  clickId: string;
  value: string;
  currency: string;
  status?: string;
}) {
  return attempt(() => entityApi.orders.create(input), ["/orders"]);
}

export async function changeOrderStatusAction(id: string, status: string) {
  return attempt(() => entityApi.orders.changeStatus(id, status), [
    "/orders",
    `/orders/${id}`,
  ]);
}

/* ---------- URL change requests ---------- */

export async function createUrlChangeRequestAction(input: {
  entityType: string;
  entityId: string;
  toVersionId: string;
  reason: string;
  requestedBy: string;
}) {
  return attempt(() => entityApi.urlChangeRequests.create(input), [
    "/url-versions",
  ]);
}

function urlChangeLifecycle(
  id: string,
  op: "validate" | "queue" | "execute" | "cancel"
) {
  const fns = {
    validate: entityApi.urlChangeRequests.validate,
    queue: entityApi.urlChangeRequests.queue,
    execute: entityApi.urlChangeRequests.execute,
    cancel: entityApi.urlChangeRequests.cancel,
  };
  return attempt(() => fns[op](id), ["/url-versions"]);
}

export const validateUrlChangeAction = async (id: string) =>
  urlChangeLifecycle(id, "validate");
export const queueUrlChangeAction = async (id: string) =>
  urlChangeLifecycle(id, "queue");
export const executeUrlChangeAction = async (id: string) =>
  urlChangeLifecycle(id, "execute");
export const cancelUrlChangeAction = async (id: string) =>
  urlChangeLifecycle(id, "cancel");

export async function rollbackUrlChangeAction(
  id: string,
  input: { requestedBy: string; reason?: string }
) {
  return attempt(() => entityApi.urlChangeRequests.rollback(id, input), [
    "/url-versions",
  ]);
}

/* ---------- Link swap (push-url-change) ---------- */

export async function swapTrackingLinkUrlAction(
  trackingLinkId: string,
  input: {
    newUrl: string;
    referralUrl?: string;
    deviceTarget?: string;
    googleAccountId?: string;
  }
) {
  return attempt(
    () => entityApi.trackingLinks.swapUrl(trackingLinkId, input),
    [`/tracking-links/${trackingLinkId}`]
  );
}
