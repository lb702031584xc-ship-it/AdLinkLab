/**
 * OCR 单测：正则提取（模拟 OCR 文本，中英、缺失字段）、失败路径。
 * tesseract 本体不做真实识别（用 recognizeImpl 注入）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  extractMetricsFromText,
  ocrImageMetrics,
  OcrError,
  OcrError,
} from "./ocr.js";

describe("extractMetricsFromText", () => {
  it("亚马逊英文截图文本", () => {
    const r = extractMetricsFromText(`
      4.6 out of 5
      12,834 ratings
      $29.99
      3,000+ bought in past month
    `);
    expect(r).toMatchObject({
      rating: 4.6,
      reviewCount: 12834,
      price: 29.99,
      currency: "USD",
      soldCount: 3000,
    });
  });

  it("reviews 写法", () => {
    const r = extractMetricsFromText("4.3 out of 5\n2,345 reviews\n$49.95");
    expect(r.reviewCount).toBe(2345);
    expect(r.rating).toBe(4.3);
  });

  it("缺失字段 → null（不硬猜）", () => {
    const r = extractMetricsFromText("some random text without numbers");
    expect(r).toMatchObject({
      rating: null,
      reviewCount: null,
      price: null,
      currency: null,
      soldCount: null,
    });
  });

  it("非法评分（>5）不采信", () => {
    const r = extractMetricsFromText("9.9 out of 5");
    expect(r.rating).toBe(null);
  });

  it("中文混排文本", () => {
    const r = extractMetricsFromText("评分 4.8 out of 5，1,234 ratings，$19.99");
    expect(r.rating).toBe(4.8);
    expect(r.reviewCount).toBe(1234);
    expect(r.price).toBe(19.99);
  });
});

describe("ocrImageMetrics", () => {
  it("注入识别结果 → 提取 + needsReview", async () => {
    const r = await ocrImageMetrics(Buffer.from("fake"), {
      recognizeImpl: async () => ({
        text: "4.5 out of 5\n999 ratings\n$10.99",
        confidence: 87,
      }),
    });
    expect(r.rating).toBe(4.5);
    expect(r.reviewCount).toBe(999);
    expect(r.confidence).toBe(87);
    expect(r.needsReview).toBe(true);
  });

  it("识别抛错 → OcrError（422，不抛 500）", async () => {
    const recognizeImpl = vi.fn(async () => {
      throw new Error("worker crashed");
    });
    await expect(
      ocrImageMetrics(Buffer.from("fake"), { recognizeImpl })
    ).rejects.toMatchObject({ name: "OcrError", statusCode: 422 });
  });

  it("无文字 → OcrError 422", async () => {
    await expect(
      ocrImageMetrics(Buffer.from("fake"), {
        recognizeImpl: async () => ({ text: "   ", confidence: null }),
      })
    ).rejects.toBeInstanceOf(OcrError);
  });

  it("空 buffer → OcrError", async () => {
    await expect(ocrImageMetrics(Buffer.alloc(0))).rejects.toBeInstanceOf(OcrError);
  });
});

describe("ocrImageText", () => {
  it("返回识别全文与置信度", async () => {
    const { ocrImageText } = await import("./ocr.js");
    const r = await ocrImageText(Buffer.from("fake"), {
      recognizeImpl: async () => ({ text: "NordVPN $65.88", confidence: 90 }),
    });
    expect(r.text).toBe("NordVPN $65.88");
    expect(r.confidence).toBe(90);
  });

  it("无文字 → OcrError", async () => {
    const { ocrImageText } = await import("./ocr.js");
    await expect(
      ocrImageText(Buffer.from("fake"), {
        recognizeImpl: async () => ({ text: "   ", confidence: null }),
      })
    ).rejects.toBeInstanceOf(OcrError);
  });
});

describe("extractNetworkMetricsFromText", () => {
  it("网络后台英文截图文本", async () => {
    const { extractNetworkMetricsFromText } = await import("./ocr.js");
    const r = extractNetworkMetricsFromText(`
      Offer Details
      EPC $1.25
      Conversion Rate 2.5%
      Clicks 12,345
      Commission: 13%
      Est. Payout: $23.4
    `);
    expect(r.epc).toBe(1.25);
    expect(r.conversionRate).toBe(2.5);
    expect(r.clicks).toBe(12345);
  });

  it("Est. Payout 不当 EPC（页面只有 payout 时 epc 为 null）", async () => {
    const { extractNetworkMetricsFromText } = await import("./ocr.js");
    const r = extractNetworkMetricsFromText(`
      Commission: 13%
      Est. Payout: $23.4
    `);
    expect(r.epc).toBeNull();
    expect(r.conversionRate).toBeNull();
  });

  it("缺失字段 → null，不抛错", async () => {
    const { extractNetworkMetricsFromText } = await import("./ocr.js");
    const r = extractNetworkMetricsFromText(`Some random dashboard text`);
    expect(r).toEqual({ epc: null, conversionRate: null, clicks: null });
  });
});
