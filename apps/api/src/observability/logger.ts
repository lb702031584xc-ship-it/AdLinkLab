/**
 * Phase 9.3 — Minimal structured JSON logger (single source).
 * Never log Authorization, API keys, tokens, pepper, DATABASE_URL, or bodies.
 *
 * P0-8 — 新增文件 sink：日志写 JSON 行到 LOG_DIR（默认 apps/api/logs），
 * 按日轮转（app-YYYY-MM-DD.log），保留最近 7 天；键名脱敏覆盖全部 sink。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export type LogLevel = "info" | "warn" | "error";

export type StructuredLogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface StructuredLogRecord extends StructuredLogFields {
  timestamp: string;
  level: LogLevel;
}

type LogSink = (record: StructuredLogRecord) => void;

const recent: StructuredLogRecord[] = [];
const MAX_RECENT = 200;
let extraSink: LogSink | undefined;

function shouldWriteConsole(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST || env.NODE_ENV === "test") return false;
  return true;
}

// ---------------------------------------------------------------------------
// P0-8 — 键名脱敏（沿用现有“禁记密钥”约定；请求体本来就不记）
// ---------------------------------------------------------------------------

export const REDACTED_VALUE = "[REDACTED]";

/**
 * 敏感键名：authorization / api key / token / password / secret / cookie 等。
 * 匹配时忽略大小写与分隔符（api_key / api-key / apiKey 都命中）。
 */
const SENSITIVE_KEY_RE =
  /(authori|api[-_ ]?key|apikey|token|password|passwd|secret|cookie|session|bearer|private[-_ ]?key|credential)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

function redactValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) return REDACTED_VALUE;
  if (Array.isArray(value)) {
    return value.map((v) =>
      typeof v === "object" && v !== null
        ? redactObject(v as Record<string, unknown>)
        : v
    );
  }
  if (typeof value === "object" && value !== null) {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

/** 对一条日志记录做键名脱敏（深拷贝，不改原对象）。 */
export function redactLogFields<T extends Record<string, unknown>>(
  fields: T
): T {
  return redactObject(fields) as T;
}

// ---------------------------------------------------------------------------
// P0-8 — 文件 sink：按日轮转，保留最近 7 天
// ---------------------------------------------------------------------------

/** 文件保留天数。 */
export const LOG_FILE_RETENTION_DAYS = 7;

let fileSinkEnabled = false;
let fileSinkDirOverride: string | undefined;
let currentLogDate = "";
let currentLogPath = "";

/**
 * 默认日志目录 = apps/api/logs。
 * 相对仓库根目录解析；若进程已在 apps/api 内运行（docker WORKDIR / 本地 cd），
 * 则为该目录下的 logs/，避免写出 apps/api/apps/api/logs。
 */
export function resolveLogDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOG_DIR && env.LOG_DIR.trim()) return resolve(env.LOG_DIR.trim());
  if (fileSinkDirOverride) return fileSinkDirOverride;
  const cwd = process.cwd();
  if (cwd.endsWith(`${sep}apps${sep}api`) || basename(cwd) === "api") {
    return join(cwd, "logs");
  }
  return join(cwd, "apps", "api", "logs");
}

export function logFilePathFor(date: Date, env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveLogDir(env), `app-${date.toISOString().slice(0, 10)}.log`);
}

/** 删除早于保留期的 app-YYYY-MM-DD.log（best-effort，失败不抛）。 */
export function pruneOldLogFiles(now: Date = new Date()): void {
  try {
    const dir = resolveLogDir();
    if (!existsSync(dir)) return;
    const cutoff = new Date(now.getTime());
    cutoff.setUTCDate(cutoff.getUTCDate() - LOG_FILE_RETENTION_DAYS);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    for (const name of readdirSync(dir)) {
      const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (!m) continue;
      if (m[1] < cutoffDay) {
        try {
          unlinkSync(join(dir, name));
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

/** 开启文件 sink（测试可传 tmp 目录；生产由模块加载时自动开启）。 */
export function enableFileSink(dir?: string): void {
  if (dir) fileSinkDirOverride = resolve(dir);
  fileSinkEnabled = true;
  currentLogDate = "";
  currentLogPath = "";
  try {
    mkdirSync(resolveLogDir(), { recursive: true });
    pruneOldLogFiles();
  } catch {
    /* best-effort */
  }
}

export function disableFileSink(): void {
  fileSinkEnabled = false;
  fileSinkDirOverride = undefined;
  currentLogDate = "";
  currentLogPath = "";
}

function writeFileSink(record: StructuredLogRecord): void {
  if (!fileSinkEnabled) return;
  try {
    const day = record.timestamp.slice(0, 10);
    if (day !== currentLogDate || !currentLogPath) {
      currentLogDate = day;
      currentLogPath = join(resolveLogDir(), `app-${day}.log`);
      mkdirSync(resolveLogDir(), { recursive: true });
      pruneOldLogFiles();
    }
    appendFileSync(currentLogPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    /* best-effort：磁盘满/权限问题不拖垮业务 */
  }
}

// 生产自动开启文件 sink；测试环境（VITEST/NODE_ENV=test）默认关闭，
// 测试用 enableFileSink(tmpdir) 显式开启，避免污染仓库。
if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
  try {
    enableFileSink();
  } catch {
    /* best-effort */
  }
}

function emit(level: LogLevel, fields: StructuredLogFields): void {
  const record: StructuredLogRecord = redactLogFields({
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  });
  recent.push(record);
  if (recent.length > MAX_RECENT) recent.shift();
  extraSink?.(record);
  writeFileSink(record);
  if (shouldWriteConsole()) {
    console.log(JSON.stringify(record));
  }
}

export const appLogger = {
  info(fields: StructuredLogFields): void {
    emit("info", fields);
  },
  warn(fields: StructuredLogFields): void {
    emit("warn", fields);
  },
  error(fields: StructuredLogFields): void {
    emit("error", fields);
  },
};

/** Test helper — capture structured logs without console noise. */
export function setLogSink(sink: LogSink | undefined): void {
  extraSink = sink;
}

export function drainRecentLogs(): StructuredLogRecord[] {
  const copy = [...recent];
  recent.length = 0;
  return copy;
}

export function peekRecentLogs(): readonly StructuredLogRecord[] {
  return recent;
}
