import type { RetryConfig } from "./types";

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isTransientHttpStatus(status: number | null | undefined): boolean {
  if (!status) return false;
  return TRANSIENT_HTTP_STATUSES.has(status);
}

export function isTransientErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  const patterns = [
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "etimedout",
    "enotfound",
    "net::",
    "network",
    "connection",
    "navigation",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway",
    "500 internal",
    "429",
    "too many requests",
    "target closed",
  ];
  return patterns.some((p) => lower.includes(p));
}

export function parseRetryAfterMs(retryAfterHeader: string | null | undefined): number | null {
  if (!retryAfterHeader) return null;
  const trimmed = retryAfterHeader.trim();

  // Numeric seconds
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

export function computeRetryDelayMs(
  attempt: number,
  config: RetryConfig,
  retryAfterHeader?: string | null,
  randomFn: () => number = Math.random
): number {
  const serverDelay = parseRetryAfterMs(retryAfterHeader);
  if (serverDelay !== null) {
    return Math.min(Math.max(serverDelay, config.baseDelayMs), config.maxDelayMs);
  }

  const expDelay = config.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(expDelay, config.maxDelayMs);
  // Full/equal jitter: 50% to 100% of capped exponential delay
  const jittered = Math.round(capped * (0.5 + 0.5 * randomFn()));
  return Math.max(250, jittered);
}

export function canRetry(
  attempts: number,
  firstAttemptAtMs: number,
  nowMs: number,
  config: RetryConfig
): { allowed: boolean; reason?: string } {
  if (attempts >= config.maxRetries) {
    return {
      allowed: false,
      reason: `Maximum retry count (${config.maxRetries}) reached.`,
    };
  }

  const elapsedSeconds = (nowMs - firstAttemptAtMs) / 1000;
  if (elapsedSeconds >= config.maxRetryDurationSeconds) {
    return {
      allowed: false,
      reason: `Maximum retry duration (${config.maxRetryDurationSeconds}s) exceeded.`,
    };
  }

  return { allowed: true };
}
