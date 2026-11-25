import crypto from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { addActivityLog } from "./database";
import { generateCompositeId, normalizeDate, normalizeTime } from "./portal/parser";
import type { BookingJob, JobStatus } from "./types";

interface JobRow {
  id: string;
  event_id: string;
  composite_id: string;
  session_id: string | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  venue: string;
  booking_window_start: string | null;
  booking_window_end: string | null;
  purpose: string;
  status: JobStatus;
  is_paused: number;
  attempts: number;
  last_checked_at: string | null;
  next_retry_at: string | null;
  error_message: string | null;
  confirmed_at: string | null;
  authorized: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: JobRow): BookingJob {
  return {
    id: row.id,
    eventId: row.event_id,
    compositeId: row.composite_id,
    sessionId: row.session_id,
    title: row.title,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    venue: row.venue,
    bookingWindowStart: row.booking_window_start,
    bookingWindowEnd: row.booking_window_end,
    purpose: row.purpose,
    status: row.status,
    isPaused: Boolean(row.is_paused),
    attempts: row.attempts,
    lastCheckedAt: row.last_checked_at,
    nextRetryAt: row.next_retry_at,
    errorMessage: row.error_message,
    confirmedAt: row.confirmed_at,
    authorized: Boolean(row.authorized),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listJobs(db: DatabaseSync): BookingJob[] {
  const rows = db
    .prepare("SELECT * FROM booking_jobs ORDER BY created_at DESC")
    .all() as unknown as JobRow[];
  return rows.map(mapRow);
}

export function getJobById(db: DatabaseSync, id: string): BookingJob | null {
  const row = db
    .prepare("SELECT * FROM booking_jobs WHERE id = ?")
    .get(id) as unknown as JobRow | undefined;
  return row ? mapRow(row) : null;
}

export interface CreateJobInput {
  eventId?: string;
  compositeId?: string;
  sessionId?: string | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  bookingWindowStart?: string | null;
  bookingWindowEnd?: string | null;
  purpose: string;
  authorized: boolean;
}

export class DuplicateJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateJobError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function createJob(db: DatabaseSync, input: CreateJobInput): BookingJob {
  const cleanPurpose = (input.purpose || "").trim();
  if (!cleanPurpose || cleanPurpose.length > 255) {
    throw new ValidationError("Purpose is required and must be 1 to 255 characters.");
  }

  if (!input.authorized) {
    throw new ValidationError("Explicit authorization for automatic booking is required.");
  }

  const normDate = normalizeDate(input.date);
  const normStart = normalizeTime(input.startTime);
  const normEnd = normalizeTime(input.endTime);
  const cleanTitle = input.title.trim();
  const cleanVenue = input.venue.trim();

  if (!cleanTitle || !normDate || !normStart || !cleanVenue) {
    throw new ValidationError("Event title, date, start time, and venue are required.");
  }

  const compositeId =
    input.compositeId ||
    generateCompositeId({
      title: cleanTitle,
      date: normDate,
      startTime: normStart,
      endTime: normEnd,
      venue: cleanVenue,
    });

  // Prevent duplicate active (non-terminal) entries for the same slot
  const existing = db
    .prepare(
      `SELECT id, status FROM booking_jobs
       WHERE composite_id = ?
         AND status NOT IN ('Booked', 'Waitlisted', 'Full', 'Failed', 'Cancelled')`
    )
    .get(compositeId) as { id: string; status: string } | undefined;

  if (existing) {
    throw new DuplicateJobError(
      `An active or completed booking job already exists for this event (status: ${existing.status}).`
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const initialStatus: JobStatus = input.bookingWindowStart ? "Scheduled" : "Pending";

  db.prepare(`
    INSERT INTO booking_jobs (
      id, event_id, composite_id, session_id, title, date, start_time, end_time,
      venue, booking_window_start, booking_window_end, purpose, status, is_paused,
      attempts, last_checked_at, next_retry_at, error_message, confirmed_at,
      authorized, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id,
    input.eventId || input.sessionId || compositeId,
    compositeId,
    input.sessionId ?? null,
    cleanTitle,
    normDate,
    normStart,
    normEnd,
    cleanVenue,
    input.bookingWindowStart ?? null,
    input.bookingWindowEnd ?? null,
    cleanPurpose,
    initialStatus,
    input.authorized ? 1 : 0,
    now,
    now
  );

  addActivityLog(
    db,
    "info",
    `Queued '${cleanTitle}' (${normDate} ${normStart} · ${cleanVenue})`,
    id
  );

  return getJobById(db, id)!;
}

export function updateJob(
  db: DatabaseSync,
  id: string,
  patch: Partial<{
    eventId: string;
    sessionId: string | null;
    bookingWindowStart: string | null;
    bookingWindowEnd: string | null;
    status: JobStatus;
    isPaused: boolean;
    attempts: number;
    lastCheckedAt: string | null;
    nextRetryAt: string | null;
    errorMessage: string | null;
    confirmedAt: string | null;
  }>
): BookingJob | null {
  const current = getJobById(db, id);
  if (!current) return null;

  const next = {
    eventId: patch.eventId ?? current.eventId,
    sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
    bookingWindowStart:
      patch.bookingWindowStart !== undefined
        ? patch.bookingWindowStart
        : current.bookingWindowStart,
    bookingWindowEnd:
      patch.bookingWindowEnd !== undefined ? patch.bookingWindowEnd : current.bookingWindowEnd,
    status: patch.status ?? current.status,
    isPaused: patch.isPaused ?? current.isPaused,
    attempts: patch.attempts ?? current.attempts,
    lastCheckedAt:
      patch.lastCheckedAt !== undefined ? patch.lastCheckedAt : current.lastCheckedAt,
    nextRetryAt: patch.nextRetryAt !== undefined ? patch.nextRetryAt : current.nextRetryAt,
    errorMessage:
      patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
    confirmedAt: patch.confirmedAt !== undefined ? patch.confirmedAt : current.confirmedAt,
  };

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE booking_jobs
    SET event_id = ?,
        session_id = ?,
        booking_window_start = ?,
        booking_window_end = ?,
        status = ?,
        is_paused = ?,
        attempts = ?,
        last_checked_at = ?,
        next_retry_at = ?,
        error_message = ?,
        confirmed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    next.eventId,
    next.sessionId,
    next.bookingWindowStart,
    next.bookingWindowEnd,
    next.status,
    next.isPaused ? 1 : 0,
    next.attempts,
    next.lastCheckedAt,
    next.nextRetryAt,
    next.errorMessage,
    next.confirmedAt,
    now,
    id
  );

  return getJobById(db, id);
}

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  "Booked",
  "Waitlisted",
  "Full",
  "Failed",
  "Cancelled",
]);

export function pauseAuthRequiredJobs(db: DatabaseSync, reason: string): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE booking_jobs
       SET status = 'Authentication required',
           is_paused = 1,
           error_message = ?,
           next_retry_at = NULL,
           updated_at = ?
       WHERE status IN ('Pending', 'Scheduled', 'Preparing', 'Waiting for opening', 'Retrying')
         AND is_paused = 0`
    )
    .run(reason, now);
  return Number(info.changes);
}

export function resumeAuthRequiredJobs(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE booking_jobs
       SET status = CASE WHEN booking_window_start IS NOT NULL THEN 'Scheduled' ELSE 'Pending' END,
           is_paused = 0,
           error_message = NULL,
           next_retry_at = NULL,
           updated_at = ?
       WHERE status = 'Authentication required'
         AND authorized = 1`
    )
    .run(now);
  return Number(info.changes);
}

export function pauseJob(db: DatabaseSync, id: string): BookingJob | null {
  const job = getJobById(db, id);
  if (!job) return null;
  if (TERMINAL_STATUSES.has(job.status)) return job;

  const updated = updateJob(db, id, { isPaused: true });
  addActivityLog(db, "info", `Paused job '${job.title}'`, id);
  return updated;
}

export function resumeJob(db: DatabaseSync, id: string): BookingJob | null {
  const job = getJobById(db, id);
  if (!job) return null;
  if (TERMINAL_STATUSES.has(job.status)) return job;

  const nextStatus: JobStatus =
    job.status === "Authentication required" || job.status === "Verification required"
      ? "Pending"
      : job.status;

  const updated = updateJob(db, id, {
    isPaused: false,
    status: nextStatus,
    nextRetryAt: null,
    errorMessage: null,
  });
  addActivityLog(db, "info", `Resumed job '${job.title}'`, id);
  return updated;
}

export function removeJob(db: DatabaseSync, id: string): boolean {
  const job = getJobById(db, id);
  if (!job) return false;

  db.prepare("DELETE FROM booking_jobs WHERE id = ?").run(id);
  addActivityLog(db, "info", `Removed job '${job.title}'`, id);
  return true;
}

export function recoverInterruptedJobs(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE booking_jobs
       SET status = 'Pending',
           error_message = 'Recovered after worker restart; will re-verify before submission.',
           updated_at = ?
       WHERE status IN ('Preparing', 'Processing') AND is_paused = 0`
    )
    .run(now);

  return Number(info.changes);
}

export function getQueueStats(db: DatabaseSync): {
  pending: number;
  booked: number;
  failed: number;
  total: number;
} {
  const jobs = listJobs(db);
  let pending = 0;
  let booked = 0;
  let failed = 0;

  for (const job of jobs) {
    if (job.status === "Booked") booked++;
    else if (job.status === "Failed" || job.status === "Full") failed++;
    else if (job.status !== "Cancelled") pending++;
  }

  return { pending, booked, failed, total: jobs.length };
}
