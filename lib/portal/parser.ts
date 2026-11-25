import * as cheerio from "cheerio";
import { PORTAL_UTC_OFFSET_MINUTES } from "../config";
import type { EventTermOption, PortalEvent } from "../types";

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/**
 * Normalize portal time strings such as "8 a.m.", "1:15 p.m.", "12 p.m.", "13:15" to "HH:mm".
 */
export function normalizeTime(raw: string): string {
  const cleaned = raw.trim().replace(/\./g, "").replace(/\s+/g, " ").toLowerCase();
  if (!cleaned) return "";

  const ampmMatch = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch) {
    let hours = Number.parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? Number.parseInt(ampmMatch[2], 10) : 0;
    const period = ampmMatch[3];

    if (period === "am" && hours === 12) hours = 0;
    if (period === "pm" && hours !== 12) hours += 12;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const h24Match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (h24Match) {
    const hours = Number.parseInt(h24Match[1], 10);
    const minutes = Number.parseInt(h24Match[2], 10);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return raw.trim();
}

/**
 * Normalize portal calendar dates such as "Nov 19, 2026" or "2026-11-19" to "YYYY-MM-DD".
 */
export function normalizeDate(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return "";

  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return cleaned;

  const dmyMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    return `${dmyMatch[3]}-${month}-${day}`;
  }

  const textMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (textMatch) {
    const monthIdx = MONTHS[textMatch[1].toLowerCase()];
    if (monthIdx !== undefined) {
      const year = textMatch[3];
      const month = String(monthIdx + 1).padStart(2, "0");
      const day = textMatch[2].padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  return cleaned;
}

/**
 * Parse a portal timestamp in Asia/Kolkata (e.g. "Nov 18, 2026, 7 p.m." or "Nov 18, 2026, 7:30 a.m.")
 * and return an internal UTC ISO-8601 string.
 */
export function parsePortalTimestampToUtc(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/\b([ap])\.m\./gi, "$1m")
    .replace(/\s+/g, " ");

  if (!cleaned) return null;

  const match = cleaned.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?$/i
  );
  if (!match) {
    const iso = Date.parse(cleaned);
    if (!Number.isNaN(iso)) {
      return new Date(iso).toISOString();
    }
    return null;
  }

  const monthIdx = MONTHS[match[1].toLowerCase()];
  if (monthIdx === undefined) return null;

  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  let hours = match[4] ? Number.parseInt(match[4], 10) : 0;
  const minutes = match[5] ? Number.parseInt(match[5], 10) : 0;
  const period = match[6]?.toLowerCase();

  if (period === "am" && hours === 12) hours = 0;
  if (period === "pm" && hours !== 12) hours += 12;

  const utcMs =
    Date.UTC(year, monthIdx, day, hours, minutes, 0, 0) -
    PORTAL_UTC_OFFSET_MINUTES * 60_000;

  return new Date(utcMs).toISOString();
}

/**
 * Generate a deterministic composite identifier from title, date, startTime, endTime, and venue.
 */
export function generateCompositeId(params: {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
}): string {
  const slug = (val: string, maxLen = 40) =>
    val
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLen);

  const datePart = slug(normalizeDate(params.date), 16);
  const startPart = slug(normalizeTime(params.startTime), 8);
  const endPart = slug(normalizeTime(params.endTime), 8);
  const venuePart = slug(params.venue, 24);
  const titlePart = slug(params.title, 36);

  return `evt_${datePart}_${startPart}_${endPart}_${venuePart}_${titlePart}`;
}

export function parseEventTerms(html: string): EventTermOption[] {
  const $ = cheerio.load(html);
  const terms: EventTermOption[] = [];

  $("#booking-term option, select[name='event_term'] option").each((_, el) => {
    const value = $(el).attr("value") ?? "";
    const label = $(el).text().trim();
    const selected = $(el).is("[selected]");
    if (label) {
      terms.push({ value, label, selected });
    }
  });

  return terms;
}

