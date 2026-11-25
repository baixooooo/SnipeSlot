export type JobStatus =
  | "Pending"
  | "Scheduled"
  | "Preparing"
  | "Waiting for opening"
  | "Processing"
  | "Retrying"
  | "Booked"
  | "Waitlisted"
  | "Full"
  | "Failed"
  | "Authentication required"
  | "Verification required"
  | "Cancelled";

export type SessionState =
  | "authenticated"
  | "expired"
  | "unavailable"
  | "disconnected";

export interface PortalEvent {
  eventId: string;
  compositeId: string;
  sessionId: string | null;
  title: string;
  date: string; // YYYY-MM-DD (Asia/Kolkata calendar date)
  dateDisplay: string; // Original portal date string, e.g. "Nov 19, 2026"
  startTime: string; // HH:mm (24h)
  endTime: string; // HH:mm (24h)
  venue: string;
  description: string;
  bookingStatus: string;
  bookingWindowStart: string | null; // UTC ISO-8601
  bookingWindowEnd: string | null; // UTC ISO-8601
  bookingWindowDisplay: string | null;
  cancellationDeadline: string | null; // UTC ISO-8601
  capacity: string | null;
  waitlistCapacity: string | null;
  rewardPoints: number;
  attendanceInfo: string | null;
  canBook: boolean;
  hasWaitlist: boolean;
  purposeRequired: boolean;
  alreadyBooked: boolean;
  isWaitlisted: boolean;
}

export interface EventTermOption {
  value: string;
  label: string;
  selected: boolean;
}

export interface EventFilters {
  eventTerm?: string;
  dateFrom?: string;
  dateTo?: string;
  slotName?: string;
  sessionTime?: string;
}

export interface BookingJob {
  id: string;
  eventId: string;
  compositeId: string;
  sessionId: string | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  bookingWindowStart: string | null;
  bookingWindowEnd: string | null;
  purpose: string;
  status: JobStatus;
  isPaused: boolean;
  attempts: number;
  lastCheckedAt: string | null;
  nextRetryAt: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  authorized: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RetryConfig {
  maxRetries: number;
  maxRetryDurationSeconds: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface AppSettings {
  automationEnabled: boolean;
  pollIntervalSeconds: number;
  retry: RetryConfig;
}

export interface WorkerState {
  running: boolean;
  lastHeartbeatAt: string | null;
  sessionState: SessionState;
  sessionMessage: string;
  lastSessionCheckAt: string | null;
  connecting: boolean;
}

export type LogLevel = "info" | "warn" | "error" | "success";

export interface ActivityLog {
  id: number;
  jobId: string | null;
  level: LogLevel;
  message: string;
  details: string | null;
  createdAt: string;
}

export type WorkerCommandType =
  | "CONNECT_PORTAL"
  | "CHECK_SESSION"
  | "FETCH_EVENTS"
  | "BROADCAST_QUEUE"
  | "BROADCAST_SETTINGS";

export interface WorkerCommand {
  id: string;
  type: WorkerCommandType;
  payload: string | null;
  status: "pending" | "processing" | "done" | "failed";
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventChangeSummary {
  newlyAvailable: number;
  capacityChanged: number;
  windowChanged: number;
  newEvents: number;
}

export type WsMessage =
  | {
      type: "snapshot";
      workerState: WorkerState;
      settings: AppSettings;
      jobs: BookingJob[];
      events: PortalEvent[];
      terms: EventTermOption[];
      fetchedAt: string | null;
      logs: ActivityLog[];
    }
  | {
      type: "events_updated";
      events: PortalEvent[];
      terms: EventTermOption[];
      fetchedAt: string;
      changes: EventChangeSummary;
    }
  | {
      type: "portal_status";
      workerState: WorkerState;
    }
  | {
      type: "queue_updated";
      jobs: BookingJob[];
    }
  | {
      type: "job_event";
      job: BookingJob;
      eventType:
        | "attempt"
        | "retry"
        | "booked"
        | "already_booked"
        | "waitlisted"
        | "full"
        | "failed"
        | "auth_required"
        | "verification_required";
      message: string;
    }
  | {
      type: "log_added";
      log: ActivityLog;
    }
  | {
      type: "settings_updated";
      settings: AppSettings;
    };
