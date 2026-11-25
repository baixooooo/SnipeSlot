import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertLocalRequest, enqueueWorkerCommand } from "@/lib/api-helpers";
import { getDatabase } from "@/lib/database";
import { pauseJob, removeJob, resumeJob } from "@/lib/queue";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const forbidden = assertLocalRequest(request);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action;
  if (action !== "pause" && action !== "resume") {
    return NextResponse.json(
      { error: "Invalid action. Expected 'pause' or 'resume'." },
      { status: 400 }
    );
  }

  const db = getDatabase();
  const job = action === "pause" ? pauseJob(db, id) : resumeJob(db, id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  enqueueWorkerCommand("BROADCAST_QUEUE");
  return NextResponse.json({ job });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const forbidden = assertLocalRequest(request);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  const db = getDatabase();
  const removed = removeJob(db, id);
  if (!removed) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  enqueueWorkerCommand("BROADCAST_QUEUE");
  return NextResponse.json({ removed: true });
}
