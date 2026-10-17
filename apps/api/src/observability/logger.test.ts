import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appLogger,
  disableFileSink,
  drainRecentLogs,
  enableFileSink,
  isSensitiveKey,
  logFilePathFor,
  pruneOldLogFiles,
  redactLogFields,
  REDACTED_VALUE,
} from "./logger.js";

afterEach(() => {
  disableFileSink();
  drainRecentLogs();
});

describe("isSensitiveKey / redactLogFields", () => {
  it("敏感键名命中（大小写/分隔符不敏感）", () => {
    for (const k of [
      "authorization",
      "Authorization",
      "apiKey",
      "api_key",
      "api-key",
      "x-api-key",
      "token",
      "accessToken",
      "password",
      "passwd",
      "secret",
      "clientSecret",
      "cookie",
      "sessionId",
      "bearer",
      "privateKey",
      "credentials",
    ]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
    for (const k of ["message", "path", "method", "statusCode", "model", "count"]) {
      expect(isSensitiveKey(k), k).toBe(false);
    }
  });

  it("敏感值输出 [REDACTED]，普通字段原样保留", () => {
    const out = redactLogFields({
      authorization: "Bearer abc",
      apiKey: "sk-123",
      token: "t",
      password: "p",
      cookie: "c",
      message: "hello",
      statusCode: 500,
    });
    expect(out.authorization).toBe(REDACTED_VALUE);
    expect(out.apiKey).toBe(REDACTED_VALUE);
    expect(out.token).toBe(REDACTED_VALUE);
    expect(out.password).toBe(REDACTED_VALUE);
    expect(out.cookie).toBe(REDACTED_VALUE);
    expect(out.message).toBe("hello");
    expect(out.statusCode).toBe(500);
  });

  it("嵌套对象同样脱敏，不改原对象", () => {
    const input = { headers: { authorization: "Bearer x", other: "keep" } };
    const out = redactLogFields(input) as {
      headers: { authorization: string; other: string };
    };
    expect(out.headers.authorization).toBe(REDACTED_VALUE);
    expect(out.headers.other).toBe("keep");
    expect(
      (input as { headers: { authorization: string } }).headers.authorization
    ).toBe("Bearer x");
  });
});

describe("file sink", () => {
  it("日志写 JSON 行到当日文件，且敏感值已脱敏", () => {
    const dir = mkdtempSync(join(tmpdir(), "adlinklab-logs-"));
    enableFileSink(dir);
    appLogger.info({ msg: "hello-file-sink", apiKey: "should-not-appear" });
    const file = logFilePathFor(new Date());
    // enableFileSink(dir) 覆盖了目录，logFilePathFor 用 env/override 解析：
    // 测试里 LOG_DIR 未设，override 生效，应落在 tmp 目录。
    expect(file.startsWith(dir)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(rec.msg).toBe("hello-file-sink");
    expect(rec.apiKey).toBe(REDACTED_VALUE);
    expect(JSON.stringify(rec)).not.toContain("should-not-appear");
  });

  it("内存 recent 同样脱敏", () => {
    appLogger.error({ msg: "x", token: "secret-token-value" });
    const [rec] = drainRecentLogs();
    expect(rec?.token).toBe(REDACTED_VALUE);
    expect(JSON.stringify(rec)).not.toContain("secret-token-value");
  });

  it("pruneOldLogFiles 只删 7 天前的文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "adlinklab-logs-"));
    enableFileSink(dir);
    const now = new Date("2026-10-17T12:00:00.000Z");
    writeFileSync(join(dir, "app-2000-01-01.log"), "old\n");
    writeFileSync(join(dir, "app-2026-10-16.log"), "recent\n");
    writeFileSync(join(dir, "notes.txt"), "keep\n");
    pruneOldLogFiles(now);
    const names = readdirSync(dir);
    expect(names).not.toContain("app-2000-01-01.log");
    expect(names).toContain("app-2026-10-16.log");
    expect(names).toContain("notes.txt");
  });
});
