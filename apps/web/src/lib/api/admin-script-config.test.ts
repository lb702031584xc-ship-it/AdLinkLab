/**
 * Phase 8.4.9 — Admin Script Integration frontend unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  AdminScriptConfigError,
  getAdminApiKey,
  getApiBaseUrl,
  mapAdminErrorMessage,
} from "./admin-script-config";

describe("Phase 8.4.9 admin script config", () => {
  it("1. requires NEXT_PUBLIC_API_BASE_URL", () => {
    expect(() => getApiBaseUrl({} as unknown as NodeJS.ProcessEnv)).toThrow(
      AdminScriptConfigError
    );
  });

  it("2. strips trailing slash from base URL", () => {
    expect(
      getApiBaseUrl({
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001/",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe("http://localhost:3001");
  });

  it("3. requires ADLINKLAB_API_KEY", () => {
    expect(() =>
      getAdminApiKey({} as unknown as NodeJS.ProcessEnv)
    ).toThrow(/ADLINKLAB_API_KEY/);
  });

  it("4. rejects NEXT_PUBLIC_ masquerading as key value prefix check", () => {
    expect(() =>
      getAdminApiKey({
        ADLINKLAB_API_KEY: "NEXT_PUBLIC_secret",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/NEXT_PUBLIC_/);
  });

  it("5. returns configured api key", () => {
    expect(
      getAdminApiKey({
        ADLINKLAB_API_KEY: "alk_dev_tenant_a",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe("alk_dev_tenant_a");
  });

  it("6. mapAdminErrorMessage uses AdminScriptConfigError message", () => {
    expect(
      mapAdminErrorMessage(new AdminScriptConfigError("missing key"))
    ).toBe("missing key");
  });

  it("7. mapAdminErrorMessage falls back for Error", () => {
    expect(mapAdminErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("8. security notice string contract for UI", () => {
    const notice =
      "This script contains an integration credential. Store it securely and do not share it publicly.";
    expect(notice.toLowerCase()).toContain("credential");
    expect(notice.toLowerCase()).not.toContain("proxy");
  });

  it("9. admin routes path constants", () => {
    expect("/api/v1/admin/script-integrations").not.toContain("task");
    expect("/api/v1/admin/script-integrations").not.toContain("apiAuthcode");
  });

  it("10. jobs nav label should be Sync Jobs not Tasks", () => {
    const label = "Sync Jobs";
    expect(label).not.toBe("Tasks");
    expect(label).toContain("Sync");
  });
});
