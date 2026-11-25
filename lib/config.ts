import path from "path";
import type { AppSettings } from "./types";

export const PORTAL_BASE_URL = "https://learner.saveetha.in";
export const PORTAL_BOOKING_URL = `${PORTAL_BASE_URL}/academicevents/event-booking/`;
export const PORTAL_TIMEZONE = "Asia/Kolkata";
export const PORTAL_UTC_OFFSET_MINUTES = 330; // +05:30

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const DEFAULT_DB_PATH = path.join(DATA_DIR, "snipeslot.db");
export const BROWSER_PROFILE_DIR = path.resolve(process.cwd(), "browser-session");

export const WS_HOST = "127.0.0.1";
export const WS_PORT = Number.parseInt(process.env.SNIPESLOT_WS_PORT || "3001", 10);

export const DEFAULT_SETTINGS: AppSettings = {
  automationEnabled: true,
  pollIntervalSeconds: 30,
  retry: {
    maxRetries: 8,
    maxRetryDurationSeconds: 300,
    baseDelayMs: 1000,
    maxDelayMs: 20000,
  },
};

export const PREPARING_LEAD_SECONDS = 60;
export const WORKER_POLL_INTERVAL_MS = 1000;
export const WORKER_HEARTBEAT_STALE_MS = 15000;
