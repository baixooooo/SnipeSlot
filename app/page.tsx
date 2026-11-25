"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSnipeSlot } from "@/components/SnipeSlotProvider";
import { StatusBadge } from "@/components/StatusBadge";
import {
  formatIstDateTime,
  formatIstTimeWithSeconds,
  isPastEventSlot,
} from "@/lib/format";
import type { EventTermOption, PortalEvent } from "@/lib/types";

export default function EventsPage() {
  const {
    events,
    fetchedAt,
    jobs,
    workerState,
    applyFilteredEvents,
  } = useSnipeSlot();

  const [selectedType, setSelectedType] = useState<
    "all" | "module" | "cia" | "viva" | "other"
  >("all");
  const [slotName, setSlotName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sessionTime, setSessionTime] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<PortalEvent | null>(null);
  const [purpose, setPurpose] = useState("");
  const [purposeShake, setPurposeShake] = useState(false);
  const purposeInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const activeCompositeIds = useMemo(() => {
    const terminal = new Set([
      "Booked",
      "Waitlisted",
      "Full",
      "Failed",
      "Cancelled",
    ]);
    const set = new Set<string>();
    for (const j of jobs) {
      if (!terminal.has(j.status)) {
        set.add(j.compositeId);
      }
    }
    return set;
  }, [jobs]);

  const upcomingEvents = useMemo(() => {
    const nowMs = Date.now();
    return events.filter((evt) => !isPastEventSlot(evt, nowMs));
  }, [events]);

  const typeOptions = [
    { key: "all", label: "All" },
    { key: "module", label: "Module" },
    { key: "cia", label: "CIA" },
    { key: "viva", label: "Viva" },
    { key: "other", label: "Other" },
  ] as const;

  const sessionTimeOptions = useMemo(() => {
    const times = new Set<string>();
    for (const evt of upcomingEvents) {
      if (evt.startTime) times.add(evt.startTime);
    }
    return Array.from(times).sort();
  }, [upcomingEvents]);

  const filteredEvents = useMemo(() => {
    return upcomingEvents.filter((evt) => {
      const lowerTitle = evt.title.toLowerCase();
      if (selectedType === "module" && !lowerTitle.includes("module")) {
        return false;
      }
      if (selectedType === "cia" && !lowerTitle.includes("cia")) {
        return false;
      }
      if (selectedType === "viva" && !lowerTitle.includes("viva")) {
        return false;
      }
      if (
        selectedType === "other" &&
        (lowerTitle.includes("module") ||
          lowerTitle.includes("cia") ||
          lowerTitle.includes("viva"))
      ) {
        return false;
      }
      if (
        slotName.trim() &&
        !lowerTitle.includes(slotName.trim().toLowerCase()) &&
        !evt.venue.toLowerCase().includes(slotName.trim().toLowerCase())
      ) {
        return false;
      }
      if (dateFrom && evt.date < dateFrom) return false;
      if (dateTo && evt.date > dateTo) return false;
      if (sessionTime && evt.startTime !== sessionTime) return false;
      return true;
    });
  }, [upcomingEvents, selectedType, slotName, dateFrom, dateTo, sessionTime]);

  const handleApplyPortalFilters = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    setFilterError(null);
    try {
      const params = new URLSearchParams();
      params.set("refresh", "true");
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (slotName.trim()) params.set("slotName", slotName.trim());
      if (sessionTime) params.set("sessionTime", sessionTime);

      const res = await fetch(`/api/events?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        events?: PortalEvent[];
        terms?: EventTermOption[];
        fetchedAt?: string;
        error?: string;
      };

      if (json.events) {
        applyFilteredEvents(
          json.events,
          json.terms ?? [],
          json.fetchedAt ?? null
        );
      }
      if (!res.ok || json.error) {
        setFilterError(json.error || "Failed to fetch filtered events.");
      }
    } catch {
      setFilterError("Failed to contact local server.");
    } finally {
      setSyncing(false);
    }
  };

  const handleReset = () => {
    setSelectedType("all");
    setSlotName("");
    setDateFrom("");
    setDateTo("");
    setSessionTime("");
    setFilterError(null);
  };

  const openAutoBook = (evt: PortalEvent) => {
    setSelectedEvent(evt);
    setPurpose("");
    setPurposeShake(false);
    setConfirmed(false);
    setDialogError(null);
  };

  const triggerPurposeShake = () => {
    setPurposeShake(false);
    requestAnimationFrame(() => {
      setPurposeShake(true);
      purposeInputRef.current?.focus();
    });
    setTimeout(() => setPurposeShake(false), 500);
  };

  const handleAutoBookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent) return;
    setDialogError(null);

    if (!purpose.trim()) {
      setDialogError("Purpose for attending is required.");
      triggerPurposeShake();
      return;
    }
    if (!confirmed) {
      setDialogError("Explicit booking confirmation is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEvent.eventId,
          compositeId: selectedEvent.compositeId,
          sessionId: selectedEvent.sessionId,
          title: selectedEvent.title,
          date: selectedEvent.date,
          startTime: selectedEvent.startTime,
          endTime: selectedEvent.endTime,
          venue: selectedEvent.venue,
          bookingWindowStart: selectedEvent.bookingWindowStart,
          bookingWindowEnd: selectedEvent.bookingWindowEnd,
          purpose: purpose.trim(),
          authorized: confirmed,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setDialogError(json.error || "Failed to schedule Auto Book.");
        return;
      }

      setToast(
        `Scheduled Auto Book for '${selectedEvent.title}' (${selectedEvent.date} ${selectedEvent.startTime}).`
      );
      setSelectedEvent(null);
    } catch {
      setDialogError("Failed to contact local server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-100">
          Events
        </h1>
        <span className="font-mono text-[11px] text-zinc-500">
          {fetchedAt
            ? `Last synced ${formatIstTimeWithSeconds(fetchedAt)}`
            : workerState.sessionState === "authenticated"
            ? "Syncing..."
            : "Waiting for portal connection"}
        </span>
      </div>

      {/* Quick Type Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {typeOptions.map((opt) => {
          const active = selectedType === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSelectedType(opt.key)}
              className={`rounded-full border px-3 py-1 text-xs active:scale-[0.96] ${
                active
                  ? "border-blue-500/40 bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950 dark:border-zinc-800 dark:bg-[#121215] dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Compact Filter Bar */}
      <form
        onSubmit={handleApplyPortalFilters}
        className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 sm:grid-cols-5 dark:border-zinc-800/80 dark:bg-[#121215]"
      >
        <input
          type="text"
          value={slotName}
          onChange={(e) => setSlotName(e.target.value)}
          placeholder="Search title or venue..."
          aria-label="Search events"
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Date From"
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
        />

        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Date To"
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
        />

        <select
          value={sessionTime}
          onChange={(e) => setSessionTime(e.target.value)}
          aria-label="Session Time"
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
        >
          <option value="">All Times</option>
          {sessionTimeOptions.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <button
            type="submit"
            disabled={syncing}
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100 active:scale-[0.96] disabled:opacity-50 dark:border-zinc-700 dark:bg-[#18181c] dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {syncing ? "Syncing..." : "Sync"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96] dark:border-zinc-800 dark:bg-[#121215] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            Reset
          </button>
        </div>
      </form>

      {filterError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {filterError}
        </div>
      )}

      {toast && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="rounded-full px-2 py-0.5 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Events Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800/80 dark:bg-[#121215]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-medium text-zinc-500 dark:border-zinc-800/80 dark:bg-[#16161a] dark:text-zinc-400">
              <th className="px-3.5 py-2.5">Event</th>
              <th className="px-3.5 py-2.5">Date</th>
              <th className="px-3.5 py-2.5">Time</th>
              <th className="px-3.5 py-2.5">Venue</th>
              <th className="px-3.5 py-2.5">Capacity</th>
              <th className="px-3.5 py-2.5">Status</th>
              <th className="px-3.5 py-2.5">Opens (IST)</th>
              <th className="px-3.5 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                  {workerState.sessionState !== "authenticated"
                    ? "Connect your college portal from the header to load live events."
                    : "No upcoming events match the current filters."}
                </td>
              </tr>
            ) : (
              filteredEvents.map((evt) => {
                const queued = activeCompositeIds.has(evt.compositeId);
                const disabled =
                  queued ||
                  evt.alreadyBooked ||
                  evt.isWaitlisted ||
                  evt.bookingStatus === "Booking Closed";

                return (
                  <tr
                    key={evt.compositeId}
                    className="hover:bg-zinc-50/70 dark:hover:bg-[#18181c]"
                  >
                    <td className="px-3.5 py-2.5 font-medium text-zinc-950 dark:text-zinc-100">
                      {evt.title}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                      {evt.dateDisplay || evt.date}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {evt.startTime}–{evt.endTime}
                    </td>
                    <td className="px-3.5 py-2.5 text-zinc-700 dark:text-zinc-300">
                      {evt.venue || "—"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {evt.capacity || "—"}
                      {evt.waitlistCapacity ? ` (WL ${evt.waitlistCapacity})` : ""}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge
                        status={
                          evt.bookingStatus === "Waitlist Open"
                            ? "Waitlist"
                            : evt.bookingStatus
                        }
                      />
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {formatIstDateTime(evt.bookingWindowStart)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => openAutoBook(evt)}
                        className="rounded-md bg-blue-600 px-3.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
                      >
                        {evt.alreadyBooked
                          ? "Booked"
                          : evt.isWaitlisted
                          ? "Waitlisted"
                          : queued
                          ? "Queued"
                          : "Book"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Auto Book Dialog */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs dark:bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="autobook-dialog-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#121215] dark:shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800/80">
              <h2
                id="autobook-dialog-title"
                className="text-sm font-semibold text-zinc-950 dark:text-zinc-100"
              >
                Schedule Auto Book
              </h2>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAutoBookSubmit} className="space-y-3.5 p-5">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-xs space-y-1 dark:border-zinc-800 dark:bg-[#16161a]">
                <div className="font-medium text-zinc-950 dark:text-zinc-100">
                  {selectedEvent.title}
                </div>
                <div className="text-zinc-600 dark:text-zinc-400">
                  {selectedEvent.dateDisplay || selectedEvent.date} ·{" "}
                  {selectedEvent.startTime}–{selectedEvent.endTime} · Venue{" "}
                  {selectedEvent.venue}
                </div>
                <div className="text-zinc-500">
                  Booking opens:{" "}
                  {formatIstDateTime(selectedEvent.bookingWindowStart)}
                </div>
              </div>

              <div>
                <label
                  htmlFor="booking-purpose"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Purpose for attending
                </label>
                <input
                  ref={purposeInputRef}
                  id="booking-purpose"
                  type="text"
                  maxLength={255}
                  value={purpose}
                  onChange={(e) => {
                    setPurpose(e.target.value);
                    if (purposeShake) setPurposeShake(false);
                  }}
                  placeholder="e.g. Module Assessment completion"
                  className={`mt-1.5 w-full rounded-lg border px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:bg-[#0b0b0c] dark:text-zinc-100 dark:placeholder:text-zinc-500 ${
                    purposeShake
                      ? "animate-shake border-red-500 ring-2 ring-red-500/25"
                      : "border-zinc-200 bg-white focus:border-blue-500 dark:border-zinc-800"
                  }`}
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 cursor-pointer dark:border-zinc-800 dark:bg-[#16161a] dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700 dark:bg-[#0b0b0c]"
                />
                <span>
                  I confirm that SnipeSlot should submit a real booking for this
                  exact event as soon as its booking window opens.
                </span>
              </label>

              {dialogError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  {dialogError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-[#121215] dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 active:scale-[0.96] disabled:opacity-50"
                >
                  {submitting ? "Scheduling..." : "Confirm Book"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
