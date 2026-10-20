/**
 * Terms prompt: brand bidding / direct linking "silence = allowed".
 * Other traffic types keep the conservative silence = unknown rule (prompt-side).
 */
import { describe, expect, it } from "vitest";
import {
  buildTermsPrompt,
  TERMS_BRAND_BIDDING_LEXICON,
  validateTermsShape,
} from "./prompts.js";

function baseTerms(overrides: Record<string, unknown> = {}) {
  return {
    overallVerdict: "go",
    traffic: {
      search: "allowed",
      display: "unknown",
      email: "unknown",
      social: "unknown",
      incentivized: "unknown",
    },
    brandBidding: "allowed",
    brandBiddingBasis: "silence",
    directLinking: "allowed",
    directLinkingBasis: "silence",
    geoRestrictions: [],
    caps: null,
    payoutTerms: null,
    redFlags: [],
    summary: "Terms allow paid search.",
    ...overrides,
  };
}

describe("buildTermsPrompt brand/direct silence rule", () => {
  it("instructs silence = allowed with basis silence for brandBidding/directLinking only", () => {
    const { system } = buildTermsPrompt("Some terms.", "zh");
    expect(system).toContain("silence means \"allowed\" with basis \"silence\"");
    expect(system).toContain(
      "For brandBidding and directLinking ONLY: silence is NOT a red flag"
    );
    expect(system).toContain("does NOT block \"go\"");
    // The conservative rule still applies to the other traffic types.
    expect(system).toContain("NEVER invent \"allowed\"");
  });
});

describe("#11 TERMS_BRAND_BIDDING_LEXICON（品牌竞价条款词库）", () => {
  it("包含 CJ / SAS / 通用标题措辞", () => {
    for (const phrase of [
      "Protected SEM Bidding Keywords",
      "SEM Bidding",
      "Trademark Bidding",
      "PPC Keyword Rules",
      "Pay Per Click (PPC) Policy",
      "Brand Bidding",
      "Trademark Terms",
      "Search Marketing Policy",
      "Paid Search Restrictions",
    ]) {
      expect(TERMS_BRAND_BIDDING_LEXICON).toContain(phrase);
    }
  });

  it("词库进入 system prompt，且明示命中标题不等于禁止（unknown-on-ambiguity 不变）", () => {
    const { system } = buildTermsPrompt("Some terms.", "zh");
    expect(system).toContain("Protected SEM Bidding Keywords");
    expect(system).toContain("PPC Keyword Rules");
    expect(system).toContain("NEVER means forbidden");
    expect(system).toContain('use "unknown", not "forbidden"');
  });
});

describe("validateTermsShape basis fields", () => {
  it("silence → allowed + basis silence", () => {
    const out = validateTermsShape(baseTerms());
    expect(out.brandBidding).toBe("allowed");
    expect(out.brandBiddingBasis).toBe("silence");
    expect(out.directLinking).toBe("allowed");
    expect(out.directLinkingBasis).toBe("silence");
  });

  it("explicit allowance → allowed + basis explicit", () => {
    const out = validateTermsShape(
      baseTerms({ brandBiddingBasis: "explicit", directLinkingBasis: "explicit" })
    );
    expect(out.brandBiddingBasis).toBe("explicit");
    expect(out.directLinkingBasis).toBe("explicit");
  });

  it("forbidden → basis null even if the model sent one", () => {
    const out = validateTermsShape(
      baseTerms({
        brandBidding: "forbidden",
        brandBiddingBasis: "explicit",
        directLinking: "forbidden",
        directLinkingBasis: "silence",
      })
    );
    expect(out.brandBidding).toBe("forbidden");
    expect(out.brandBiddingBasis).toBeNull();
    expect(out.directLinkingBasis).toBeNull();
  });

  it("restricted / unknown → basis null", () => {
    const out = validateTermsShape(
      baseTerms({
        brandBidding: "restricted",
        brandBiddingBasis: "explicit",
        directLinking: "unknown",
        directLinkingBasis: "silence",
      })
    );
    expect(out.brandBiddingBasis).toBeNull();
    expect(out.directLinkingBasis).toBeNull();
  });

  it("missing basis defaults to null", () => {
    const input = baseTerms();
    delete input.brandBiddingBasis;
    delete input.directLinkingBasis;
    const out = validateTermsShape(input);
    expect(out.brandBiddingBasis).toBeNull();
    expect(out.directLinkingBasis).toBeNull();
  });

  it("invalid basis value defaults to null (lenient)", () => {
    const out = validateTermsShape(
      baseTerms({ brandBiddingBasis: "guessed", directLinkingBasis: 42 })
    );
    expect(out.brandBiddingBasis).toBeNull();
    expect(out.directLinkingBasis).toBeNull();
  });
});
