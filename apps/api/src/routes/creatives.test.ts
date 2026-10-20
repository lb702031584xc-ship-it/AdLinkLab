/**
 * 创意管理库输入校验与序列化测试（纯函数，不打 DB）。
 */
import { describe, expect, it } from "vitest";
import { parseCreativeBody, serializeCreative } from "./creatives.js";

describe("parseCreativeBody", () => {
  it("创建：标题/描述必填并限长", () => {
    expect(() =>
      parseCreativeBody({ description: "d" }, false)
    ).toThrow();
    expect(() => parseCreativeBody({ title: "t" }, false)).toThrow();
    expect(() =>
      parseCreativeBody({ title: "x".repeat(201), description: "d" }, false)
    ).toThrow();
    expect(parseCreativeBody({ title: "t", description: "d" }, false)).toMatchObject({
      title: "t",
      description: "d",
    });
  });

  it("部分更新：空 body 合法，非法 status 拒绝", () => {
    expect(parseCreativeBody({}, true)).toEqual({});
    expect(() =>
      parseCreativeBody({ status: "RUNNING" }, true)
    ).toThrow();
    expect(parseCreativeBody({ status: "USED" }, true).status).toBe("USED");
  });

  it("finalUrl 必须是 http(s)；非法 URL 拒绝", () => {
    expect(() =>
      parseCreativeBody(
        { title: "t", description: "d", finalUrl: "ftp://x" },
        false
      )
    ).toThrow();
    expect(
      parseCreativeBody(
        { title: "t", description: "d", finalUrl: "https://x.com" },
        false
      ).finalUrl
    ).toBe("https://x.com");
  });
});

describe("serializeCreative", () => {
  it("输出扁平字段 + offerName", () => {
    const row = {
      id: "1",
      tenantId: "t1",
      offerId: "o1",
      title: "T",
      description: "D",
      finalUrl: null,
      angle: "低价",
      status: "DRAFT",
      source: "MANUAL",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      offer: { name: "Offer A" },
    };
    expect(serializeCreative(row)).toMatchObject({
      id: "1",
      offerId: "o1",
      offerName: "Offer A",
      title: "T",
      status: "DRAFT",
    });
  });
});
