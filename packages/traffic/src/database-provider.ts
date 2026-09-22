import type { ClickRepository } from "@adlinklab/domain";
import { randomUUID } from "node:crypto";
import type { TrafficEvent, TrafficEventResult, TrafficProvider } from "./provider.js";

/**
 * Persists click events via ClickRepository (no Prisma import here).
 */
export class DatabaseTrafficProvider implements TrafficProvider {
  constructor(private readonly clicks: ClickRepository) {}

  async recordClick(input: TrafficEvent): Promise<TrafficEventResult> {
    const id = randomUUID();
    const click = await this.clicks.create({
      id,
      clickId: id,
      tenantId: input.tenantId,
      trackingLinkId: input.trackingLinkId,
      gclid: input.gclid,
      gbraid: input.gbraid,
      wbraid: input.wbraid,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      referer: input.referer,
      country: input.country,
      region: input.region,
      city: input.city,
      deviceType: input.deviceType,
      occurredAt: new Date(),
    });

    return {
      clickId: click.clickId,
      accepted: true,
      message: "Click persisted via repository",
    };
  }
}
