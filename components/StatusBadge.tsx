"use client";

interface StatusBadgeProps {
  status: string;
  isPaused?: boolean;
}

const STYLE_MAP: Record<string, string> = {
  Booked:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300",
  "Already Booked":
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300",
  Registered:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300",
  Open:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300",
  Scheduled:
    "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300",
  Pending:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-400",
  Preparing:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  "Waiting for opening":
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  "Opening Soon":
    "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300",
  Processing:
    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-400/40 dark:bg-blue-500/20 dark:text-blue-200",
  Retrying:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  Waitlist:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  Waitlisted:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  "Authentication required":
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200",
  "Verification required":
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200",
  Full:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700/70 dark:bg-zinc-800/50 dark:text-zinc-400",
  "Booking Closed":
    "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
  Failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  Cancelled:
    "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
};

export function StatusBadge({ status, isPaused }: StatusBadgeProps) {
  if (isPaused && status !== "Authentication required") {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700/80 dark:bg-zinc-800/80 dark:text-zinc-400">
        Paused
      </span>
    );
  }

  const cls =
    STYLE_MAP[status] ||
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}
    >
      {status}
    </span>
  );
}
