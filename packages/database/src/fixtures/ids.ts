/**
 * Phase 1.3 — Deterministic fixture identities.
 * Never use Math.random / Date.now / crypto.randomUUID for fixture IDs.
 */

export const FIXTURE_NOW = new Date("2026-01-01T00:00:00.000Z");
export const FIXTURE_T1 = new Date("2026-01-01T01:00:00.000Z");
export const FIXTURE_T2 = new Date("2026-01-01T02:00:00.000Z");
export const FIXTURE_T3 = new Date("2026-01-01T03:00:00.000Z");

/** Tenant A — primary research dataset (backward-compatible with Phase 0–1.2 IDs) */
export const TenantA = {
  id: "00000000-0000-4000-8000-000000000001",
  user: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  account: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  campaignA: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  campaignB: "cccccccc-cccc-cccc-cccc-cccccccccc01",
  adGroupA1: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  adGroupA2: "dddddddd-dddd-dddd-dddd-dddddddddd01",
  adGroupB1: "dddddddd-dddd-dddd-dddd-dddddddddd02",
  adA1: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  adA1b: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01",
  adA2: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02",
  adB1: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03",
  critA1: "99999999-9999-4999-8999-999999999999",
  critA1b: "99999999-9999-4999-8999-999999999901",
  critA2: "99999999-9999-4999-8999-999999999902",
  critB1: "99999999-9999-4999-8999-999999999903",
  offerA: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  offerB: "ffffffff-ffff-ffff-ffff-ffffffffff01",
  landingA: "11111111-1111-4111-8111-111111111111",
  landingB: "11111111-1111-4111-8111-111111111101",
  trackingA: "22222222-2222-4222-8222-222222222222",
  trackingB: "22222222-2222-4222-8222-222222222201",
  trackingC: "22222222-2222-4222-8222-222222222202",
  click1: "33333333-3333-4333-8333-333333333333",
  click2: "33333333-3333-4333-8333-333333333301",
  click3: "33333333-3333-4333-8333-333333333302",
  conversion1: "44444444-4444-4444-8444-444444444444",
  conversion2: "44444444-4444-4444-8444-444444444401",
  order1: "55555555-5555-4555-8555-555555555555",
  order2: "55555555-5555-4555-8555-555555555501",
  urlCampaignV1: "66666666-6666-4666-8666-666666666660",
  urlCampaignV2: "66666666-6666-4666-8666-666666666661",
  urlAdV1: "66666666-6666-4666-8666-666666666666",
  urlAdV2: "66666666-6666-4666-8666-666666666667",
  urlAdDraftA2: "66666666-6666-4666-8666-666666666668",
  changeSucceeded: "a1111111-1111-4111-8111-111111111101",
  changeFailed: "a1111111-1111-4111-8111-111111111102",
  changeQueued: "a1111111-1111-4111-8111-111111111103",
  jobCompleted: "77777777-7777-4777-8777-777777777777",
  jobFailed: "77777777-7777-4777-8777-777777777701",
  jobPending: "77777777-7777-4777-8777-777777777702",
  auditTenant: "88888888-8888-4888-8888-888888888801",
  auditCampaign: "88888888-8888-4888-8888-888888888802",
  auditUrlActivated: "88888888-8888-4888-8888-888888888803",
  auditUrlSuperseded: "88888888-8888-4888-8888-888888888804",
  auditOrder: "88888888-8888-4888-8888-888888888805",
  auditSync: "88888888-8888-4888-8888-888888888806",
  /** @deprecated Phase 1.1 single audit id — kept as alias of auditTenant for compatibility */
  auditLegacy: "88888888-8888-4888-8888-888888888888",
} as const;

/** Tenant B — isolation partner */
export const TenantB = {
  id: "00000000-0000-4000-8000-000000000002",
  user: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
  account: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02",
  campaign: "cccccccc-cccc-cccc-cccc-cccccccccc02",
  adGroup: "dddddddd-dddd-dddd-dddd-dddddddddd10",
  ad: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10",
  criterion: "99999999-9999-4999-8999-999999999910",
  offer: "ffffffff-ffff-ffff-ffff-ffffffffff10",
  landing: "11111111-1111-4111-8111-111111111110",
  tracking: "22222222-2222-4222-8222-222222222210",
  click: "33333333-3333-4333-8333-333333333310",
  conversion: "44444444-4444-4444-8444-444444444410",
  order: "55555555-5555-4555-8555-555555555510",
  urlAdV1: "66666666-6666-4666-8666-666666666610",
  job: "77777777-7777-4777-8777-777777777710",
  audit: "88888888-8888-4888-8888-888888888810",
} as const;

export const MOCK_CUSTOMER_A = "mock-customer-001";
export const MOCK_CUSTOMER_B = "mock-customer-002";