export function parseEventsHtml(html: string): PortalEvent[] {
  const $ = cheerio.load(html);
  const events: PortalEvent[] = [];

  $("div.card.shadow-sm.border-0.h-100, div.card.h-100").each((_, cardEl) => {
    const card = $(cardEl);

    const titleEl = card.find("h5.fw-semibold").first().length
      ? card.find("h5.fw-semibold").first()
      : card.find("h5").first();
    const title = titleEl.text().trim();
    if (!title) return;

    let dateDisplay = "";
    let date = "";
    let startTime = "";
    let endTime = "";
    let venue = "";
    let bookingWindowStart: string | null = null;
    let bookingWindowEnd: string | null = null;
    let bookingWindowDisplay: string | null = null;
    let cancellationDeadline: string | null = null;
    let capacity: string | null = null;
    let waitlistCapacity: string | null = null;

    card.find("div.text-muted.small, div.small.text-muted").each((_, divEl) => {
      const text = $(divEl).text().trim().replace(/\s+/g, " ");
      if (!text) return;

      if (text.includes("·")) {
        const [rawDate, rawTimeRange] = text.split("·", 2).map((s) => s.trim());
        dateDisplay = rawDate;
        date = normalizeDate(rawDate);
        if (rawTimeRange && rawTimeRange.includes("-")) {
          const [rawStart, rawEnd] = rawTimeRange.split("-", 2).map((s) => s.trim());
          startTime = normalizeTime(rawStart);
          endTime = normalizeTime(rawEnd);
        }
      } else if (text.startsWith("Venue:")) {
        venue = text.replace(/^Venue:/i, "").trim();
      } else if (text.startsWith("Booking Window:")) {
        const windowContent = text.replace(/^Booking Window:/i, "").trim();
        bookingWindowDisplay = windowContent;
        const arrowParts = windowContent.split(/→|->|to/i).map((s) => s.trim());
        if (arrowParts.length >= 2) {
          bookingWindowStart = parsePortalTimestampToUtc(arrowParts[0]);
          bookingWindowEnd = parsePortalTimestampToUtc(arrowParts[1]);
        } else if (arrowParts.length === 1) {
          bookingWindowStart = parsePortalTimestampToUtc(arrowParts[0]);
        }
      } else if (text.startsWith("Cancellation Ends:")) {
        const rawCancel = text.replace(/^Cancellation Ends:/i, "").trim();
        cancellationDeadline = parsePortalTimestampToUtc(rawCancel);
      } else if (text.startsWith("Capacity:")) {
        capacity = text.replace(/^Capacity:/i, "").trim();
      } else if (text.startsWith("Waitlist:")) {
        waitlistCapacity = text.replace(/^Waitlist:/i, "").trim();
      }
    });

    const description = card.find("div.small.mt-1").first().text().trim();

    // Prefer the header status badge (.text-end span.badge) to avoid matching info badges
    let statusBadge = card.find(".text-end span.badge").first();
    if (!statusBadge.length) {
      statusBadge = card
        .find("span.badge")
        .filter((_, el) => {
          const cls = $(el).attr("class") || "";
          const txt = $(el).text().trim();
          return (
            cls.includes("bg-") &&
            !txt.startsWith("Reward Points:") &&
            !txt.startsWith("ClassAttendance:")
          );
        })
        .first();
    }

    const bookingStatus = statusBadge.text().trim() || "Unknown";

    let rewardPoints = 0;
    let attendanceInfo: string | null = null;

    card.find("span.badge").each((_, badgeEl) => {
      const bText = $(badgeEl).text().trim();
      if (bText.startsWith("Reward Points:")) {
        const m = bText.match(/Reward Points:\s*(\d+)/i);
        if (m) rewardPoints = Number.parseInt(m[1], 10);
      } else if (bText.startsWith("ClassAttendance:")) {
        attendanceInfo = bText.replace(/^ClassAttendance:/i, "").trim();
      }
    });

    let sessionId: string | null = null;
    const sessionInput = card.find('input[name="session_id"]').first();
    if (sessionInput.length && sessionInput.attr("value")) {
      sessionId = sessionInput.attr("value")!.trim();
    } else {
      const viewMoreLink = card.find('a[href*="/event-booking/"]').first();
      const href = viewMoreLink.attr("href") || "";
      const m = href.match(/\/event-booking\/(\d+)/);
      if (m) {
        sessionId = m[1];
      }
    }

    const form = card.find("form").first();
    let canBook = false;
    let hasWaitlist = false;
    let hasCancelForm = false;
    let purposeRequired = false;

    if (form.length) {
      const actionVal = (form.find('input[name="action"]').attr("value") || "")
        .trim()
        .toLowerCase();
      if (actionVal === "cancel") {
        hasCancelForm = true;
      }

      const purposeInput = form.find('input[name="purpose"]').first();
      if (purposeInput.length) {
        purposeRequired = purposeInput.attr("required") !== undefined;
      }

      const submitBtn = form.find('button[type="submit"]').first();
      if (submitBtn.length) {
        const btnText = submitBtn.text().trim().toLowerCase();
        if (btnText.includes("cancel")) {
          hasCancelForm = true;
        } else if (btnText.includes("book now") || btnText === "book") {
          canBook = true;
        } else if (btnText.includes("waitlist")) {
          hasWaitlist = true;
        }
      }
    }

    const statusLower = bookingStatus.toLowerCase();
    const isWaitlisted =
      statusLower === "waitlisted" ||
      statusLower === "waitlist" ||
      statusLower === "on waitlist";

    // Only treat as booked when the status badge explicitly confirms a booked/registered state
    // (or a cancel-booking action is rendered) and NOT waitlisted / open / full / closed.
    const explicitBookedBadge =
      statusLower === "booked" ||
      statusLower === "already booked" ||
      statusLower === "registered";

    const alreadyBooked =
      !isWaitlisted &&
      !canBook &&
      !hasWaitlist &&
      (explicitBookedBadge || hasCancelForm);

    const compositeId = generateCompositeId({
      title,
      date: date || dateDisplay,
      startTime,
      endTime,
      venue,
    });

    events.push({
      eventId: sessionId || compositeId,
      compositeId,
      sessionId,
      title,
      date: date || dateDisplay,
      dateDisplay: dateDisplay || date,
      startTime,
      endTime,
      venue,
      description,
      bookingStatus,
      bookingWindowStart,
      bookingWindowEnd,
      bookingWindowDisplay,
      cancellationDeadline,
      capacity,
      waitlistCapacity,
      rewardPoints,
      attendanceInfo,
      canBook,
      hasWaitlist,
      purposeRequired,
      alreadyBooked,
      isWaitlisted,
    });
  });

  return events;
}

