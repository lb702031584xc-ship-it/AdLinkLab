import { describe, expect, it, vi } from "vitest";
import {
  errorDedupKey,
  isWithinDedupWindow,
  recordErrorReport,
  shouldRecordError,
  type ErrorReportStore,
} from "./error-reports.js";

function fakeStore(
  existing: { id: string; lastSeenAt: Date } | null = null,
  opts: { failOn?: "find" | "update" | "create" } = {}
): ErrorReportStore & {
  findFirst: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn(async () => existing);
  if (opts.failOn === "find") {
    findFirst.mockRejectedValueOnce(new Error("db down"));
  }
  const update = vi.fn(async () => ({}));
  if (opts.failOn === "update") {
    update.mockRejectedValueOnce(new Error("db down"));
  }
  const create = vi.fn(async () => ({}));
  if (opts.failOn === "create") {
    create.mockRejectedValueOnce(new Error("db down"));
  }
  return {
    errorReport: { findFirst, update, create },
    findFirst,
    update,
    create,
  };
}

describe("shouldRecordError", () => {
  it("仅 5xx 上报", () => {
    expect(shouldRecordError(500)).toBe(true);
    expect(shouldRecordError(503)).toBe(true);
    expect(shouldRecordError(499)).toBe(false);
    expect(shouldRecordError(429)).toBe(false);
    expect(shouldRecordError(404)).toBe(false);
  });
});

describe("isWithinDedupWindow", () => {
  it("1 小时内命中，超过则不命中", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    expect(
      isWithinDedupWindow(new Date("2026-10-17T11:30:00.000Z"), now)
    ).toBe(true);
    expect(
      isWithinDedupWindow(new Date("2026-10-17T10:59:59.000Z"), now)
    ).toBe(false);
  });
});

describe("errorDedupKey", () => {
  it("message + path + statusCode 决定分组", () => {
    const a = errorDedupKey({ message: "boom", path: "/x", statusCode: 500 });
    const b = errorDedupKey({ message: "boom", path: "/y", statusCode: 500 });
    const c = errorDedupKey({ message: "boom", path: "/x", statusCode: 502 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(errorDedupKey({ message: "boom", path: "/x", statusCode: 500 }));
  });
});

describe("recordErrorReport", () => {
  const base = {
    tenantId: "t1",
    level: "error",
    message: "boom",
    requestId: "r1",
    path: "/api/v1/ai/analyze",
    method: "POST",
    statusCode: 500,
  };
  const now = new Date("2026-10-17T12:00:00.000Z");

  it("无命中 → 新建，count=1", async () => {
    const store = fakeStore(null);
    await recordErrorReport(store, base, now);
    expect(store.create).toHaveBeenCalledOnce();
    expect(store.update).not.toHaveBeenCalled();
    const data = store.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.count).toBe(1);
    expect(data.data.message).toBe("boom");
    expect(data.data.firstSeenAt).toEqual(now);
  });

  it("1 小时内命中 → count+1、lastSeenAt=now，不新建", async () => {
    const store = fakeStore({
      id: "e1",
      lastSeenAt: new Date("2026-10-17T11:30:00.000Z"),
    });
    await recordErrorReport(store, base, now);
    expect(store.update).toHaveBeenCalledOnce();
    expect(store.create).not.toHaveBeenCalled();
    const args = store.update.mock.calls[0][0] as {
      where: { id: string };
      data: { count: { increment: number }; lastSeenAt: Date };
    };
    expect(args.where.id).toBe("e1");
    expect(args.data.count).toEqual({ increment: 1 });
    expect(args.data.lastSeenAt).toEqual(now);
  });

  it("命中行超过 1 小时 → 新建（findFirst 的 where 已含窗口条件，这里验证不 update）", async () => {
    const store = fakeStore(null);
    await recordErrorReport(store, base, now);
    const args = store.findFirst.mock.calls[0][0] as {
      where: { lastSeenAt: { gte: Date } };
    };
    expect(args.where.lastSeenAt.gte).toEqual(
      new Date("2026-10-17T11:00:00.000Z")
    );
    expect(store.create).toHaveBeenCalledOnce();
  });

  it("非 5xx 直接返回，不查库", async () => {
    const store = fakeStore(null);
    await recordErrorReport(store, { ...base, statusCode: 400 }, now);
    expect(store.findFirst).not.toHaveBeenCalled();
  });

  it("DB 故障不抛错（best-effort）", async () => {
    const store = fakeStore(null, { failOn: "find" });
    await expect(recordErrorReport(store, base, now)).resolves.toBeUndefined();
    const store2 = fakeStore(
      { id: "e1", lastSeenAt: now },
      { failOn: "update" }
    );
    await expect(recordErrorReport(store2, base, now)).resolves.toBeUndefined();
  });

  it("message 超长截断到 500 字符", async () => {
    const store = fakeStore(null);
    await recordErrorReport(store, { ...base, message: "x".repeat(600) }, now);
    const data = store.create.mock.calls[0][0] as { data: { message: string } };
    expect(data.data.message).toHaveLength(500);
  });
});
