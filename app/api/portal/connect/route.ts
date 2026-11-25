import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  assertLocalRequest,
  enqueueWorkerCommand,
  isWorkerAlive,
} from "@/lib/api-helpers";
import { getDatabase, getWorkerState } from "@/lib/database";

export async function POST(request: NextRequest) {
  const forbidden = assertLocalRequest(request);
  if (forbidden) return forbidden;

  const db = getDatabase();
  const state = getWorkerState(db);
  if (!isWorkerAlive(state)) {
    return NextResponse.json(
      {
        error:
          "Background worker is not running. Start the app with `npm run dev` or `npm start`.",
      },
      { status: 503 }
    );
  }

  if (state.connecting) {
    return NextResponse.json(
      { message: "Portal login window is already open." },
      { status: 202 }
    );
  }

  const cmd = enqueueWorkerCommand("CONNECT_PORTAL");
  return NextResponse.json(
    {
      commandId: cmd.id,
      message: "Launching Chromium window for manual portal authentication...",
    },
    { status: 202 }
  );
}
