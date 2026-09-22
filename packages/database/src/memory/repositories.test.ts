import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories } from "./repositories.js";

describe("seeded memory repositories", () => {
  it("returns seeded tenant, campaigns and url versions", async () => {
    const repos = createSeededMemoryRepositories();
    const tenant = await repos.tenants.findById("00000000-0000-4000-8000-000000000001");
    expect(tenant?.slug).toBe("adlinklab-research");
    expect(tenant?.status).toBe("ACTIVE");

    const campaigns = await repos.campaigns.list({
      tenantId: "00000000-0000-4000-8000-000000000001",
    });
    expect(campaigns.total).toBe(2);
    expect(campaigns.items[0]?.status).toBe("ACTIVE");
    expect(campaigns.items[0]?.tenantId).toBe(tenant?.id);

    const versions = await repos.urlVersions.listByAdId(
      "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    );
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.version === 1)?.status).toBe("SUPERSEDED");
    expect(versions.find((v) => v.version === 2)?.status).toBe("ACTIVE");
    expect(versions.find((v) => v.version === 1)?.customParameters._clickid).toBe(
      "abc123"
    );

    const order = await repos.orders.findByOrderId("ORDER-001", tenant!.id);
    expect(order?.value).toBe("49.9900");
    expect(order?.status).toBe("CONFIRMED");
  });
});
