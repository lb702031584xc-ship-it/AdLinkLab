export {
  appLogger,
  drainRecentLogs,
  peekRecentLogs,
  setLogSink,
  redactLogFields,
  isSensitiveKey,
  REDACTED_VALUE,
  resolveLogDir,
  logFilePathFor,
  pruneOldLogFiles,
  enableFileSink,
  disableFileSink,
  LOG_FILE_RETENTION_DAYS,
} from "./logger.js";
export type { StructuredLogRecord, LogLevel } from "./logger.js";
export {
  recordErrorReport,
  shouldRecordError,
  isWithinDedupWindow,
  errorDedupKey,
  ERROR_REPORT_DEDUP_WINDOW_MS,
  MAX_ERROR_MESSAGE_LENGTH,
} from "./error-reports.js";
export type {
  ErrorReportInput,
  ErrorReportStore,
} from "./error-reports.js";
export {
  REQUEST_ID_HEADER,
  MAX_REQUEST_ID_LENGTH,
  resolveRequestId,
  sanitizeRequestId,
} from "./request-id.js";
export { httpMetrics, normalizeRoute } from "./metrics.js";
export { evaluateReadiness } from "./readiness.js";
export type { ReadinessResult, ReadinessCheck, DependencyStatus } from "./readiness.js";
export {
  registerObservability,
  createObservabilityErrorHandler,
} from "./http-hooks.js";
export type { ObservabilityOptions } from "./http-hooks.js";
