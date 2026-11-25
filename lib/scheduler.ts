import type { DatabaseSync } from "node:sqlite";
import { PREPARING_LEAD_SECONDS } from "./config";
import {
  addActivityLog,
  getEventsCache,
  getSettings,
  updateWorkerState,
} from "./database";
import {
  evaluatePreflight,
  executeBookingSubmission,
  type SubmissionResult,
} from "./portal/booking";
import type { PortalBrowserManager } from "./portal/browser";
import { checkPortalSession, fetchPortalEvents } from "./portal/session";
import {
  getJobById,
  listJobs,
  pauseAuthRequiredJobs,
  updateJob,
} from "./queue";
import { canRetry, computeRetryDelayMs } from "./retry";
import type { BookingJob, JobStatus, WsMessage } from "./types";

const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "Pending",
  "Scheduled",
  "Preparing",
  "Waiting for opening",
  "Processing",
  "Retrying",
]);

export type JobTimingPhase =
  | "inactive"
  | "paused"
  | "waiting_retry"
  | "window_closed"
  | "scheduled_future"
  | "preparing"
  | "ready";

export function classifyJobTiming(job: BookingJob, nowMs: number): JobTimingPhase {
  if (!ACTIVE_STATUSES.has(job.status)) return "inactive";
  if (job.isPaused) return "paused";

  if (job.status === "Retrying" && job.nextRetryAt) {
    const retryMs = Date.parse(job.nextRetryAt);
    if (!Number.isNaN(retryMs) && retryMs > nowMs) {
      return "waiting_retry";
    }
  }

  if (job.bookingWindowEnd) {
    const endMs = Date.parse(job.bookingWindowEnd);
    if (!Number.isNaN(endMs) && nowMs > endMs) {
      return "window_closed";
    }
  }

  if (job.bookingWindowStart) {
    const startMs = Date.parse(job.bookingWindowStart);
    if (!Number.isNaN(startMs)) {
      const prepareAtMs = startMs - PREPARING_LEAD_SECONDS * 1000;
      if (nowMs < prepareAtMs) return "scheduled_future";
      if (nowMs < startMs) return "preparing";
    }
  }

  return "ready";
}

export function computeNextWakeDelayMs(jobs: BookingJob[], nowMs: number): number {
  let minDelay = 2_000;

  for (const job of jobs) {
    const phase = classifyJobTiming(job, nowMs);
    if (phase === "ready") {
      return job.status === "Waiting for opening" ? 1_000 : 500;
    }
    if (phase === "preparing" && job.bookingWindowStart) {
      const startMs = Date.parse(job.bookingWindowStart);
      if (!Number.isNaN(startMs)) {
        minDelay = Math.min(minDelay, Math.max(250, startMs - nowMs));
      }
    }
    if (phase === "waiting_retry" && job.nextRetryAt) {
      const retryMs = Date.parse(job.nextRetryAt);
      if (!Number.isNaN(retryMs)) {
        minDelay = Math.min(minDelay, Math.max(250, retryMs - nowMs));
      }
    }
  }

  return Math.max(250, Math.min(minDelay, 2_000));
}

export interface SchedulerDeps {
  db: DatabaseSync;
  browserManager: PortalBrowserManager;
  broadcast?: (msg: WsMessage) => void;
  isBusyWithCommand?: () => boolean;
}

export class BookingScheduler {
  private readonly db: DatabaseSync;
  private readonly browserManager: PortalBrowserManager;
  private readonly broadcast?: (msg: WsMessage) => void;
  private readonly isBusyWithCommand?: () => boolean;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;
  private readonly retryStartTimes = new Map<string, number>();

  constructor(deps: SchedulerDeps) {
    this.db = deps.db;
    this.browserManager = deps.browserManager;
    this.broadcast = deps.broadcast;
    this.isBusyWithCommand = deps.isBusyWithCommand;
  }

