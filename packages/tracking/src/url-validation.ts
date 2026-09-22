import { ValidationError } from "@adlinklab/shared";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Open-redirect protection: only http/https destinations from DB are allowed.
 * Rejects javascript:, data:, file:, etc.
 */
export function assertSafeRedirectUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new ValidationError("Redirect URL is empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("Redirect URL is invalid", { url: trimmed });
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new ValidationError("Redirect URL scheme is not allowed", {
      url: trimmed,
      scheme: parsed.protocol,
    });
  }

  if (!parsed.hostname) {
    throw new ValidationError("Redirect URL host is invalid", { url: trimmed });
  }

  return parsed.toString();
}

/**
 * Tracking templates may include ValueTrack / custom placeholders such as {lpurl}.
 * Validate by substituting placeholders with a safe host so URL() can parse.
 */
export function assertSafeTrackingTemplate(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) {
    throw new ValidationError("Tracking template is empty");
  }

  const substituted = trimmed.replace(/\{[^}]+\}/g, "placeholder");
  try {
    assertSafeRedirectUrl(substituted);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError("Tracking template is not allowed", {
        template: trimmed,
        details: error.details,
      });
    }
    throw error;
  }
  return trimmed;
}

export interface UrlVersionFieldInput {
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters?: Record<string, string>;
}

export interface UrlFieldValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Validate UrlVersion URL fields without accepting arbitrary request destinations. */
export function validateUrlVersionFields(
  input: UrlVersionFieldInput
): UrlFieldValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    assertSafeRedirectUrl(input.finalUrl);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (input.finalMobileUrl) {
    try {
      assertSafeRedirectUrl(input.finalMobileUrl);
    } catch (error) {
      errors.push(
        `finalMobileUrl: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (input.finalAppUrl) {
    try {
      assertSafeRedirectUrl(input.finalAppUrl);
    } catch (error) {
      errors.push(
        `finalAppUrl: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (input.trackingTemplate) {
    try {
      assertSafeTrackingTemplate(input.trackingTemplate);
    } catch (error) {
      errors.push(
        `trackingTemplate: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (input.customParameters) {
    for (const [key, value] of Object.entries(input.customParameters)) {
      if (typeof key !== "string" || typeof value !== "string") {
        errors.push("customParameters values must be strings");
        break;
      }
      if (!key.trim()) {
        errors.push("customParameters keys must be non-empty");
        break;
      }
    }
  }

  if (
    input.finalUrl &&
    input.finalMobileUrl &&
    input.finalUrl === input.finalMobileUrl
  ) {
    warnings.push("finalMobileUrl is identical to finalUrl");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidUrlVersionFields(input: UrlVersionFieldInput): void {
  const result = validateUrlVersionFields(input);
  if (!result.ok) {
    throw new ValidationError("URL version fields failed validation", {
      errors: result.errors,
      warnings: result.warnings,
    });
  }
}
