/**
 * Lander Intel ③ — template library UI tests.
 * Presentational components rendered via renderToStaticMarkup with the
 * English dictionary (useDict falls back to English outside I18nProvider).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LanderTemplate } from "@/lib/api/lander";
import {
  TemplatesGallery,
  VariableFields,
  toPreviewVariables,
} from "@/components/ai/templates-client";

const TEMPLATES: LanderTemplate[] = [
  {
    id: "builtin-review",
    tenantId: null,
    name: "In-Depth Product Review",
    category: "review",
    description: "Rating card + pros/cons.",
    thumbnailUrl: null,
    isBuiltIn: true,
    variables: ["productName", "price", "pros", "ctaUrl"],
  },
  {
    id: "custom-1",
    tenantId: "t1",
    name: "My Quiz",
    category: "quiz",
    description: null,
    thumbnailUrl: null,
    isBuiltIn: false,
    variables: ["q1"],
  },
];

describe("TemplatesGallery", () => {
  it("renders template cards with name, category and built-in badge", () => {
    const html = renderToStaticMarkup(
      createElement(TemplatesGallery, {
        templates: TEMPLATES,
        selectedId: null,
        onSelect: () => {},
      })
    );
    expect(html).toContain("In-Depth Product Review");
    expect(html).toContain("Review");
    expect(html).toContain("Built-in");
    expect(html).toContain("My Quiz");
    expect(html).toContain("Custom");
  });

  it("highlights the selected card", () => {
    const html = renderToStaticMarkup(
      createElement(TemplatesGallery, {
        templates: TEMPLATES,
        selectedId: "builtin-review",
        onSelect: () => {},
      })
    );
    expect(html).toContain("ring-signal/30");
  });

  it("renders the empty state when there are no templates", () => {
    const html = renderToStaticMarkup(
      createElement(TemplatesGallery, {
        templates: [],
        selectedId: null,
        onSelect: () => {},
      })
    );
    expect(html).toContain("No templates in this category yet.");
  });

  it("falls back to the lander-new dict for coupon/guide category labels", () => {
    const couponTemplate: LanderTemplate = {
      id: "builtin-coupon",
      tenantId: null,
      name: "Coupon Deal Page",
      category: "coupon",
      description: null,
      thumbnailUrl: null,
      isBuiltIn: true,
      variables: ["couponCode"],
    };
    const html = renderToStaticMarkup(
      createElement(TemplatesGallery, {
        templates: [couponTemplate],
        selectedId: null,
        onSelect: () => {},
      })
    );
    // Outside I18nProvider the English dictionary is used.
    expect(html).toContain("Coupon");
    expect(html).toContain("Coupon Deal Page");
  });
});

describe("VariableFields", () => {
  it("renders a text input per scalar variable", () => {
    const html = renderToStaticMarkup(
      createElement(VariableFields, {
        variables: ["productName", "price"],
        values: { productName: "Shoes", price: "$9" },
        onChange: () => {},
      })
    );
    expect(html).toContain("{{productName}}");
    expect(html).toContain('value="Shoes"');
    expect(html).toContain("{{price}}");
    // 标准变量带可读名对照显示（英文词典下为英文名 + 代码名）。
    expect(html).toContain("Product name");
    expect(html).toContain("Price");
  });

  it("renders textareas for pros/cons/products with hints", () => {
    const html = renderToStaticMarkup(
      createElement(VariableFields, {
        variables: ["pros", "products"],
        values: { pros: "a\nb", products: "[]" },
        onChange: () => {},
      })
    );
    expect(html).toContain("{{pros}}");
    expect(html).toContain("One item per line");
    expect(html).toContain("{{products}}");
    expect(html).toContain("JSON array");
    expect(html).toContain("<textarea");
  });

  it("renders ctaUrl as a url input", () => {
    const html = renderToStaticMarkup(
      createElement(VariableFields, {
        variables: ["ctaUrl"],
        values: {},
        onChange: () => {},
      })
    );
    expect(html).toContain('type="url"');
  });
});

describe("toPreviewVariables", () => {
  it("splits pros/cons into one-per-line arrays", () => {
    const { variables, productsJsonError } = toPreviewVariables({
      productName: "Shoes",
      pros: "light\ncheap\n",
      cons: "",
    });
    expect(variables.productName).toBe("Shoes");
    expect(variables.pros).toEqual(["light", "cheap"]);
    expect(variables.cons).toEqual([]);
    expect(productsJsonError).toBe(false);
  });

  it("parses products JSON arrays", () => {
    const { variables, productsJsonError } = toPreviewVariables({
      products: '[{"name":"A","price":"$9"}]',
    });
    expect(productsJsonError).toBe(false);
    expect(variables.products).toEqual([{ name: "A", price: "$9" }]);
  });

  it("flags invalid products JSON", () => {
    expect(
      toPreviewVariables({ products: "not json" }).productsJsonError
    ).toBe(true);
    expect(
      toPreviewVariables({ products: '{"a":1}' }).productsJsonError
    ).toBe(true);
    const { productsJsonError } = toPreviewVariables({ products: "  " });
    expect(productsJsonError).toBe(false);
  });
});
