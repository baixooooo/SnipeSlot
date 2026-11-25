import { WORKER_POLL_INTERVAL_MS, WS_HOST, WS_PORT } from "../lib/config";
import {
  addActivityLog,
  closeDatabase,
  getDatabase,
  getEventsCache,
  getSettings,
  saveEventsCache,
  updateWorkerState,
} from "../lib/database";
import { detectEventChanges, EventMonitor } from "../lib/monitor";
import { PortalBrowserManager } from "../lib/portal/browser";
import { checkPortalSession, fetchPortalEvents } from "../lib/portal/session";
import {
  listJobs,
  recoverInterruptedJobs,
  resumeAuthRequiredJobs,
} from "../lib/queue";
import { BookingScheduler } from "../lib/scheduler";
import type { EventFilters, WorkerCommand } from "../lib/types";
import { SnipeSlotWsServer } from "../lib/ws-server";

const db = getDatabase();
const browserManager = new PortalBrowserManager();
const wsServer = new SnipeSlotWsServer(db, WS_HOST, WS_PORT);

let processingCommand = false;
let shuttingDown = false;

const monitor = new EventMonitor({
  db,
  browserManager,
  broadcast: (msg) => wsServer.broadcast(msg),
  isBusy: () => processingCommand,
});

const scheduler = new BookingScheduler({
  db,
  browserManager,
  broadcast: (msg) => wsServer.broadcast(msg),
  isBusyWithCommand: () => processingCommand,
});

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE worker_commands SET status = 'processing', updated_at = ? WHERE id = ?"
  ).run(now, cmd.id);

  try {
    if (cmd.type === "BROADCAST_QUEUE") {
      wsServer.broadcast({ type: "queue_updated", jobs: listJobs(db) });
      db.prepare(
        "UPDATE worker_commands SET status = 'done', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), cmd.id);
      return;
    }

    if (cmd.type === "BROADCAST_SETTINGS") {
      wsServer.broadcast({ type: "settings_updated", settings: getSettings(db) });
      db.prepare(
        "UPDATE worker_commands SET status = 'done', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), cmd.id);
      return;
    }

    if (cmd.type === "CONNECT_PORTAL") {
      const connectingState = updateWorkerState(db, {
        connecting: true,
        sessionMessage: "Waiting for manual login in Chromium window...",
      });
      wsServer.broadcast({ type: "portal_status", workerState: connectingState });

      const logOpen = addActivityLog(
        db,
        "info",
        "Opened Chromium window for manual portal login."
      );
      wsServer.broadcast({ type: "log_added", log: logOpen });

      const connectRes = await browserManager.connectInteractive();
      let sessionState:
        | "authenticated"
        | "expired"
        | "unavailable"
        | "disconnected" = "disconnected";
      let sessionMessage = connectRes.message;

      if (connectRes.success) {
        const ctx = await browserManager.ensureHeadlessContext();
        const check = await checkPortalSession(ctx);
        sessionState = check.state;
        sessionMessage = check.message;
      }

      const finalState = updateWorkerState(db, {
        connecting: false,
        sessionState,
        sessionMessage,
        lastSessionCheckAt: new Date().toISOString(),
      });
      wsServer.broadcast({ type: "portal_status", workerState: finalState });

      const logDone = addActivityLog(
        db,
        connectRes.success ? "success" : "warn",
        sessionMessage
      );
      wsServer.broadcast({ type: "log_added", log: logDone });

      if (sessionState === "authenticated") {
        const resumed = resumeAuthRequiredJobs(db);
        if (resumed > 0) {
          const resumeLog = addActivityLog(
            db,
            "info",
            `Resumed ${resumed} authorized booking job(s) after reconnection.`
          );
          wsServer.broadcast({ type: "log_added", log: resumeLog });
          wsServer.broadcast({ type: "queue_updated", jobs: listJobs(db) });
        }
        // Trigger immediate event sync after login
        void monitor.pollOnce();
      }

      db.prepare(
        "UPDATE worker_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?"
      ).run(
        JSON.stringify({
          success: connectRes.success,
          sessionState,
          message: sessionMessage,
        }),
        new Date().toISOString(),
        cmd.id
      );
      return;
    }

    if (cmd.type === "CHECK_SESSION") {
      const ctx = await browserManager.ensureHeadlessContext();
      const check = await checkPortalSession(ctx);
      const workerState = updateWorkerState(db, {
        sessionState: check.state,
        sessionMessage: check.message,
        lastSessionCheckAt: new Date().toISOString(),
      });
      wsServer.broadcast({ type: "portal_status", workerState });

      db.prepare(
        "UPDATE worker_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(check), new Date().toISOString(), cmd.id);
      return;
    }

    if (cmd.type === "FETCH_EVENTS") {
      const filters: EventFilters = cmd.payload ? JSON.parse(cmd.payload) : {};
      monitor.setFilters(filters);

      const ctx = await browserManager.ensureHeadlessContext();
      const res = await fetchPortalEvents(ctx, filters);

      const workerState = updateWorkerState(db, {
        sessionState: res.sessionState,
        sessionMessage:
          res.errorMessage || "Portal session is active and authenticated.",
        lastSessionCheckAt: new Date().toISOString(),
      });
      wsServer.broadcast({ type: "portal_status", workerState });

      if (res.ok) {
        const prev = getEventsCache(db);
        const changes = detectEventChanges(prev.events, res.events);
        const fetchedAt = saveEventsCache(db, res.events, res.terms);
        wsServer.broadcast({
          type: "events_updated",
          events: res.events,
          terms: res.terms,
          fetchedAt,
          changes,
        });
      }

      db.prepare(
        "UPDATE worker_commands SET status = 'done', result = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(res), new Date().toISOString(), cmd.id);
      return;
    }

    throw new Error(`Unknown command type: ${cmd.type}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const workerState = updateWorkerState(db, { connecting: false });
    wsServer.broadcast({ type: "portal_status", workerState });
    db.prepare(
      "UPDATE worker_commands SET status = 'failed', error = ?, updated_at = ? WHERE id = ?"
    ).run(msg, new Date().toISOString(), cmd.id);
    const log = addActivityLog(
      db,
      "error",
      `Worker command ${cmd.type} failed: ${msg}`
    );
    wsServer.broadcast({ type: "log_added", log });
  }
}

async function pollCommands(): Promise<void> {
  if (shuttingDown || processingCommand) return;

  const row = db
    .prepare(
      "SELECT id, type, payload, status, result, error, created_at, updated_at FROM worker_commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    )
    .get() as
    | {
        id: string;
        type: WorkerCommand["type"];
        payload: string | null;
        status: WorkerCommand["status"];
        result: string | null;
        error: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return;

  processingCommand = true;
  try {
    await handleCommand({
      id: row.id,
      type: row.type,
      payload: row.payload,
      status: row.status,
      result: row.result,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } finally {
    processingCommand = false;
  }
}

async function main(): Promise<void> {
  const recovered = recoverInterruptedJobs(db);
  if (recovered > 0) {
    addActivityLog(
      db,
      "info",
      `Recovered ${recovered} interrupted booking job(s) after worker startup.`
    );
  }

  try {
    const wsPort = await wsServer.start();
    addActivityLog(
      db,
      "info",
      `WebSocket server listening on ws://${WS_HOST}:${wsPort}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addActivityLog(db, "warn", `WebSocket server failed to start: ${msg}`);
  }

  const startState = updateWorkerState(db, {
    running: true,
    connecting: false,
    lastHeartbeatAt: new Date().toISOString(),
  });
  wsServer.broadcast({ type: "portal_status", workerState: startState });
  const startLog = addActivityLog(
    db,
    "info",
    "SnipeSlot background worker started."
  );
  wsServer.broadcast({ type: "log_added", log: startLog });

  // Warm persistent Chromium context and immediately start continuous event monitoring
  try {
    await browserManager.ensureHeadlessContext();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateWorkerState(db, {
      sessionState: "disconnected",
      sessionMessage: `Browser initialization error: ${msg}`,
    });
  }

  monitor.start();
  scheduler.start();

  const commandTimer = setInterval(() => {
    void pollCommands();
  }, 300);

  const heartbeatTimer = setInterval(() => {
    if (!shuttingDown) {
      updateWorkerState(db, {
        running: true,
        lastHeartbeatAt: new Date().toISOString(),
      });
    }
  }, Math.max(WORKER_POLL_INTERVAL_MS, 5000));

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(commandTimer);
    clearInterval(heartbeatTimer);
    monitor.stop();
    scheduler.stop();

    const stopState = updateWorkerState(db, {
      running: false,
      connecting: false,
    });
    wsServer.broadcast({ type: "portal_status", workerState: stopState });
    addActivityLog(
      db,
      "info",
      `SnipeSlot background worker stopped (${signal}).`
    );

    await wsServer.close();
    await browserManager.close();
    closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
