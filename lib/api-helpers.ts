import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { WORKER_HEARTBEAT_STALE_MS } from "./config";
import { getDatabase } from "./database";
import type { WorkerCommand, WorkerCommandType, WorkerState } from "./types";

const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Protect state-changing local API endpoints against cross-site requests.
 */
export function assertLocalRequest(request: NextRequest): NextResponse | null {
  const hostHeader = request.headers.get("host") || "";
  const hostName = hostHeader.split(":")[0].toLowerCase();
  if (hostName && !ALLOWED_LOCAL_HOSTS.has(hostName)) {
    return NextResponse.json(
      { error: "Forbidden: non-local host." },
      { status: 403 }
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!ALLOWED_LOCAL_HOSTS.has(originUrl.hostname.toLowerCase())) {
        return NextResponse.json(
          { error: "Forbidden: cross-origin request rejected." },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Forbidden: invalid Origin header." },
        { status: 403 }
      );
    }
  }

  return null;
}

export function isWorkerAlive(state: WorkerState): boolean {
  if (!state.running || !state.lastHeartbeatAt) return false;
  const hbMs = Date.parse(state.lastHeartbeatAt);
  if (Number.isNaN(hbMs)) return false;
  return Date.now() - hbMs < WORKER_HEARTBEAT_STALE_MS;
}

export function enqueueWorkerCommand(
  type: WorkerCommandType,
  payload?: unknown
): WorkerCommand {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const payloadStr = payload !== undefined ? JSON.stringify(payload) : null;

  db.prepare(
    `INSERT INTO worker_commands (id, type, payload, status, result, error, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', NULL, NULL, ?, ?)`
  ).run(id, type, payloadStr, now, now);

  return {
    id,
    type,
    payload: payloadStr,
    status: "pending",
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function waitForWorkerCommand(
  commandId: string,
  timeoutMs = 20_000
): Promise<WorkerCommand | null> {
  const db = getDatabase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const row = db
      .prepare(
        "SELECT id, type, payload, status, result, error, created_at, updated_at FROM worker_commands WHERE id = ?"
      )
      .get(commandId) as
      | {
          id: string;
          type: WorkerCommandType;
          payload: string | null;
          status: WorkerCommand["status"];
          result: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;
    if (row.status === "done" || row.status === "failed") {
      return {
        id: row.id,
        type: row.type,
        payload: row.payload,
        status: row.status,
        result: row.result,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  return null;
}
