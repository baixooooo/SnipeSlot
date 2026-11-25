import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  assertLocalRequest,
  enqueueWorkerCommand,
  isWorkerAlive,
  waitForWorkerCommand,
} from "@/lib/api-helpers";
import { getDatabase, getWorkerState } from "@/lib/database";

export async function POST(request: NextRequest) {
  const forbidden = assertLocalRequest(request);
  if (forbidden) return forbidden;

  const db = getDatabase();
  const state = getWorkerState(db);
  if (!isWorkerAlive(state)) {
    return NextResponse.json(
      { error: "Background worker is not running." },
      { status: 503 }
    );
  }

  const cmd = enqueueWorkerCommand("CHECK_SESSION");
  const completed = await waitForWorkerCommand(cmd.id, 20_000);
  if (!completed) {
    return NextResponse.json(
      { error: "Timed out waiting for worker session check." },
      { status: 504 }
    );
  }

  if (completed.status === "failed") {
    return NextResponse.json(
      { error: completed.error || "Session check failed." },
      { status: 500 }
    );
  }

  const parsed = completed.result ? JSON.parse(completed.result) : {};
  return NextResponse.json(parsed);
}
