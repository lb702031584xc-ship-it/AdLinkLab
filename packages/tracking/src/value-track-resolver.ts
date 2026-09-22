export interface ValueTrackContext {
  campaignId?: string;
  adGroupId?: string;
  creativeId?: string;
  keyword?: string;
  device?: string;
  matchType?: string;
  network?: string;
  gclid?: string;
  /** Extra ValueTrack / custom placeholders */
  extras?: Record<string, string>;
}

/**
 * Expands supported Google Ads ValueTrack parameters.
 * Does not invent or spoof traffic metadata — only substitutes provided context values.
 */
export class ValueTrackResolver {
  private readonly supported = [
    "campaignid",
    "adgroupid",
    "creative",
    "keyword",
    "device",
    "matchtype",
    "network",
    "gclid",
  ] as const;

  expand(template: string, context: ValueTrackContext): string {
    const map: Record<string, string> = {
      campaignid: context.campaignId ?? "",
      adgroupid: context.adGroupId ?? "",
      creative: context.creativeId ?? "",
      keyword: context.keyword ?? "",
      device: context.device ?? "",
      matchtype: context.matchType ?? "",
      network: context.network ?? "",
      gclid: context.gclid ?? "",
      ...(context.extras ?? {}),
    };

    let result = template;
    for (const key of Object.keys(map)) {
      result = result.replaceAll(`{${key}}`, map[key] ?? "");
    }

    // Leave unsupported placeholders intact for transparency.
    void this.supported;
    return result;
  }

  listSupported(): readonly string[] {
    return this.supported;
  }
}