  start(): void {
    this.stopped = false;
    this.scheduleNextTick(250);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emitLog(
    level: "info" | "warn" | "error" | "success",
    message: string,
    jobId: string | null = null,
    details: string | null = null
  ): void {
    const log = addActivityLog(this.db, level, message, jobId, details);
    this.broadcast?.({ type: "log_added", log });
  }

  private emitQueue(): void {
    this.broadcast?.({ type: "queue_updated", jobs: listJobs(this.db) });
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /**
   * Local scheduler tick: checks SQLite due jobs every 1-2s without generating
   * unnecessary external network traffic.
   */
  async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    if (this.isBusyWithCommand?.()) {
      this.scheduleNextTick(500);
      return;
    }

    this.ticking = true;
    try {
      const settings = getSettings(this.db);
      const jobs = listJobs(this.db);
      const nowMs = Date.now();

      if (settings.automationEnabled) {
        for (const job of jobs) {
          if (this.stopped || this.isBusyWithCommand?.()) break;
          const phase = classifyJobTiming(job, nowMs);

          if (phase === "window_closed") {
            const updated = updateJob(this.db, job.id, {
              status: "Failed",
              errorMessage: "Booking window closed before slot could be booked.",
              nextRetryAt: null,
            });
            this.emitLog(
              "error",
              `Booking window closed for '${job.title}'`,
              job.id
            );
            if (updated) {
              this.broadcast?.({
                type: "job_event",
                job: updated,
                eventType: "failed",
                message: updated.errorMessage || "Booking window closed.",
              });
            }
            this.emitQueue();
            this.retryStartTimes.delete(job.id);
            continue;
          }

          if (phase === "scheduled_future" && job.status !== "Scheduled") {
            updateJob(this.db, job.id, { status: "Scheduled" });
            this.emitQueue();
            continue;
          }

          if (phase === "preparing") {
            await this.prepareJob(job);
            continue;
          }

          if (phase === "ready") {
            await this.processJob(job);
          }
        }
      }

      const updatedJobs = listJobs(this.db);
      const nextDelay = computeNextWakeDelayMs(updatedJobs, Date.now());
      this.scheduleNextTick(nextDelay);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog("error", `Scheduler tick error: ${msg}`);
      this.scheduleNextTick(2_000);
    } finally {
      this.ticking = false;
    }
  }

  private async prepareJob(job: BookingJob): Promise<void> {
    const nowIso = new Date().toISOString();
    if (job.status === "Preparing" && job.lastCheckedAt) {
      const elapsed = Date.now() - Date.parse(job.lastCheckedAt);
      if (elapsed < 20_000) return;
    }

    updateJob(this.db, job.id, {
      status: "Preparing",
      lastCheckedAt: nowIso,
    });
    this.emitQueue();

    const context = await this.browserManager.ensureHeadlessContext();
    const session = await checkPortalSession(context);
    const workerState = updateWorkerState(this.db, {
      sessionState: session.state,
      sessionMessage: session.message,
      lastSessionCheckAt: nowIso,
    });
    this.broadcast?.({ type: "portal_status", workerState });

    if (session.state === "expired") {
      pauseAuthRequiredJobs(this.db, session.message);
      this.emitLog(
        "warn",
        `Authentication required before opening for '${job.title}'`,
        job.id
      );
      this.emitQueue();
    }
  }

  async processJob(job: BookingJob): Promise<void> {
    const freshJob = getJobById(this.db, job.id);
    if (!freshJob || freshJob.isPaused || !ACTIVE_STATUSES.has(freshJob.status)) {
      return;
    }

    const settings = getSettings(this.db);
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const context = await this.browserManager.ensureHeadlessContext();

    // Reuse fresh monitoring cache (< 2s old) if available, otherwise perform a single HTTP GET
    let events = [];
    const cache = getEventsCache(this.db);
    const cacheAgeMs = cache.fetchedAt ? nowMs - Date.parse(cache.fetchedAt) : Infinity;

    if (cacheAgeMs <= 2_000 && cache.events.length > 0) {
      events = cache.events;
    } else {
      const fetchRes = await fetchPortalEvents(context, {
        dateFrom: freshJob.date,
        dateTo: freshJob.date,
      });

      const workerState = updateWorkerState(this.db, {
        sessionState: fetchRes.sessionState,
        sessionMessage:
          fetchRes.errorMessage || "Portal session is active and authenticated.",
        lastSessionCheckAt: nowIso,
      });
      this.broadcast?.({ type: "portal_status", workerState });

      if (!fetchRes.ok) {
        if (fetchRes.sessionState === "expired") {
          pauseAuthRequiredJobs(
            this.db,
            fetchRes.errorMessage || "Session expired."
          );
          this.emitLog(
            "warn",
            fetchRes.errorMessage || "Session expired.",
            freshJob.id
          );
          const pausedJob = getJobById(this.db, freshJob.id);
          if (pausedJob) {
            this.broadcast?.({
              type: "job_event",
              job: pausedJob,
              eventType: "auth_required",
              message: pausedJob.errorMessage || "Authentication required.",
            });
          }
          this.emitQueue();
          this.retryStartTimes.delete(freshJob.id);
          return;
        }

        this.scheduleRetry(
          freshJob,
          fetchRes.errorMessage || "Portal unavailable while fetching events.",
          settings.retry,
          fetchRes.retryAfter,
          nowMs
        );
        return;
      }

      events = fetchRes.events;
    }

    const preflight = evaluatePreflight({
      job: freshJob,
      sessionState: "authenticated",
      events,
    });

    if (preflight.matchedEvent) {
      updateJob(this.db, freshJob.id, {
        sessionId: preflight.matchedEvent.sessionId ?? freshJob.sessionId,
        bookingWindowStart:
          preflight.matchedEvent.bookingWindowStart ??
          freshJob.bookingWindowStart,
        bookingWindowEnd:
          preflight.matchedEvent.bookingWindowEnd ?? freshJob.bookingWindowEnd,
        lastCheckedAt: nowIso,
      });
    } else {
      updateJob(this.db, freshJob.id, { lastCheckedAt: nowIso });
    }

    if (!preflight.passed) {
      if (preflight.terminalStatus) {
        const isBooked = preflight.terminalStatus === "Booked";
        const updated = updateJob(this.db, freshJob.id, {
          status: preflight.terminalStatus,
          errorMessage: isBooked ? null : preflight.reason ?? null,
          confirmedAt: isBooked ? nowIso : null,
          nextRetryAt: null,
        });
        this.emitLog(
          isBooked ? "success" : "warn",
          preflight.reason || `Job ended with status ${preflight.terminalStatus}`,
          freshJob.id
        );
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: isBooked
              ? "already_booked"
              : preflight.terminalStatus === "Waitlisted"
              ? "waitlisted"
              : preflight.terminalStatus === "Full"
              ? "full"
              : "failed",
            message: preflight.reason || "",
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        return;
      }

      if (preflight.waitForOpening) {
        if (freshJob.status !== "Waiting for opening") {
          updateJob(this.db, freshJob.id, {
            status: "Waiting for opening",
            errorMessage: null,
          });
          this.emitQueue();
        }
        return;
      }

      this.scheduleRetry(
        freshJob,
        preflight.reason || "Preflight check failed.",
        settings.retry,
        null,
        nowMs
      );
      return;
    }

    // All preflight checks passed: execute live booking submission
    const attemptNum = freshJob.attempts + 1;
    const processingJob = updateJob(this.db, freshJob.id, {
      status: "Processing",
      attempts: attemptNum,
      lastCheckedAt: nowIso,
      errorMessage: null,
    });
    if (processingJob) {
      this.broadcast?.({
        type: "job_event",
        job: processingJob,
        eventType: "attempt",
        message: `Submitting booking attempt #${attemptNum} for '${freshJob.title}'...`,
      });
    }
    this.emitQueue();

    const result: SubmissionResult = await executeBookingSubmission({
      context,
      job: getJobById(this.db, freshJob.id)!,
      matchedEvent: preflight.matchedEvent!,
    });

    const finishedIso = new Date().toISOString();

    switch (result.outcome) {
      case "booked":
      case "already_booked": {
        const updated = updateJob(this.db, freshJob.id, {
          status: "Booked",
          confirmedAt: finishedIso,
          nextRetryAt: null,
          errorMessage: null,
        });
        this.emitLog("success", result.message, freshJob.id);
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: result.outcome,
            message: result.message,
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        break;
      }
      case "waitlisted": {
        const updated = updateJob(this.db, freshJob.id, {
          status: "Waitlisted",
          errorMessage: result.message,
          nextRetryAt: null,
        });
        this.emitLog("warn", result.message, freshJob.id);
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: "waitlisted",
            message: result.message,
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        break;
      }
      case "full": {
        const updated = updateJob(this.db, freshJob.id, {
          status: "Full",
          errorMessage: result.message,
          nextRetryAt: null,
        });
        this.emitLog("warn", result.message, freshJob.id);
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: "full",
            message: result.message,
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        break;
      }
      case "closed":
      case "permanent_failure": {
        const updated = updateJob(this.db, freshJob.id, {
          status: "Failed",
          errorMessage: result.message,
          nextRetryAt: null,
        });
        this.emitLog("error", result.message, freshJob.id);
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: "failed",
            message: result.message,
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        break;
      }
      case "auth_required": {
        pauseAuthRequiredJobs(this.db, result.message);
        this.emitLog("warn", result.message, freshJob.id);
        const updated = getJobById(this.db, freshJob.id);
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: "auth_required",
            message: result.message,
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        break;
      }
      case "verification_required": {
        const updated = updateJob(this.db, freshJob.id, {
          status: "Verification required",
          errorMessage: result.message,
          nextRetryAt: null,
        });
        this.emitLog("warn", result.message, freshJob.id);
        if (updated) {
          this.broadcast?.({
            type: "job_event",
            job: updated,
            eventType: "verification_required",
            message: result.message,
          });
        }
        this.emitQueue();
        this.retryStartTimes.delete(freshJob.id);
        break;
      }
      case "transient_failure": {
        this.scheduleRetry(
          getJobById(this.db, freshJob.id)!,
          result.message,
          settings.retry,
          result.retryAfter,
          nowMs
        );
        break;
      }
    }
  }

  private scheduleRetry(
    job: BookingJob,
    reason: string,
    retryConfig: ReturnType<typeof getSettings>["retry"],
    retryAfterHeader?: string | null,
    nowMs: number = Date.now()
  ): void {
    if (!this.retryStartTimes.has(job.id)) {
      this.retryStartTimes.set(job.id, nowMs);
    }
    const firstAttemptAtMs = this.retryStartTimes.get(job.id)!;
    const nextAttemptCount = Math.max(1, job.attempts);
    const check = canRetry(nextAttemptCount, firstAttemptAtMs, nowMs, retryConfig);

    if (!check.allowed) {
      const failedJob = updateJob(this.db, job.id, {
        status: "Failed",
        errorMessage: `${reason} (${check.reason})`,
        nextRetryAt: null,
      });
      this.emitLog(
        "error",
        `Stopped retrying '${job.title}': ${check.reason}`,
        job.id,
        reason
      );
      if (failedJob) {
        this.broadcast?.({
          type: "job_event",
          job: failedJob,
          eventType: "failed",
          message: failedJob.errorMessage || reason,
        });
      }
      this.emitQueue();
      this.retryStartTimes.delete(job.id);
      return;
    }

    const delayMs = computeRetryDelayMs(
      nextAttemptCount,
      retryConfig,
      retryAfterHeader
    );
    const nextRetryAt = new Date(nowMs + delayMs).toISOString();

    const retryingJob = updateJob(this.db, job.id, {
      status: "Retrying",
      nextRetryAt,
      errorMessage: reason,
    });
    this.emitLog(
      "warn",
      `Retrying '${job.title}' in ${Math.round(delayMs / 1000)}s: ${reason}`,
      job.id
    );
    if (retryingJob) {
      this.broadcast?.({
        type: "job_event",
        job: retryingJob,
        eventType: "retry",
        message: `Retrying in ${Math.round(delayMs / 1000)}s: ${reason}`,
      });
    }
    this.emitQueue();
  }
}
