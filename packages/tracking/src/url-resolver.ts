import { ServingUrlResolver } from "./serving-url-resolver.js";

export interface UrlResolveInput {
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters?: Record<string, string>;
  clickId?: string;
}

export interface ResolvedUrls {
  finalUrl: string;
  trackingTemplate?: string;
  customParameters: Record<string, string>;
  resolvedTrackingUrl?: string;
}

/**
 * Phase 0 compatibility facade over ServingUrlResolver for single-level inputs.
 * Prefer ServingUrlResolver.resolveServingUrl for hierarchy-aware resolution.
 */
export class UrlResolver {
  private readonly serving = new ServingUrlResolver();

  resolveFinalUrl(input: UrlResolveInput): string {
    return input.finalUrl;
  }

  resolveTrackingTemplate(input: UrlResolveInput): string | undefined {
    return input.trackingTemplate;
  }

  resolveCustomParameters(input: UrlResolveInput): Record<string, string> {
    const params = { ...(input.customParameters ?? {}) };
    if (input.clickId && !params._clickid) {
      params._clickid = input.clickId;
    }
    return params;
  }

  resolve(input: UrlResolveInput): ResolvedUrls {
    const result = this.serving.resolveServingUrl({
      levels: [
        {
          entityType: "AD",
          entityId: "legacy",
          config: {
            finalUrl: input.finalUrl,
            finalMobileUrl: input.finalMobileUrl,
            finalAppUrl: input.finalAppUrl,
            trackingTemplate: input.trackingTemplate,
            customParameters: input.customParameters ?? {},
          },
        },
      ],
      clickId: input.clickId,
    });

    return {
      finalUrl: result.finalUrl,
      trackingTemplate: result.trackingTemplate,
      customParameters: result.customParameters,
      resolvedTrackingUrl: result.trackingTemplate
        ? result.servingUrl
        : undefined,
    };
  }
}

export * from "./hierarchy-resolver.js";
export * from "./custom-parameter-resolver.js";
export * from "./value-track-resolver.js";
export * from "./final-url-resolver.js";
export * from "./tracking-template-resolver.js";
export * from "./serving-url-resolver.js";
