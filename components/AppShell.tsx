"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Moon, Settings, Sun, X } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { useSnipeSlot } from "./SnipeSlotProvider";
import { useTheme } from "./ThemeProvider";

const NAV_ITEMS = [
  { href: "/", label: "Events" },
  { href: "/queue", label: "Queue" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const {
    workerState,
    jobs,
    wsConnected,
    lastJobBanner,
    clearJobBanner,
    bookedToast,
    dismissBookedToast,
  } = useSnipeSlot();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const activeIdx = NAV_ITEMS.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  );

  useEffect(() => {
    const el = navRefs.current[activeIdx];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [activeIdx, jobs.length]);

  const pendingCount = jobs.filter(
    (j) =>
      !["Booked", "Waitlisted", "Full", "Failed", "Cancelled"].includes(j.status)
  ).length;

  const sessionDot =
    workerState.sessionState === "authenticated"
      ? "bg-emerald-500 dark:bg-emerald-400"
      : workerState.sessionState === "unavailable"
      ? "bg-amber-500 dark:bg-amber-400"
      : "bg-zinc-300 dark:bg-zinc-600";

  const sessionLabel =
    workerState.sessionState === "authenticated"
      ? "Portal connected"
      : workerState.sessionState === "expired"
      ? "Session expired"
      : workerState.sessionState === "unavailable"
      ? "Portal unavailable"
      : "Disconnected";

  const handleQuickConnect = async () => {
    await fetch("/api/portal/connect", { method: "POST" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-950 dark:bg-[#0b0b0c] dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur-md dark:border-zinc-800/80 dark:bg-[#0b0b0c]/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-950 transition-opacity hover:opacity-85 dark:text-zinc-100"
            >
              <span>SnipeSlot</span>
            </Link>

            <nav
              className="relative flex items-center gap-5 h-14"
              aria-label="Primary"
            >
              {NAV_ITEMS.map((item, idx) => {
                const active = idx === activeIdx;
                return (
                  <Link
                    key={item.href}
                    ref={(el) => {
                      navRefs.current[idx] = el;
                    }}
                    href={item.href}
                    className={`inline-flex h-full items-center gap-1.5 px-1 text-xs font-medium transition-colors duration-200 ${
                      active
                        ? "text-zinc-950 dark:text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.href === "/queue" && pendingCount > 0 ? (
                      <span className="rounded-full bg-blue-100 px-1.5 py-0.2 text-[10px] font-mono text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                        {pendingCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-blue-600 transition-all duration-250 ease-out dark:bg-blue-500"
                style={{
                  transform: `translateX(${indicator.left}px)`,
                  width: `${indicator.width}px`,
                  opacity: indicator.width > 0 ? 1 : 0,
                }}
              />
            </nav>
          </div>

          <div className="flex items-center gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 dark:border-zinc-800/80 dark:bg-[#121215]">
              <span className={`h-1.5 w-1.5 rounded-full ${sessionDot}`} />
              <span>{sessionLabel}</span>
            </span>

            {workerState.sessionState !== "authenticated" && (
              <button
                type="button"
                onClick={handleQuickConnect}
                disabled={workerState.connecting}
                className="rounded-full bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 active:scale-[0.96] disabled:opacity-50"
              >
                {workerState.connecting ? "Logging in..." : "Connect Portal"}
              </button>
            )}

            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 dark:border-zinc-800/80 dark:bg-[#121215]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  workerState.running
                    ? wsConnected
                      ? "bg-blue-600 dark:bg-blue-400"
                      : "bg-amber-500 dark:bg-amber-400"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              />
              <span>
                {workerState.running
                  ? wsConnected
                    ? "Worker live"
                    : "Worker (reconnecting)"
                  : "Worker offline"}
              </span>
            </span>

            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-full border border-zinc-200 bg-zinc-50 p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96] dark:border-zinc-800 dark:bg-[#121215] dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label={
                theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
              }
              title={
                theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
              }
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-full border border-zinc-200 bg-zinc-50 p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96] dark:border-zinc-800 dark:bg-[#121215] dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Open settings"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      {lastJobBanner && (
        <div className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800/80 dark:bg-[#121215]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 sm:px-6">
            <span>{lastJobBanner}</span>
            <button
              type="button"
              onClick={clearJobBanner}
              className="rounded-full px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

      {/* Animated Job Booked Confirmation Toast */}
      {bookedToast && (
        <div
          key={bookedToast.id}
          role="status"
          className="animate-toast-in fixed right-5 bottom-5 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-emerald-200 bg-white p-3.5 shadow-lg dark:border-emerald-500/30 dark:bg-[#141418]"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-4 w-4"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 13l4 4L19 7" className="animate-check-draw" />
            </svg>
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-semibold text-zinc-950 dark:text-zinc-100">
              Slot Booked: {bookedToast.title}
            </div>
            <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
              {bookedToast.message}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissBookedToast}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Dismiss notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
