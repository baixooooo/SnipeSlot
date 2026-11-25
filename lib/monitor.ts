import type { DatabaseSync } from "node:sqlite";
import {
  addActivityLog,
  getEventsCache,
  getSettings,
  saveEventsCache,
  updateWorkerState,
} from "./database";
import type { PortalBrowserManager } from "./portal/browser";
import { fetchPortalEvents, type FetchEventsResult } from "./portal/session";
import { listJobs, pauseAuthRequiredJobs, updateJob } from "./queue";
import { computeRetryDelayMs } from "./retry";
import type {
  EventChangeSummary,
  EventFilters,
  PortalEvent,
  WsMessage,
} from "./types";

export function detectEventChanges(
  previous: PortalEvent[],
  next: PortalEvent[]
): EventChangeSummary {
  const prevByKey = new Map<string, PortalEvent>();
  for (const evt of previous) {
    prevByKey.set(evt.compositeId, evt);
  }

  let newlyAvailable = 0;
  let capacityChanged = 0;
  let windowChanged = 0;
  let newEvents = 0;

  for (const evt of next) {
    const prev = prevByKey.get(evt.compositeId);
    if (!prev) {
      newEvents++;
      if (evt.bookingStatus.toLowerCase() === "open" || evt.canBook) {
        newlyAvailable++;
      }
      continue;
    }

    if (
      prev.bookingStatus.toLowerCase() !== "open" &&
      (evt.bookingStatus.toLowerCase() === "open" || evt.canBook)
    ) {
      newlyAvailable++;
    }

    if (
      prev.capacity !== evt.capacity ||
      prev.waitlistCapacity !== evt.waitlistCapacity
    ) {
      capacityChanged++;
    }

    if (
      prev.bookingWindowStart !== evt.bookingWindowStart ||
      prev.bookingWindowEnd !== evt.bookingWindowEnd
    ) {
      windowChanged++;
    }
  }

  return {
    newlyAvailable,
    capacityChanged,
    windowChanged,
    newEvents,
  };
}

export interface EventMonitorDeps {
  db: DatabaseSync;
  browserManager: PortalBrowserManager;
  broadcast: (msg: WsMessage) => void;
  isBusy?: () => boolean;
  fetchFn?: (filters?: EventFilters) => Promise<FetchEventsResult>;
}

export class EventMonitor {
  private readonly db: DatabaseSync;
  private readonly browserManager: PortalBrowserManager;
  private readonly broadcast: (msg: WsMessage) => void;
  private readonly isBusy?: () => boolean;
  private readonly fetchFn?: (filters?: EventFilters) => Promise<FetchEventsResult>;

  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private polling = false;
  private outageAttempts = 0;
  private activeFilters: EventFilters = {};

  constructor(deps: EventMonitorDeps) {
    this.db = deps.db;
    this.browserManager = deps.browserManager;
    this.broadcast = deps.broadcast;
    this.isBusy = deps.isBusy;
    this.fetchFn = deps.fetchFn;
  }

  setFilters(filters: EventFilters): void {
    this.activeFilters = { ...filters };
  }

