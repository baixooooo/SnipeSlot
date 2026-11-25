import type { BrowserContext } from "playwright";
import { PORTAL_BOOKING_URL } from "../config";
import { isTransientErrorMessage, isTransientHttpStatus } from "../retry";
import type { BookingJob, PortalEvent, SessionState } from "../types";
import {
  extractPortalAlerts,
  findExactMatchingEvent,
  parseEventsHtml,
} from "./parser";
import { fetchPortalEvents, type FetchEventsResult } from "./session";

export interface PreflightResult {
  passed: boolean;
  reason?: string;
  matchedEvent?: PortalEvent;
  terminalStatus?:
    | "Booked"
    | "Waitlisted"
    | "Full"
    | "Failed"
    | "Authentication required";
  waitForOpening?: boolean;
}

export function evaluatePreflight(params: {
  job: BookingJob;
  sessionState: SessionState;
  events: PortalEvent[];
}): PreflightResult {
  const { job, sessionState, events } = params;

  if (sessionState === "expired" || sessionState === "disconnected") {
    return {
      passed: false,
      terminalStatus: "Authentication required",
      reason:
        "Portal session expired or disconnected. Manual reconnection required.",
    };
  }

  if (sessionState === "unavailable") {
    return {
      passed: false,
      reason: "Portal is temporarily unavailable.",
    };
  }

  if (!job.authorized) {
    return {
      passed: false,
      terminalStatus: "Failed",
      reason: "Autonomous booking is not explicitly authorized for this job.",
    };
  }

  const cleanPurpose = job.purpose.trim();
  if (!cleanPurpose || cleanPurpose.length > 255) {
    return {
      passed: false,
      terminalStatus: "Failed",
      reason: "Booking purpose must be 1 to 255 characters.",
    };
  }

  const matched = findExactMatchingEvent(events, {
    sessionId: job.sessionId,
    compositeId: job.compositeId,
    title: job.title,
    date: job.date,
    startTime: job.startTime,
    endTime: job.endTime,
    venue: job.venue,
  });

  if (!matched) {
    return {
      passed: false,
      reason: `Target event '${job.title}' (${job.date} ${job.startTime} · ${job.venue}) not found on portal.`,
    };
  }

  if (matched.isWaitlisted) {
    return {
      passed: false,
      matchedEvent: matched,
      terminalStatus: "Waitlisted",
      reason: "Target event is marked Waitlisted on the portal (not Booked).",
    };
  }

  if (matched.alreadyBooked) {
    return {
      passed: false,
      matchedEvent: matched,
      terminalStatus: "Booked",
      reason: "Target event is already booked for your account on the portal.",
    };
  }

  const statusLower = matched.bookingStatus.toLowerCase();
  if (statusLower === "full") {
    return {
      passed: false,
      matchedEvent: matched,
      terminalStatus: "Full",
      reason: "Target slot is full.",
    };
  }

  if (statusLower.includes("closed")) {
    return {
      passed: false,
      matchedEvent: matched,
      terminalStatus: "Failed",
      reason: "Booking window is closed.",
    };
  }

  if (
    statusLower === "waitlist open" ||
    (!matched.canBook && matched.hasWaitlist)
  ) {
    return {
      passed: false,
      matchedEvent: matched,
      terminalStatus: "Full",
      reason:
        "Primary capacity is full (only waitlist available; automatic waitlist join is disabled).",
    };
  }

  if (statusLower === "opening soon" || !matched.canBook) {
    return {
      passed: false,
      matchedEvent: matched,
      waitForOpening: true,
      reason: `Booking window is not open yet (current status: ${matched.bookingStatus}).`,
    };
  }

  if (!matched.sessionId) {
    return {
      passed: false,
      matchedEvent: matched,
      waitForOpening: true,
      reason:
        "Event is missing numeric session ID; waiting for booking form to render.",
    };
  }

  return {
    passed: true,
    matchedEvent: matched,
  };
}

export type SubmissionOutcome =
  | "booked"
  | "already_booked"
  | "waitlisted"
  | "full"
  | "closed"
  | "auth_required"
  | "transient_failure"
  | "verification_required"
  | "permanent_failure";

export interface SubmissionResult {
  outcome: SubmissionOutcome;
  message: string;
  statusCode?: number;
  retryAfter?: string | null;
}

export type PortalFetchFn = (
  job: BookingJob
) => Promise<FetchEventsResult>;

export function isExplicitRejectionAlert(alerts: string[]): {
  rejected: boolean;
  full: boolean;
  message: string;
} {
  const joined = alerts.join(" | ");
  const lower = joined.toLowerCase();

  if (
    /\bfull\b/.test(lower) ||
    /\bno seats\b/.test(lower) ||
    /\bcapacity reached\b/.test(lower) ||
    /\bsold out\b/.test(lower)
  ) {
    return { rejected: true, full: true, message: joined };
  }

  if (
    lower.includes("not eligible") ||
    lower.includes("limit exceeded") ||
    lower.includes("maximum booking") ||
    lower.includes("cannot book") ||
    lower.includes("booking closed") ||
    lower.includes("rejected") ||
    lower.includes("invalid purpose")
  ) {
    return { rejected: true, full: false, message: joined };
  }

  return { rejected: false, full: false, message: joined };
}

