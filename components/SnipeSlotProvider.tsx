"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ActivityLog,
  AppSettings,
  BookingJob,
  EventTermOption,
  PortalEvent,
  WorkerState,
  WsMessage,
} from "@/lib/types";

interface SnipeSlotContextValue {
  workerState: WorkerState;
  settings: AppSettings;
  jobs: BookingJob[];
  events: PortalEvent[];
  terms: EventTermOption[];
  fetchedAt: string | null;
  logs: ActivityLog[];
  wsConnected: boolean;
  lastJobBanner: string | null;
  clearJobBanner: () => void;
  bookedToast: { id: string; title: string; message: string } | null;
  dismissBookedToast: () => void;
  refreshRestState: () => Promise<void>;
  applyFilteredEvents: (
    events: PortalEvent[],
    terms: EventTermOption[],
    fetchedAt: string | null
  ) => void;
}

const DEFAULT_WORKER_STATE: WorkerState = {
  running: false,
  lastHeartbeatAt: null,
  sessionState: "disconnected",
  sessionMessage: "Connecting...",
  lastSessionCheckAt: null,
  connecting: false,
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  automationEnabled: true,
  pollIntervalSeconds: 30,
  retry: {
    maxRetries: 8,
    maxRetryDurationSeconds: 300,
    baseDelayMs: 1000,
    maxDelayMs: 20000,
  },
};

const SnipeSlotContext = createContext<SnipeSlotContextValue | null>(null);

export function SnipeSlotProvider({ children }: { children: React.ReactNode }) {
  const [workerState, setWorkerState] =
    useState<WorkerState>(DEFAULT_WORKER_STATE);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [jobs, setJobs] = useState<BookingJob[]>([]);
  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [terms, setTerms] = useState<EventTermOption[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastJobBanner, setLastJobBanner] = useState<string | null>(null);
  const [bookedToast, setBookedToast] = useState<{
    id: string;
    title: string;
    message: string;
  } | null>(null);

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const unmountedRef = useRef(false);

  const refreshRestState = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        workerState: WorkerState;
        settings: AppSettings;
        jobs: BookingJob[];
        events: PortalEvent[];
        terms: EventTermOption[];
        fetchedAt: string | null;
        logs: ActivityLog[];
      };
      setWorkerState(data.workerState);
      setSettings(data.settings);
      setJobs(data.jobs);
      setEvents(data.events);
      if (data.terms.length > 0) setTerms(data.terms);
      setFetchedAt(data.fetchedAt);
      setLogs(data.logs);
    } catch {
      // ignore initial fetch error
    }
  }, []);

  const applyFilteredEvents = useCallback(
    (
      nextEvents: PortalEvent[],
      nextTerms: EventTermOption[],
      nextFetchedAt: string | null
    ) => {
      setEvents(nextEvents);
      if (nextTerms.length > 0) setTerms(nextTerms);
      if (nextFetchedAt) setFetchedAt(nextFetchedAt);
    },
    []
  );

  useEffect(() => {
    unmountedRef.current = false;
    void refreshRestState();

    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:3001";

    const connect = () => {
      if (unmountedRef.current) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (unmountedRef.current) {
          socket.close();
          return;
        }
        attemptRef.current = 0;
        setWsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WsMessage;
          switch (msg.type) {
            case "snapshot":
              setWorkerState(msg.workerState);
              setSettings(msg.settings);
              setJobs(msg.jobs);
              setEvents(msg.events);
              if (msg.terms.length > 0) setTerms(msg.terms);
              setFetchedAt(msg.fetchedAt);
              setLogs(msg.logs);
              break;
            case "events_updated":
              setEvents(msg.events);
              if (msg.terms.length > 0) setTerms(msg.terms);
              setFetchedAt(msg.fetchedAt);
              break;
            case "portal_status":
              setWorkerState(msg.workerState);
              break;
            case "queue_updated":
              setJobs(msg.jobs);
              break;
            case "settings_updated":
              setSettings(msg.settings);
              break;
            case "log_added":
              setLogs((prev) => [msg.log, ...prev].slice(0, 100));
              break;
            case "job_event":
              setLastJobBanner(msg.message);
              if (
                msg.eventType === "booked" ||
                msg.eventType === "already_booked"
              ) {
                setBookedToast({
                  id: `${msg.job.id}-${Date.now()}`,
                  title: msg.job.title,
                  message: msg.message,
                });
                setTimeout(() => {
                  setBookedToast((cur) =>
                    cur?.title === msg.job.title ? null : cur
                  );
                }, 6000);
              }
              break;
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (!unmountedRef.current) {
          scheduleReconnect();
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      attemptRef.current += 1;
      const delay = Math.min(15_000, 1000 * Math.pow(2, attemptRef.current - 1));
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [refreshRestState]);

  return (
    <SnipeSlotContext.Provider
      value={{
        workerState,
        settings,
        jobs,
        events,
        terms,
        fetchedAt,
        logs,
        wsConnected,
        lastJobBanner,
        clearJobBanner: () => setLastJobBanner(null),
        bookedToast,
        dismissBookedToast: () => setBookedToast(null),
        refreshRestState,
        applyFilteredEvents,
      }}
    >
      {children}
    </SnipeSlotContext.Provider>
  );
}

export function useSnipeSlot(): SnipeSlotContextValue {
  const ctx = useContext(SnipeSlotContext);
  if (!ctx) {
    throw new Error("useSnipeSlot must be used inside SnipeSlotProvider");
  }
  return ctx;
}
