import { NextResponse } from "next/server";
import { isWorkerAlive } from "@/lib/api-helpers";
import {
  getDatabase,
  getEventsCache,
  getRecentActivityLogs,
  getSettings,
  getWorkerState,
} from "@/lib/database";
import { listJobs } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDatabase();
  const workerState = getWorkerState(db);
  const workerAlive = isWorkerAlive(workerState);
  const settings = getSettings(db);
  const jobs = listJobs(db);
  const cache = getEventsCache(db);
  const logs = getRecentActivityLogs(db, 50);

  return NextResponse.json({
    workerState: {
      ...workerState,
      running: workerAlive,
    },
    settings,
    jobs,
    events: cache.events,
    terms: cache.terms,
    fetchedAt: cache.fetchedAt,
    logs,
  });
}
