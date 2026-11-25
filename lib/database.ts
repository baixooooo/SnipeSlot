import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_DB_PATH, DEFAULT_SETTINGS } from "./config";
import type {
  ActivityLog,
  AppSettings,
  EventTermOption,
  LogLevel,
  PortalEvent,
  WorkerState,
} from "./types";

let cachedDb: DatabaseSync | null = null;
let cachedDbPath: string | null = null;

export function resolveDbPath(overridePath?: string): string {
  return overridePath || process.env.SNIPESLOT_DB_PATH || DEFAULT_DB_PATH;
}

export function getDatabase(overridePath?: string): DatabaseSync {
  const targetPath = resolveDbPath(overridePath);
  if (cachedDb && cachedDbPath === targetPath) {
    return cachedDb;
  }

  if (targetPath !== ":memory:") {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");

  initializeSchema(db);

  cachedDb = db;
  cachedDbPath = targetPath;
  return db;
}

export function closeDatabase(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      // ignore close errors
    }
    cachedDb = null;
    cachedDbPath = null;
  }
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_jobs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      composite_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      venue TEXT NOT NULL,
      booking_window_start TEXT,
      booking_window_end TEXT,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL,
      is_paused INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      next_retry_at TEXT,
      error_message TEXT,
      confirmed_at TEXT,
      authorized INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_booking_jobs_status ON booking_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_booking_jobs_composite ON booking_jobs(composite_id);

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worker_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      running INTEGER NOT NULL DEFAULT 0,
      last_heartbeat_at TEXT,
      session_state TEXT NOT NULL DEFAULT 'disconnected',
      session_message TEXT NOT NULL DEFAULT 'Portal not connected yet.',
      last_session_check_at TEXT,
      connecting INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS worker_commands (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      events_json TEXT NOT NULL,
      terms_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT OR IGNORE INTO worker_state (id, running, session_state, session_message, connecting)
    VALUES (1, 0, 'disconnected', 'Portal not connected yet.', 0)
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value)
    VALUES ('settings', ?)
  `).run(JSON.stringify(DEFAULT_SETTINGS));

  // Safe migration: never execute or treat historical dry-run jobs as live confirmed bookings
  db.prepare(`
    UPDATE booking_jobs
    SET status = 'Cancelled',
        error_message = 'Historical dry-run job (not executed live)'
    WHERE status = 'Booked'
      AND error_message LIKE '%[DRY-RUN]%'
  `).run();
}

export function getSettings(db: DatabaseSync): AppSettings {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'settings'")
    .get() as { value: string } | undefined;

  if (!row) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<AppSettings>;
    return {
      automationEnabled: parsed.automationEnabled ?? DEFAULT_SETTINGS.automationEnabled,
      pollIntervalSeconds:
        parsed.pollIntervalSeconds ?? DEFAULT_SETTINGS.pollIntervalSeconds,
      retry: {
        maxRetries: parsed.retry?.maxRetries ?? DEFAULT_SETTINGS.retry.maxRetries,
        maxRetryDurationSeconds:
          parsed.retry?.maxRetryDurationSeconds ??
          DEFAULT_SETTINGS.retry.maxRetryDurationSeconds,
        baseDelayMs: parsed.retry?.baseDelayMs ?? DEFAULT_SETTINGS.retry.baseDelayMs,
        maxDelayMs: parsed.retry?.maxDelayMs ?? DEFAULT_SETTINGS.retry.maxDelayMs,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function updateSettings(
  db: DatabaseSync,
  partial: Partial<AppSettings>
): AppSettings {
  const current = getSettings(db);
  const next: AppSettings = {
    automationEnabled: partial.automationEnabled ?? current.automationEnabled,
    pollIntervalSeconds:
      partial.pollIntervalSeconds ?? current.pollIntervalSeconds,
    retry: {
      maxRetries: partial.retry?.maxRetries ?? current.retry.maxRetries,
      maxRetryDurationSeconds:
        partial.retry?.maxRetryDurationSeconds ??
        current.retry.maxRetryDurationSeconds,
      baseDelayMs: partial.retry?.baseDelayMs ?? current.retry.baseDelayMs,
      maxDelayMs: partial.retry?.maxDelayMs ?? current.retry.maxDelayMs,
    },
  };

  db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?)"
  ).run(JSON.stringify(next));
  return next;
}

export function getWorkerState(db: DatabaseSync): WorkerState {
  const row = db
    .prepare(
      "SELECT running, last_heartbeat_at, session_state, session_message, last_session_check_at, connecting FROM worker_state WHERE id = 1"
    )
    .get() as
    | {
        running: number;
        last_heartbeat_at: string | null;
        session_state: WorkerState["sessionState"];
        session_message: string;
        last_session_check_at: string | null;
        connecting: number;
      }
    | undefined;

  if (!row) {
    return {
      running: false,
      lastHeartbeatAt: null,
      sessionState: "disconnected",
      sessionMessage: "Worker has not started.",
      lastSessionCheckAt: null,
      connecting: false,
    };
  }

  return {
    running: Boolean(row.running),
    lastHeartbeatAt: row.last_heartbeat_at,
    sessionState: row.session_state,
    sessionMessage: row.session_message,
    lastSessionCheckAt: row.last_session_check_at,
    connecting: Boolean(row.connecting),
  };
}

export function updateWorkerState(
  db: DatabaseSync,
  patch: Partial<WorkerState>
): WorkerState {
  const current = getWorkerState(db);
  const next: WorkerState = {
    ...current,
    ...patch,
  };

  db.prepare(`
    UPDATE worker_state
    SET running = ?,
        last_heartbeat_at = ?,
        session_state = ?,
        session_message = ?,
        last_session_check_at = ?,
        connecting = ?
    WHERE id = 1
  `).run(
    next.running ? 1 : 0,
    next.lastHeartbeatAt,
    next.sessionState,
    next.sessionMessage,
    next.lastSessionCheckAt,
    next.connecting ? 1 : 0
  );

  return next;
}

export function addActivityLog(
  db: DatabaseSync,
  level: LogLevel,
  message: string,
  jobId: string | null = null,
  details: string | null = null
): ActivityLog {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      "INSERT INTO activity_logs (job_id, level, message, details, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(jobId, level, message, details, now);

  return {
    id: Number(info.lastInsertRowid),
    jobId,
    level,
    message,
    details,
    createdAt: now,
  };
}

export function getRecentActivityLogs(
  db: DatabaseSync,
  limit = 50
): ActivityLog[] {
  const rows = db
    .prepare(
      "SELECT id, job_id, level, message, details, created_at FROM activity_logs ORDER BY id DESC LIMIT ?"
    )
    .all(limit) as Array<{
    id: number;
    job_id: string | null;
    level: LogLevel;
    message: string;
    details: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    level: r.level,
    message: r.message,
    details: r.details,
    createdAt: r.created_at,
  }));
}

export function saveEventsCache(
  db: DatabaseSync,
  events: PortalEvent[],
  terms: EventTermOption[]
): string {
  const fetchedAt = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO events_cache (id, events_json, terms_json, fetched_at) VALUES (1, ?, ?, ?)"
  ).run(JSON.stringify(events), JSON.stringify(terms), fetchedAt);
  return fetchedAt;
}

export function getEventsCache(db: DatabaseSync): {
  events: PortalEvent[];
  terms: EventTermOption[];
  fetchedAt: string | null;
} {
  const row = db
    .prepare(
      "SELECT events_json, terms_json, fetched_at FROM events_cache WHERE id = 1"
    )
    .get() as
    | { events_json: string; terms_json: string; fetched_at: string }
    | undefined;

  if (!row) {
    return { events: [], terms: [], fetchedAt: null };
  }

  try {
    return {
      events: JSON.parse(row.events_json) as PortalEvent[],
      terms: JSON.parse(row.terms_json) as EventTermOption[],
      fetchedAt: row.fetched_at,
    };
  } catch {
    return { events: [], terms: [], fetchedAt: null };
  }
}