export function extractPortalAlerts(html: string): string[] {
  const $ = cheerio.load(html);
  const alerts: string[] = [];
  $(".alert").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (text) alerts.push(text);
  });
  return alerts;
}

/**
 * Strictly match an event by title, date, startTime, endTime (if known), and venue.
 * If both target and candidate have a sessionId, they must also match.
 */
export function findExactMatchingEvent(
  events: PortalEvent[],
  target: {
    sessionId?: string | null;
    compositeId?: string | null;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    venue: string;
  }
): PortalEvent | null {
  const normTargetDate = normalizeDate(target.date);
  const normTargetStart = normalizeTime(target.startTime);
  const normTargetEnd = normalizeTime(target.endTime);
  const normTargetTitle = target.title.trim().toLowerCase();
  const normTargetVenue = target.venue.trim().toLowerCase();

  for (const evt of events) {
    const titleMatch = evt.title.trim().toLowerCase() === normTargetTitle;
    const dateMatch = normalizeDate(evt.date) === normTargetDate;
    const startMatch = normalizeTime(evt.startTime) === normTargetStart;
    const endMatch =
      !normTargetEnd || normalizeTime(evt.endTime) === normTargetEnd;
    const venueMatch = evt.venue.trim().toLowerCase() === normTargetVenue;
    const sessionMatch =
      !target.sessionId ||
      !evt.sessionId ||
      evt.sessionId === target.sessionId;

    if (
      titleMatch &&
      dateMatch &&
      startMatch &&
      endMatch &&
      venueMatch &&
      sessionMatch
    ) {
      return evt;
    }
  }

  return null;
}
