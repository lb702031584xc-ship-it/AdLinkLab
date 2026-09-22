import type { UrlConfiguration, UrlEntityType } from "@adlinklab/domain";

export interface HierarchyUrlLevel {
  entityType: UrlEntityType;
  entityId: string;
  config: UrlConfiguration;
}

export interface HierarchyResolveInput {
  /** Ordered from most general (CUSTOMER) to most specific (leaf). */
  levels: HierarchyUrlLevel[];
  /** Leaf entity type being served (defaults to last level). */
  targetEntityType?: UrlEntityType;
}

export interface ResolvedHierarchy {
  levels: HierarchyUrlLevel[];
  target: HierarchyUrlLevel;
  chain: UrlEntityType[];
}

const ORDER: UrlEntityType[] = [
  "CUSTOMER",
  "CAMPAIGN",
  "AD_GROUP",
  "AD",
  "AD_GROUP_CRITERION",
];

/**
 * Resolves Google Ads URL hierarchy: Customer → Campaign → AdGroup → Ad → AdGroupCriterion.
 */
export class HierarchyResolver {
  resolve(input: HierarchyResolveInput): ResolvedHierarchy {
    if (input.levels.length === 0) {
      throw new Error("HierarchyResolver requires at least one level");
    }

    const sorted = [...input.levels].sort(
      (a, b) => ORDER.indexOf(a.entityType) - ORDER.indexOf(b.entityType)
    );

    const targetType = input.targetEntityType ?? sorted[sorted.length - 1]!.entityType;
    const target =
      sorted.find((l) => l.entityType === targetType) ?? sorted[sorted.length - 1]!;

    return {
      levels: sorted,
      target,
      chain: sorted.map((l) => l.entityType),
    };
  }
}