/**
 * Retrieve fresh portal state for the target event's date and verify the exact
 * event's status. Never treats HTTP 200, disappeared buttons, generic success
 * alerts, or "waitlisted" as a confirmed booking.
 */
export async function verifyTargetEventBooking(
  context: BrowserContext | null,
  job: BookingJob,
  alerts: string[] = [],
  options?: {
    fetchEvents?: PortalFetchFn;
    followUpAttempts?: number;
    followUpDelayMs?: number;
  }
): Promise<{
  verified: boolean;
  outcome:
    | "booked"
    | "waitlisted"
    | "full"
    | "closed"
    | "auth_required"
    | "not_booked"
    | "uncertain";
  message: string;
}> {
  const fetchFn: PortalFetchFn =
    options?.fetchEvents ??
    ((j) =>
      fetchPortalEvents(context!, {
        dateFrom: j.date,
        dateTo: j.date,
      }));

  const maxChecks = Math.max(1, options?.followUpAttempts ?? 1);
  const delayMs = options?.followUpDelayMs ?? 1500;

  for (let checkIdx = 0; checkIdx < maxChecks; checkIdx++) {
    if (checkIdx > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const fetchRes = await fetchFn(job);

    if (!fetchRes.ok) {
      if (fetchRes.sessionState === "expired") {
        return {
          verified: false,
          outcome: "auth_required",
          message: "Session expired while verifying booking.",
        };
      }
      if (checkIdx === maxChecks - 1) {
        return {
          verified: false,
          outcome: "uncertain",
          message:
            fetchRes.errorMessage ||
            "Could not verify booking status due to portal unavailability.",
        };
      }
      continue;
    }

    const matched = findExactMatchingEvent(fetchRes.events, {
      sessionId: job.sessionId,
      compositeId: job.compositeId,
      title: job.title,
      date: job.date,
      startTime: job.startTime,
      endTime: job.endTime,
      venue: job.venue,
    });

    if (!matched) {
      if (checkIdx === maxChecks - 1) {
        return {
          verified: false,
          outcome: "uncertain",
          message:
            "Target event was not found during post-submission verification.",
        };
      }
      continue;
    }

    if (matched.isWaitlisted) {
      return {
        verified: false,
        outcome: "waitlisted",
        message: `Portal reports '${matched.title}' is Waitlisted (not Booked).`,
      };
    }

    if (matched.alreadyBooked) {
      return {
        verified: true,
        outcome: "booked",
        message: `Verified on portal: '${matched.title}' (${matched.date} ${matched.startTime} · ${matched.venue}) is Booked.`,
      };
    }

    const statusLower = matched.bookingStatus.toLowerCase();
    if (
      statusLower === "full" ||
      statusLower === "waitlist open" ||
      (!matched.canBook && matched.hasWaitlist)
    ) {
      return {
        verified: false,
        outcome: "full",
        message: `Target slot is now ${matched.bookingStatus} without a confirmed reservation.`,
      };
    }

    if (statusLower.includes("closed")) {
      return {
        verified: false,
        outcome: "closed",
        message: "Booking window closed without a confirmed reservation.",
      };
    }

    if (checkIdx === maxChecks - 1) {
      const rejection = isExplicitRejectionAlert(alerts);
      if (rejection.rejected) {
        return {
          verified: false,
          outcome: rejection.full ? "full" : "not_booked",
          message: rejection.message,
        };
      }

      return {
        verified: false,
        outcome: "not_booked",
        message: alerts.length
          ? `Booking not confirmed on portal (status: '${matched.bookingStatus}'; alerts: ${alerts.join(" | ")}).`
          : `Target event status on portal is still '${matched.bookingStatus}'.`,
      };
    }
  }

  return {
    verified: false,
    outcome: "uncertain",
    message: "Verification did not reach a conclusive state.",
  };
}

export async function executeBookingSubmission(params: {
  context: BrowserContext;
  job: BookingJob;
  matchedEvent: PortalEvent;
}): Promise<SubmissionResult> {
  const { context, job, matchedEvent } = params;
  const sessionId = matchedEvent.sessionId || job.sessionId;

  if (!sessionId) {
    return {
      outcome: "transient_failure",
      message: "Numeric session ID is not yet available for form submission.",
    };
  }

  const page = await context.newPage();
  try {
    const targetUrl = `${PORTAL_BOOKING_URL}?date_from=${encodeURIComponent(
      job.date
    )}&date_to=${encodeURIComponent(job.date)}`;

    let resp;
    try {
      resp = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        outcome: "transient_failure",
        message: `Navigation error loading booking form: ${msg}`,
      };
    }

    const currentUrl = page.url();
    if (
      currentUrl.toLowerCase().includes("/login") ||
      currentUrl.toLowerCase().includes("/sso") ||
      currentUrl.toLowerCase().includes("/authorize")
    ) {
      return {
        outcome: "auth_required",
        message: "Portal redirected to login while loading booking form.",
      };
    }

    if (resp) {
      const status = resp.status();
      const retryAfter = resp.headers()["retry-after"] ?? null;
      if (status === 429 || isTransientHttpStatus(status)) {
        return {
          outcome: "transient_failure",
          statusCode: status,
          retryAfter,
          message: `Portal returned HTTP ${status} loading booking page.`,
        };
      }
      if (status === 401 || status === 403) {
        return {
          outcome: "auth_required",
          statusCode: status,
          message: `Portal returned HTTP ${status}. Authentication required.`,
        };
      }
    }

    const html = await page.content();
    const eventsOnPage = parseEventsHtml(html);
    const liveMatch = findExactMatchingEvent(eventsOnPage, {
      sessionId,
      compositeId: job.compositeId,
      title: job.title,
      date: job.date,
      startTime: job.startTime,
      endTime: job.endTime,
      venue: job.venue,
    });

    if (liveMatch?.isWaitlisted) {
      return {
        outcome: "waitlisted",
        message: `Target event '${liveMatch.title}' is Waitlisted on the portal.`,
      };
    }

    if (liveMatch?.alreadyBooked) {
      return {
        outcome: "already_booked",
        message: `Verified on portal: '${liveMatch.title}' is already booked.`,
      };
    }

    const formSelector = `form:has(input[name="session_id"][value="${sessionId}"])`;
    const form = await page.$(formSelector);
    if (!form) {
      if (
        liveMatch &&
        (liveMatch.bookingStatus.toLowerCase() === "full" ||
          liveMatch.bookingStatus.toLowerCase() === "waitlist open")
      ) {
        return {
          outcome: "full",
          message: `Slot became ${liveMatch.bookingStatus} before submission.`,
        };
      }
      if (liveMatch && liveMatch.bookingStatus.toLowerCase().includes("closed")) {
        return {
          outcome: "closed",
          message: "Booking window closed before submission.",
        };
      }
      return {
        outcome: "transient_failure",
        message: `Booking form for session ${sessionId} not rendered yet.`,
      };
    }

    const csrfInput = await form.$('input[name="csrfmiddlewaretoken"]');
    if (!csrfInput) {
      return {
        outcome: "permanent_failure",
        message:
          "CSRF token missing from booking form; aborting unsafe submission.",
      };
    }

    const submitBtn = await form.$('button[type="submit"]');
    if (!submitBtn) {
      return {
        outcome: "transient_failure",
        message: "Submit button not found inside booking form.",
      };
    }

    const btnText = ((await submitBtn.textContent()) || "").trim().toLowerCase();
    if (btnText.includes("waitlist")) {
      return {
        outcome: "full",
        message:
          "Only waitlist button is available; automatic waitlist join is disabled.",
      };
    }

    const purposeInput = await form.$('input[name="purpose"]');
    if (purposeInput) {
      await purposeInput.fill(job.purpose.trim().slice(0, 255));
    }

    // Submit the portal form and wait for PRG redirect/navigation
    let navTimedOut = false;
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }),
        submitBtn.click(),
      ]);
    } catch {
      navTimedOut = true;
    }

    const postHtml = await page.content().catch(() => "");
    const alerts = postHtml ? extractPortalAlerts(postHtml) : [];
    const rejection = isExplicitRejectionAlert(alerts);

    // Always verify exact target event status via fresh portal GET.
    // If navigation timed out, perform bounded follow-up checks (2 attempts).
    const verification = await verifyTargetEventBooking(context, job, alerts, {
      followUpAttempts: navTimedOut ? 2 : 1,
      followUpDelayMs: 1500,
    });

    if (verification.outcome === "booked") {
      return { outcome: "booked", message: verification.message };
    }
    if (verification.outcome === "waitlisted") {
      return { outcome: "waitlisted", message: verification.message };
    }
    if (verification.outcome === "full") {
      return { outcome: "full", message: verification.message };
    }
    if (verification.outcome === "closed") {
      return { outcome: "closed", message: verification.message };
    }
    if (verification.outcome === "auth_required") {
      return { outcome: "auth_required", message: verification.message };
    }

    if (rejection.rejected) {
      return {
        outcome: rejection.full ? "full" : "permanent_failure",
        message: rejection.message,
      };
    }

    if (verification.outcome === "uncertain" || navTimedOut) {
      return {
        outcome: "verification_required",
        message: `Submission outcome uncertain (${verification.message}). Manual verification required before any retry.`,
      };
    }

    if (isTransientErrorMessage(postHtml)) {
      return {
        outcome: "transient_failure",
        message: verification.message,
      };
    }

    return {
      outcome: "permanent_failure",
      message: verification.message,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTransientErrorMessage(msg)) {
      return {
        outcome: "transient_failure",
        message: `Submission error: ${msg}`,
      };
    }
    return {
      outcome: "permanent_failure",
      message: `Submission failed: ${msg}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}
