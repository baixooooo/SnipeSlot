import type { DatabaseSync } from "node:sqlite";
import { WebSocket, WebSocketServer } from "ws";
import { WS_HOST, WS_PORT } from "./config";
import {
  getEventsCache,
  getRecentActivityLogs,
  getSettings,
  getWorkerState,
} from "./database";
import { listJobs } from "./queue";
import type { WsMessage } from "./types";

export class SnipeSlotWsServer {
  private wss: WebSocketServer | null = null;
  private readonly db: DatabaseSync;
  private readonly host: string;
  private readonly port: number;

  constructor(db: DatabaseSync, host = WS_HOST, port = WS_PORT) {
    this.db = db;
    this.host = host;
    this.port = port;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        const addr = this.wss.address();
        resolve(typeof addr === "object" && addr ? addr.port : this.port);
        return;
      }

      const wss = new WebSocketServer({
        host: this.host,
        port: this.port,
      });

      wss.once("listening", () => {
        this.wss = wss;
        const addr = wss.address();
        resolve(typeof addr === "object" && addr ? addr.port : this.port);
      });

      wss.once("error", (err) => {
        reject(err);
      });

      wss.on("connection", (socket) => {
        try {
          const snapshot = this.buildSnapshot();
          socket.send(JSON.stringify(snapshot));
        } catch {
          // ignore send errors on closing sockets
        }
      });
    });
  }

  buildSnapshot(): WsMessage {
    const cache = getEventsCache(this.db);
    return {
      type: "snapshot",
      workerState: getWorkerState(this.db),
      settings: getSettings(this.db),
      jobs: listJobs(this.db),
      events: cache.events,
      terms: cache.terms,
      fetchedAt: cache.fetchedAt,
      logs: getRecentActivityLogs(this.db, 50),
    };
  }

  broadcast(message: WsMessage): void {
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // Non-blocking: ignore broken client socket
        }
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      const server = this.wss;
      this.wss = null;
      for (const client of server.clients) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
      }
      server.close(() => resolve());
    });
  }
}
