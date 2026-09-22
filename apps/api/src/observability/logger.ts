/**
 * Phase 9.3 — Minimal structured JSON logger (single source).
 * Never log Authorization, API keys, tokens, pepper, DATABASE_URL, or bodies.
 */
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

function emit(level: LogLevel, fields: StructuredLogFields): void {
  const record: StructuredLogRecord = {
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  };
  recent.push(record);
  if (recent.length > MAX_RECENT) recent.shift();
  extraSink?.(record);
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