  start(): void {
    this.stopped = false;
    // Immediately run startup discovery without requiring user click
    this.scheduleNext(100);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.pollOnce();
    }, delayMs);
  }

  private computeAdaptiveIntervalMs(): number {
    const settings = getSettings(this.db);
    const baseMs = Math.max(10_000, settings.pollIntervalSeconds * 1000);
    const jobs = listJobs(this.db);
    const nowMs = Date.now();

    for (const job of jobs) {
      if (job.isPaused) continue;
      if (job.status === "Waiting for opening" || job.status === "Preparing") {
        return 3_000;
      }
      if (
        (job.status === "Scheduled" || job.status === "Pending") &&
        job.bookingWindowStart
      ) {
        const startMs = Date.parse(job.bookingWindowStart);
        if (!Number.isNaN(startMs) && startMs - nowMs <= 60_000 && startMs - nowMs >= -120_000) {
          return 3_000;
        }
      }
    }

    return baseMs;
  }

  async pollOnce(overrideFilters?: EventFilters): Promise<FetchEventsResult | null> {
    if (this.polling) return null;
    if (this.isBusy?.()) {
      this.scheduleNext(1_500);
      return null;
    }

    this.polling = true;
    const settings = getSettings(this.db);
    let nextDelayMs = this.computeAdaptiveIntervalMs();

    try {
      const filters = overrideFilters ?? this.activeFilters;
      let res: FetchEventsResult;
      if (this.fetchFn) {
        res = await this.fetchFn(filters);
      } else {
        const ctx = await this.browserManager.ensureHeadlessContext();
        res = await fetchPortalEvents(ctx, filters);
      }

      const nowIso = new Date().toISOString();

      if (res.sessionState === "expired") {
        this.outageAttempts = 0;
        const workerState = updateWorkerState(this.db, {
          sessionState: "expired",
          sessionMessage:
            res.errorMessage || "Portal session expired. Manual reconnection required.",
          lastSessionCheckAt: nowIso,
        });
        this.broadcast({ type: "portal_status", workerState });

        const pausedCount = pauseAuthRequiredJobs(
          this.db,
          "Portal session expired. Paused until reconnection."
        );
        if (pausedCount > 0) {
          const log = addActivityLog(
            this.db,
            "warn",
            `Session expired; paused ${pausedCount} active booking job(s).`
          );
          this.broadcast({ type: "log_added", log });
          this.broadcast({ type: "queue_updated", jobs: listJobs(this.db) });
        }

        // Slow poll while waiting for user to reconnect
        nextDelayMs = Math.max(nextDelayMs, 60_000);
        return res;
      }

      if (!res.ok || res.sessionState === "unavailable") {
        this.outageAttempts++;
        const workerState = updateWorkerState(this.db, {
          sessionState: "unavailable",
          sessionMessage:
            res.errorMessage || "Portal temporarily unavailable. Session preserved.",
          lastSessionCheckAt: nowIso,
        });
        this.broadcast({ type: "portal_status", workerState });

        nextDelayMs = computeRetryDelayMs(
          this.outageAttempts,
          settings.retry,
          res.retryAfter
        );
        return res;
      }

      // Healthy authenticated response
      this.outageAttempts = 0;
      const workerState = updateWorkerState(this.db, {
        sessionState: "authenticated",
        sessionMessage: "Portal session is active and authenticated.",
        lastSessionCheckAt: nowIso,
      });
      this.broadcast({ type: "portal_status", workerState });

      const prevCache = getEventsCache(this.db);
      const changes = detectEventChanges(prevCache.events, res.events);
      const fetchedAt = saveEventsCache(this.db, res.events, res.terms);

      // Sync newly discovered sessionId / bookingWindow onto active queued jobs
      this.syncJobsWithDiscoveredEvents(res.events);

      this.broadcast({
        type: "events_updated",
        events: res.events,
        terms: res.terms,
        fetchedAt,
        changes,
      });

      if (changes.newlyAvailable > 0) {
        const log = addActivityLog(
          this.db,
          "info",
          `Monitor detected ${changes.newlyAvailable} newly open slot(s).`
        );
        this.broadcast({ type: "log_added", log });
      }

      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outageAttempts++;
      nextDelayMs = computeRetryDelayMs(this.outageAttempts, settings.retry);
      const log = addActivityLog(this.db, "warn", `Monitor poll error: ${msg}`);
      this.broadcast({ type: "log_added", log });
      return null;
    } finally {
      this.polling = false;
      this.scheduleNext(nextDelayMs);
    }
  }

  private syncJobsWithDiscoveredEvents(events: PortalEvent[]): void {
    const byComposite = new Map<string, PortalEvent>();
    for (const evt of events) {
      byComposite.set(evt.compositeId, evt);
    }

    let changed = false;
    for (const job of listJobs(this.db)) {
      if (job.isPaused) continue;
      if (
        job.status === "Booked" ||
        job.status === "Waitlisted" ||
        job.status === "Full" ||
        job.status === "Failed" ||
        job.status === "Cancelled"
      ) {
        continue;
      }

      const evt = byComposite.get(job.compositeId);
      if (!evt) continue;

      const needsSession = evt.sessionId && evt.sessionId !== job.sessionId;
      const needsWindow =
        (evt.bookingWindowStart &&
          evt.bookingWindowStart !== job.bookingWindowStart) ||
        (evt.bookingWindowEnd && evt.bookingWindowEnd !== job.bookingWindowEnd);

      if (needsSession || needsWindow) {
        updateJob(this.db, job.id, {
          sessionId: evt.sessionId ?? job.sessionId,
          bookingWindowStart: evt.bookingWindowStart ?? job.bookingWindowStart,
          bookingWindowEnd: evt.bookingWindowEnd ?? job.bookingWindowEnd,
        });
        changed = true;
      }
    }

    if (changed) {
      this.broadcast({ type: "queue_updated", jobs: listJobs(this.db) });
    }
  }
}
