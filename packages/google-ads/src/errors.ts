import { AppError } from "@adlinklab/shared";

/**
 * Stable provider error codes — never leak Google SDK exception types to domain.
 */
export type GoogleAdsErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "INVALID_ARGUMENT"
  | "TEMPORARY_ERROR"
  | "NOT_IMPLEMENTED"
  | "PROVIDER_ERROR";

export function isRetryableGoogleAdsCode(code: GoogleAdsErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "TEMPORARY_ERROR";
}

export class GoogleAdsProviderError extends AppError {
  readonly googleCode: GoogleAdsErrorCode;
  readonly retryable: boolean;
  readonly externalCode?: string;

  constructor(
    message: string,
    options: {
      code: GoogleAdsErrorCode;
      retryable?: boolean;
      externalCode?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    }
  ) {
    const retryable =
      options.retryable ?? isRetryableGoogleAdsCode(options.code);
    super(message, {
      code: `GOOGLE_ADS_${options.code}`,
      statusCode: statusForCode(options.code),
      details: {
        ...options.details,
        retryable,
        externalCode: options.externalCode,
      },
      cause: options.cause,
    });
    this.name = "GoogleAdsProviderError";
    this.googleCode = options.code;
    this.retryable = retryable;
    this.externalCode = options.externalCode;
  }
}

function statusForCode(code: GoogleAdsErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "UNAUTHORIZED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "INVALID_ARGUMENT":
      return 400;
    case "NOT_IMPLEMENTED":
      return 501;
    case "TEMPORARY_ERROR":
    case "PROVIDER_ERROR":
    default:
      return 503;
  }
}

/** Classify any thrown value into retryable / non-retryable for callers. */
export function classifyGoogleAdsError(error: unknown): {
  retryable: boolean;
  code?: GoogleAdsErrorCode;
} {
  if (error instanceof GoogleAdsProviderError) {
    return { retryable: error.retryable, code: error.googleCode };
  }
  return { retryable: false };
}
