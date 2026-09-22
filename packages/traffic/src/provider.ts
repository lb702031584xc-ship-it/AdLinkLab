export interface TrafficEvent {
  tenantId: string;
  trackingLinkId: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  userAgent?: string;
  ipAddress?: string;
  referer?: string;
  country?: string;
  region?: string;
  city?: string;
  deviceType?: string;
}

export interface TrafficEventResult {
  clickId: string;
  accepted: boolean;
  message?: string;
}

/**
 * Traffic provider abstraction for recording click events.
 * Simulator / Mock / Database implementations are interchangeable.
 * Does NOT forge traffic against third-party systems.
 */
export interface TrafficProvider {
  recordClick(input: TrafficEvent): Promise<TrafficEventResult>;
}
