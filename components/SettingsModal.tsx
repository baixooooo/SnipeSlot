"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useSnipeSlot } from "./SnipeSlotProvider";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { workerState, settings } = useSnipeSlot();

  const [pollInterval, setPollInterval] = useState(
    String(settings.pollIntervalSeconds)
  );
  const [maxRetries, setMaxRetries] = useState(String(settings.retry.maxRetries));
  const [maxDuration, setMaxDuration] = useState(
    String(settings.retry.maxRetryDurationSeconds)
  );
  const [baseDelayMs, setBaseDelayMs] = useState(
    String(settings.retry.baseDelayMs)
  );
  const [maxDelayMs, setMaxDelayMs] = useState(
    String(settings.retry.maxDelayMs)
  );
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPollInterval(String(settings.pollIntervalSeconds));
      setMaxRetries(String(settings.retry.maxRetries));
      setMaxDuration(String(settings.retry.maxRetryDurationSeconds));
      setBaseDelayMs(String(settings.retry.baseDelayMs));
      setMaxDelayMs(String(settings.retry.maxDelayMs));
      setFeedback(null);
    }
  }, [open, settings]);

  if (!open) return null;

  const handleConnect = async () => {
    setFeedback(null);
    const res = await fetch("/api/portal/connect", { method: "POST" });
    const json = (await res.json()) as { message?: string; error?: string };
    setFeedback(json.message || json.error || "Requested portal login.");
  };

  const handleCheckSession = async () => {
    setChecking(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/portal/check", { method: "POST" });
      const json = (await res.json()) as { message?: string; error?: string };
      setFeedback(json.message || json.error || "Session checked.");
    } finally {
      setChecking(false);
    }
  };

  const handleToggleAutomation = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automationEnabled: !settings.automationEnabled,
        }),
      });
      if (res.ok) {
        setFeedback(
          !settings.automationEnabled
            ? "Automation started."
            : "Automation paused."
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pollIntervalSeconds: Number.parseInt(pollInterval, 10),
          retry: {
            maxRetries: Number.parseInt(maxRetries, 10),
            maxRetryDurationSeconds: Number.parseInt(maxDuration, 10),
            baseDelayMs: Number.parseInt(baseDelayMs, 10),
            maxDelayMs: Number.parseInt(maxDelayMs, 10),
          },
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback(json.error || "Failed to save settings.");
      } else {
        setFeedback("Settings saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs dark:bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#121215] dark:shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800/80">
          <h2
            id="settings-modal-title"
            className="text-sm font-semibold text-zinc-950 dark:text-zinc-100"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          {feedback && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-zinc-700 dark:border-zinc-800 dark:bg-[#18181c] dark:text-zinc-300">
              {feedback}
            </div>
          )}

          {/* Portal Session */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-2.5 dark:border-zinc-800/80 dark:bg-[#16161a]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-950 dark:text-zinc-100">
                Portal Session
              </span>
              <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] capitalize text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300">
                {workerState.sessionState}
              </span>
            </div>
            <p className="text-zinc-600 dark:text-zinc-400">
              {workerState.sessionMessage}
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={handleConnect}
                disabled={workerState.connecting}
                className="rounded-full bg-blue-600 px-3.5 py-1.5 font-medium text-white hover:bg-blue-500 active:scale-[0.96] disabled:opacity-50"
              >
                {workerState.connecting
                  ? "Waiting for login..."
                  : workerState.sessionState === "authenticated"
                  ? "Reconnect Portal"
                  : "Connect Portal"}
              </button>
              <button
                type="button"
                onClick={handleCheckSession}
                disabled={checking}
                className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 font-medium text-zinc-800 hover:bg-zinc-100 active:scale-[0.96] disabled:opacity-50 dark:border-zinc-700 dark:bg-[#121215] dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {checking ? "Checking..." : "Check Session"}
              </button>
            </div>
          </div>

          {/* Automation */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 dark:border-zinc-800/80 dark:bg-[#16161a]">
            <div>
              <div className="font-medium text-zinc-950 dark:text-zinc-100">
                Autonomous Scheduler
              </div>
              <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                {settings.automationEnabled
                  ? "Active: executes authorized jobs at opening time."
                  : "Paused: queued jobs will not submit."}
              </div>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleToggleAutomation}
              className={`rounded-full px-3.5 py-1.5 font-medium active:scale-[0.96] ${
                settings.automationEnabled
                  ? "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-[#121215] dark:text-zinc-200 dark:hover:bg-zinc-800"
                  : "bg-blue-600 text-white hover:bg-blue-500"
              }`}
            >
              {settings.automationEnabled ? "Pause" : "Start"}
            </button>
          </div>

          {/* Polling & Retry */}
          <form onSubmit={handleSave} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Monitor Interval (s)
                </span>
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={pollInterval}
                  onChange={(e) => setPollInterval(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
                />
              </label>

              <label className="block">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Max Retries
                </span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
                />
              </label>

              <label className="block">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Max Retry Duration (s)
                </span>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={maxDuration}
                  onChange={(e) => setMaxDuration(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
                />
              </label>

              <label className="block">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Base / Max Delay (ms)
                </span>
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="number"
                    min={250}
                    max={30000}
                    value={baseDelayMs}
                    onChange={(e) => setBaseDelayMs(e.target.value)}
                    className="w-1/2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
                  />
                  <input
                    type="number"
                    min={1000}
                    max={120000}
                    value={maxDelayMs}
                    onChange={(e) => setMaxDelayMs(e.target.value)}
                    className="w-1/2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-[#0b0b0c] dark:text-zinc-100"
                  />
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-[#121215] dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-500 active:scale-[0.96] disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
