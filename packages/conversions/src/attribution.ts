import type { Click, Conversion, Order } from "@adlinklab/domain";
import { ValidationError } from "@adlinklab/shared";

/**
 * Attribution chain: Click → Conversion → Order (fixture orientation).
 * Phase 7 runtime prefers Order-first then Conversion linked via Order.conversionId.
 */
export interface AttributionChain {
  click?: Click;
  conversion?: Conversion;
  order?: Order;
}

export function buildAttributionChain(parts: {
  click?: Click;
  conversion?: Conversion;
  order?: Order;
}): AttributionChain {
  return {
    click: parts.click,
    conversion: parts.conversion,
    order: parts.order,
  };
}

export function isFullyAttributed(chain: AttributionChain): boolean {
  return Boolean(chain.click && chain.conversion && chain.order);
}

export type GoogleClickIdKind = "gclid" | "gbraid" | "wbraid";

export interface GoogleClickIdentity {
  kind: GoogleClickIdKind;
  value: string;
}

/**
 * Primary upload identity from Click (never invent IDs).
 * Priority: gclid → gbraid → wbraid.
 */
export function resolveGoogleClickIdentity(
  click: Pick<Click, "gclid" | "gbraid" | "wbraid">
): GoogleClickIdentity | null {
  if (click.gclid?.trim()) {
    return { kind: "gclid", value: click.gclid.trim() };
  }
  if (click.gbraid?.trim()) {
    return { kind: "gbraid", value: click.gbraid.trim() };
  }
  if (click.wbraid?.trim()) {
    return { kind: "wbraid", value: click.wbraid.trim() };
  }
  return null;
}

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Validate MoneyDecimal string (never IEEE float at boundary). */
export function assertMoneyDecimal(value: string, field = "value"): string {
  const trimmed = value.trim();
  if (!MONEY_RE.test(trimmed)) {
    throw new ValidationError(`${field} must be a decimal string (max 4 fraction digits)`, {
      value,
    });
  }
  return trimmed;
}

export function assertCurrencyCode(currency: string): string {
  const c = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) {
    throw new ValidationError("currency must be a 3-letter ISO code", {
      currency,
    });
  }
  return c;
}
