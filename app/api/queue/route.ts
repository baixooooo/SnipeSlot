import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertLocalRequest, enqueueWorkerCommand } from "@/lib/api-helpers";
import { getDatabase } from "@/lib/database";
import {
  createJob,
  DuplicateJobError,
  listJobs,
  ValidationError,
} from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDatabase();
  const jobs = listJobs(db);
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const forbidden = assertLocalRequest(request);
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const db = getDatabase();
    const job = createJob(db, {
      eventId: typeof body.eventId === "string" ? body.eventId : undefined,
      compositeId:
        typeof body.compositeId === "string" ? body.compositeId : undefined,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      title: typeof body.title === "string" ? body.title : "",
      date: typeof body.date === "string" ? body.date : "",
      startTime: typeof body.startTime === "string" ? body.startTime : "",
      endTime: typeof body.endTime === "string" ? body.endTime : "",
      venue: typeof body.venue === "string" ? body.venue : "",
      bookingWindowStart:
        typeof body.bookingWindowStart === "string"
          ? body.bookingWindowStart
          : null,
      bookingWindowEnd:
        typeof body.bookingWindowEnd === "string"
          ? body.bookingWindowEnd
          : null,
      purpose: typeof body.purpose === "string" ? body.purpose : "",
      authorized: body.authorized === true,
    });

    enqueueWorkerCommand("BROADCAST_QUEUE");
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof DuplicateJobError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : "Failed to create job.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
