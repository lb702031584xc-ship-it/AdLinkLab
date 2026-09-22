import { CustomParameterResolver } from "./custom-parameter-resolver.js";
import { FinalUrlResolver } from "./final-url-resolver.js";
import {
  HierarchyResolver,
  type HierarchyResolveInput,
  type HierarchyUrlLevel,
} from "./hierarchy-resolver.js";
import { TrackingTemplateResolver } from "./tracking-template-resolver.js";
import {
  ValueTrackResolver,
  type ValueTrackContext,
} from "./value-track-resolver.js";

export interface ServingUrlResolveInput extends HierarchyResolveInput {
  clickId?: string;
  device?: "desktop" | "mobile" | "tablet" | "unknown";
  valueTrack?: ValueTrackContext;
  /** Extra custom parameter overrides at serve time */
  customParameterOverrides?: Record<string, string>;
}

export interface ResolvedServingUrl {
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters: Record<string, string>;
  servingUrl: string;
  hierarchyChain: string[];
  usedMobileUrl: boolean;
}

/**
 * Orchestrates the full serving URL resolution algorithm:
 * 1. Resolve entity hierarchy
 * 2. Resolve final URL
 * 3. Resolve final mobile URL if applicable
 * 4. Resolve custom parameters
 * 5. Expand supported ValueTrack parameters
 * 6. Resolve tracking template
 * 7. Resolve {lpurl}
 * 8. Produce final serving URL
 *
 * No cloaking / destination hiding / detection bypass.
 */
export class ServingUrlResolver {
  private readonly hierarchy = new HierarchyResolver();
  private readonly finalUrls = new FinalUrlResolver();
  private readonly customParams = new CustomParameterResolver();
  private readonly valueTrack = new ValueTrackResolver();
  private readonly trackingTemplates = new TrackingTemplateResolver();

  resolveServingUrl(input: ServingUrlResolveInput): ResolvedServingUrl {
    // 1. Resolve entity hierarchy
    const hierarchy = this.hierarchy.resolve(input);
    const levels: HierarchyUrlLevel[] = hierarchy.levels;

    // 2–3. Resolve final URL (+ mobile / app)
    const finals = this.finalUrls.resolve(levels);
    const usedMobileUrl =
      input.device === "mobile" && Boolean(finals.finalMobileUrl);
    const effectiveFinalUrl = usedMobileUrl
      ? finals.finalMobileUrl!
      : finals.finalUrl;

    // 4. Resolve custom parameters (inheritance + overrides)
    let customParameters = this.customParams.resolveFromHierarchy(levels);
    customParameters = this.customParams.resolveWithOverrides(
      customParameters,
      input.customParameterOverrides
    );
    if (input.clickId && !customParameters._clickid) {
      customParameters = { ...customParameters, _clickid: input.clickId };
    }

    // 5–6. Resolve tracking template + ValueTrack expansion
    let trackingTemplate = this.trackingTemplates.resolve(levels);
    if (trackingTemplate) {
      trackingTemplate = this.valueTrack.expand(trackingTemplate, {
        ...input.valueTrack,
        device: input.valueTrack?.device ?? input.device,
        extras: {
          ...input.valueTrack?.extras,
          ...Object.fromEntries(
            Object.entries(customParameters).map(([k, v]) => [
              k.startsWith("_") ? k : `_${k}`,
              v,
            ])
          ),
          _clickid: customParameters._clickid ?? "",
        },
      });
    }

    // 7–8. Resolve {lpurl} / custom params → serving URL
    let servingUrl = effectiveFinalUrl;
    if (trackingTemplate) {
      servingUrl = trackingTemplate.replaceAll(
        "{lpurl}",
        encodeURIComponent(effectiveFinalUrl)
      );
      for (const [key, value] of Object.entries(customParameters)) {
        servingUrl = servingUrl.replaceAll(`{${key}}`, value);
        if (!key.startsWith("_")) {
          servingUrl = servingUrl.replaceAll(`{_${key}}`, value);
        }
      }
    }

    return {
      finalUrl: finals.finalUrl,
      finalMobileUrl: finals.finalMobileUrl,
      finalAppUrl: finals.finalAppUrl,
      trackingTemplate: this.trackingTemplates.resolve(levels),
      customParameters,
      servingUrl,
      hierarchyChain: hierarchy.chain,
      usedMobileUrl,
    };
  }
}
