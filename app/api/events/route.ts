import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  enqueueWorkerCommand,
  isWorkerAlive,
  waitForWorkerCommand,
} from "@/lib/api-helpers";
import {
  getDatabase,
  getEventsCache,
  getWorkerState,
} from "@/lib/database";
import type { EventFilters } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const refresh = searchParams.get("refresh") === "true";

  const filters: EventFilters = {
    eventTerm: searchParams.get("eventTerm") || undefined,
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
    slotName: searchParams.get("slotName") || undefined,
    sessionTime: searchParams.get("sessionTime") || undefined,
  };

  const hasFilters = Object.values(filters).some(Boolean);
  const db = getDatabase();

  if (!refresh && !hasFilters) {
    const cached = getEventsCache(db);
    return NextResponse.json({
      events: cached.events,
      terms: cached.terms,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    });
  }

  const state = getWorkerState(db);
  if (!isWorkerAlive(state)) {
    const cached = getEventsCache(db);
    return NextResponse.json(
      {
        events: cached.events,
        terms: cached.terms,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        error: "Background worker is not running. Showing cached events.",
      },
      { status: 503 }
    );
  }

  const cmd = enqueueWorkerCommand("FETCH_EVENTS", filters);
  const completed = await waitForWorkerCommand(cmd.id, 20_000);

  if (!completed) {
    return NextResponse.json(
      { error: "Timed out waiting for worker to fetch events." },
      { status: 504 }
    );
  }

  if (completed.status === "failed") {
    return NextResponse.json(
      { error: completed.error || "Failed to fetch events from portal." },
      { status: 500 }
    );
  }

  const res = completed.result ? JSON.parse(completed.result) : {};
  return NextResponse.json({
    events: res.events ?? [],
    terms: res.terms ?? [],
    ok: res.ok ?? false,
    sessionState: res.sessionState,
    error: res.errorMessage ?? null,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  });
}
