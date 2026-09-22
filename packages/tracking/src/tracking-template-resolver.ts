import type { HierarchyUrlLevel } from "./hierarchy-resolver.js";

/**
 * Selects the most specific tracking template in the hierarchy.
 */
export class TrackingTemplateResolver {
  resolve(levels: HierarchyUrlLevel[]): string | undefined {
    let template: string | undefined;
    for (const level of levels) {
      if (level.config.trackingTemplate) {
        template = level.config.trackingTemplate;
      }
    }
    return template;
  }
}
