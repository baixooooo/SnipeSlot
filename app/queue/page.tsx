"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pause, Play, Trash2 } from "lucide-react";
import { useSnipeSlot } from "@/components/SnipeSlotProvider";
import { StatusBadge } from "@/components/StatusBadge";
import {
  formatCountdown,
  formatIstDateTime,
  formatIstTimeWithSeconds,
} from "@/lib/format";
import type { BookingJob } from "@/lib/types";

const COMPLETED_STATUSES = new Set([
  "Booked",
  "Waitlisted",
  "Full",
  "Failed",
  "Cancelled",
]);

const CONFETTI_PARTICLES = [
  { tx: "-48px", ty: "-34px", rot: "-45deg", color: "bg-blue-500" },
  { tx: "-22px", ty: "-44px", rot: "30deg", color: "bg-emerald-400" },
  { tx: "12px", ty: "-46px", rot: "-20deg", color: "bg-amber-400" },
  { tx: "42px", ty: "-36px", rot: "55deg", color: "bg-blue-400" },
  { tx: "54px", ty: "-14px", rot: "85deg", color: "bg-emerald-500" },
  { tx: "-52px", ty: "-12px", rot: "-75deg", color: "bg-sky-400" },
];

type QueueTab = "upcoming" | "completed" | "all";

export default function QueuePage() {
  const { jobs, logs } = useSnipeSlot();
  const [tab, setTab] = useState<QueueTab>("upcoming");
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const prevActiveCountRef = useRef<number | null>(null);

  useEffect(() => {
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  const { totalCount, completedCount, activeCount, progressPct } = useMemo(() => {
    const total = jobs.length;
    const completed = jobs.filter((j) => COMPLETED_STATUSES.has(j.status)).length;
    const active = total - completed;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return {
      totalCount: total,
      completedCount: completed,
      activeCount: active,
      progressPct: pct,
    };
  }, [jobs]);

  useEffect(() => {
    if (
      prevActiveCountRef.current !== null &&
      prevActiveCountRef.current > 0 &&
      activeCount === 0 &&
      totalCount > 0
    ) {
      setCelebrating(true);
      const timer = setTimeout(() => setCelebrating(false), 1600);
      prevActiveCountRef.current = activeCount;
      return () => clearTimeout(timer);
    }
    prevActiveCountRef.current = activeCount;
  }, [activeCount, totalCount]);

  const filteredJobs = useMemo(() => {
    if (tab === "upcoming") {
      return jobs.filter((j) => !COMPLETED_STATUSES.has(j.status));
    }
    if (tab === "completed") {
      return jobs.filter((j) => COMPLETED_STATUSES.has(j.status));
    }
    return jobs;
  }, [jobs, tab]);

  const handleTogglePause = async (job: BookingJob) => {
    setBusyId(job.id);
    try {
      await fetch(`/api/queue/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: job.isPaused ? "resume" : "pause" }),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (job: BookingJob) => {
    setBusyId(job.id);
    try {
      await fetch(`/api/queue/${job.id}`, { method: "DELETE" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
            Queue
          </h1>
          
        </div>

        <div className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-0.5 text-xs dark:border-zinc-800 dark:bg-[#121215]">
          {(["upcoming", "completed", "all"] as QueueTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 capitalize ${
                tab === t
                  ? "bg-white font-medium text-zinc-950 shadow-2xs dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-none"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Sleek Queue Progress Bar */}
      {totalCount > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>
              {completedCount} of {totalCount} processed
            </span>
            <span className="font-mono">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800/80">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                progressPct === 100
                  ? "bg-emerald-500 dark:bg-emerald-400"
                  : "bg-blue-600 dark:bg-blue-500"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800/80 dark:bg-[#121215]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-medium text-zinc-500 dark:border-zinc-800/80 dark:bg-[#16161a] dark:text-zinc-400">
              <th className="px-3.5 py-2.5">Event & Venue</th>
              <th className="px-3.5 py-2.5">Session</th>
              <th className="px-3.5 py-2.5">Opens (IST)</th>
              <th className="px-3.5 py-2.5">Countdown</th>
              <th className="px-3.5 py-2.5">Status</th>
              <th className="px-3.5 py-2.5">Attempts</th>
              <th className="px-3.5 py-2.5">Confirmation / Reason</th>
              <th className="px-3.5 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                  No {tab === "all" ? "" : tab} booking jobs.
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => {
                const isCompleted = COMPLETED_STATUSES.has(job.status);
                return (
                  <tr
                    key={job.id}
                    className="hover:bg-zinc-50/70 dark:hover:bg-[#18181c]"
                  >
                    <td className="px-3.5 py-2.5">
                      <div className="font-medium text-zinc-950 dark:text-zinc-100">
                        {job.title}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        Venue {job.venue}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <div className="text-zinc-800 dark:text-zinc-300">
                        {job.date}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {job.startTime}–{job.endTime}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {formatIstDateTime(job.bookingWindowStart)}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
                      {isCompleted
                        ? "—"
                        : formatCountdown(job.bookingWindowStart, nowMs)}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge status={job.status} isPaused={job.isPaused} />
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {job.attempts}
                    </td>
                    <td className="px-3.5 py-2.5 max-w-xs text-[11px]">
                      {job.status === "Booked" && job.confirmedAt ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Confirmed {formatIstTimeWithSeconds(job.confirmedAt)}
                        </span>
                      ) : job.errorMessage ? (
                        <span className="text-red-600 dark:text-red-400">
                          {job.errorMessage}
                        </span>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-600">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {!isCompleted && (
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => void handleTogglePause(job)}
                            title={job.isPaused ? "Resume" : "Pause"}
                            className="rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96] disabled:opacity-40 dark:border-zinc-800 dark:bg-[#18181c] dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
                          >
                            {job.isPaused ? (
                              <Play className="h-3.5 w-3.5" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === job.id}
                          onClick={() => void handleRemove(job)}
                          title="Remove"
                          className="rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 active:scale-[0.96] disabled:opacity-40 dark:border-zinc-800 dark:bg-[#18181c] dark:text-zinc-400 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Collapsible Execution Log */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800/80 dark:bg-[#121215]">
        <button
          type="button"
          onClick={() => setLogsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-[#18181c]"
        >
          <span className="inline-flex items-center gap-1.5">
            {logsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
            )}
            <span>Execution Log</span>
          </span>
          <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
            {logs.length} entries
          </span>
        </button>

        {logsOpen && (
          <div className="max-h-64 divide-y divide-zinc-100 overflow-y-auto border-t border-zinc-200 dark:divide-zinc-800/60 dark:border-zinc-800/80">
            {logs.length === 0 ? (
              <div className="px-4 py-4 text-center text-xs text-zinc-500">
                No execution logs yet.
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between gap-3 px-4 py-2 text-[11px]"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        log.level === "success"
                          ? "bg-emerald-500 dark:bg-emerald-400"
                          : log.level === "error"
                          ? "bg-red-500 dark:bg-red-400"
                          : log.level === "warn"
                          ? "bg-amber-500 dark:bg-amber-400"
                          : "bg-zinc-400 dark:bg-zinc-500"
                      }`}
                    />
                    <span className="text-zinc-800 dark:text-zinc-300">
                      {log.message}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {formatIstTimeWithSeconds(log.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
