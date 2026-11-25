import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertLocalRequest, enqueueWorkerCommand } from "@/lib/api-helpers";
import {
  addActivityLog,
  getDatabase,
  getSettings,
  updateSettings,
} from "@/lib/database";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDatabase();
  return NextResponse.json({ settings: getSettings(db) });
}

export async function PATCH(request: NextRequest) {
  const forbidden = assertLocalRequest(request);
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Partial<AppSettings> = {};
  if (typeof body.automationEnabled === "boolean") {
    patch.automationEnabled = body.automationEnabled;
  }
  if (body.pollIntervalSeconds !== undefined) {
    const interval = Number(body.pollIntervalSeconds);
    if (!Number.isInteger(interval) || interval < 10 || interval > 300) {
      return NextResponse.json(
        { error: "Poll interval must be an integer between 10 and 300 seconds." },
        { status: 400 }
      );
    }
    patch.pollIntervalSeconds = interval;
  }

  if (body.retry && typeof body.retry === "object") {
    const r = body.retry as Record<string, unknown>;
    const maxRetries = Number(r.maxRetries);
    const maxRetryDurationSeconds = Number(r.maxRetryDurationSeconds);
    const baseDelayMs = Number(r.baseDelayMs);
    const maxDelayMs = Number(r.maxDelayMs);

    if (
      (r.maxRetries !== undefined &&
        (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 50)) ||
      (r.maxRetryDurationSeconds !== undefined &&
        (!Number.isFinite(maxRetryDurationSeconds) ||
          maxRetryDurationSeconds < 10 ||
          maxRetryDurationSeconds > 3600)) ||
      (r.baseDelayMs !== undefined &&
        (!Number.isFinite(baseDelayMs) || baseDelayMs < 250 || baseDelayMs > 30000)) ||
      (r.maxDelayMs !== undefined &&
        (!Number.isFinite(maxDelayMs) || maxDelayMs < 1000 || maxDelayMs > 120000))
    ) {
      return NextResponse.json(
        { error: "Retry configuration values are out of valid bounds." },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const cur = getSettings(db).retry;
    patch.retry = {
      maxRetries: r.maxRetries !== undefined ? maxRetries : cur.maxRetries,
      maxRetryDurationSeconds:
        r.maxRetryDurationSeconds !== undefined
          ? maxRetryDurationSeconds
          : cur.maxRetryDurationSeconds,
      baseDelayMs: r.baseDelayMs !== undefined ? baseDelayMs : cur.baseDelayMs,
      maxDelayMs: r.maxDelayMs !== undefined ? maxDelayMs : cur.maxDelayMs,
    };
  }

  const db = getDatabase();
  const updated = updateSettings(db, patch);
  addActivityLog(
    db,
    "info",
    `Updated settings (automation=${updated.automationEnabled}, poll=${updated.pollIntervalSeconds}s)`
  );
  enqueueWorkerCommand("BROADCAST_SETTINGS");

  return NextResponse.json({ settings: updated });
}
