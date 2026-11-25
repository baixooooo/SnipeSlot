import type { BrowserContext } from "playwright";
import { PORTAL_BOOKING_URL } from "../config";
import { isTransientErrorMessage, isTransientHttpStatus } from "../retry";
import type { EventFilters, EventTermOption, PortalEvent, SessionState } from "../types";
import { isAuthenticatedPortalUrl } from "./browser";
import { parseEventTerms, parseEventsHtml } from "./parser";

export interface SessionCheckResult {
  state: SessionState;
  message: string;
  statusCode?: number;
  retryAfter?: string | null;
}

export interface FetchEventsResult {
  ok: boolean;
  sessionState: SessionState;
  events: PortalEvent[];
  terms: EventTermOption[];
  statusCode?: number;
  retryAfter?: string | null;
  errorMessage?: string;
}

export function classifyPortalResponse(params: {
  status: number;
  url: string;
  html: string;
  retryAfter?: string | null;
}): SessionCheckResult {
  const { status, url, html, retryAfter } = params;

  if (status === 401 || status === 403) {
    return {
      state: "expired",
      statusCode: status,
      message: `Portal rejected session (HTTP ${status}). Manual reconnection required.`,
    };
  }

  if (
    url.toLowerCase().includes("/login") ||
    url.toLowerCase().includes("/sso") ||
    url.toLowerCase().includes("/authorize")
  ) {
    return {
      state: "expired",
      statusCode: status,
      message: "Portal redirected to SSO login. Manual reconnection required.",
    };
  }

  if (status === 429 || isTransientHttpStatus(status)) {
    return {
      state: "unavailable",
      statusCode: status,
      retryAfter,
      message: `Portal temporarily unavailable (HTTP ${status}). Session preserved.`,
    };
  }

  if (status === 200 && isAuthenticatedPortalUrl(url)) {
    const hasPortalMarkers =
      html.includes("booking-term") ||
      html.includes("academicevents/event-booking") ||
      html.includes("slot_name");
    const hasLoginForm =
      html.includes('name="password"') && html.toLowerCase().includes("login");

    if (hasPortalMarkers && !hasLoginForm) {
      return {
        state: "authenticated",
        statusCode: 200,
        message: "Portal session is active and authenticated.",
      };
    }

    if (hasLoginForm) {
      return {
        state: "expired",
        statusCode: 200,
        message: "Portal returned login page. Manual reconnection required.",
      };
    }
  }

  return {
    state: "unavailable",
    statusCode: status,
    message: `Unexpected portal response (HTTP ${status}). Session preserved.`,
  };
}

export async function checkPortalSession(
  context: BrowserContext
): Promise<SessionCheckResult> {
  try {
    const response = await context.request.get(PORTAL_BOOKING_URL, {
      timeout: 15_000,
    });
    const status = response.status();
    const url = response.url();
    const retryAfter = response.headers()["retry-after"] ?? null;
    const html = await response.text().catch(() => "");

    return classifyPortalResponse({ status, url, html, retryAfter });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      state: "unavailable",
      message: isTransientErrorMessage(msg)
        ? `Temporary network error checking portal: ${msg}. Session preserved.`
        : `Could not reach portal: ${msg}. Session preserved.`,
    };
  }
}

export function buildBookingUrlWithFilters(filters?: EventFilters): string {
  if (!filters) return PORTAL_BOOKING_URL;
  const params = new URLSearchParams();
  if (filters.eventTerm) params.set("event_term", filters.eventTerm);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.slotName) params.set("slot_name", filters.slotName);
  if (filters.sessionTime) params.set("session_time", filters.sessionTime);
  const qs = params.toString();
  return qs ? `${PORTAL_BOOKING_URL}?${qs}` : PORTAL_BOOKING_URL;
}

export async function fetchPortalEvents(
  context: BrowserContext,
  filters?: EventFilters
): Promise<FetchEventsResult> {
  const targetUrl = buildBookingUrlWithFilters(filters);

  try {
    const response = await context.request.get(targetUrl, {
      timeout: 15_000,
    });
    const status = response.status();
    const url = response.url();
    const retryAfter = response.headers()["retry-after"] ?? null;
    const html = await response.text().catch(() => "");

    const classification = classifyPortalResponse({
      status,
      url,
      html,
      retryAfter,
    });

    if (classification.state !== "authenticated") {
      return {
        ok: false,
        sessionState: classification.state,
        events: [],
        terms: [],
        statusCode: status,
        retryAfter,
        errorMessage: classification.message,
      };
    }

    const events = parseEventsHtml(html);
    const terms = parseEventTerms(html);

    return {
      ok: true,
      sessionState: "authenticated",
      events,
      terms,
      statusCode: status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      sessionState: "unavailable",
      events: [],
      terms: [],
      errorMessage: `Network error fetching portal events: ${msg}`,
    };
  }
}
