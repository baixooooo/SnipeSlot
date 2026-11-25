export function formatIstDateTime(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "—";
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return isoUtc;

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

export function formatIstTimeWithSeconds(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "—";
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return isoUtc;

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function formatCountdown(targetIsoUtc: string | null | undefined, nowMs: number): string {
  if (!targetIsoUtc) return "—";
  const targetMs = Date.parse(targetIsoUtc);
  if (Number.isNaN(targetMs)) return "—";

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return "Open";

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function isPastEventSlot(
  event: { date: string; startTime: string; endTime: string },
  nowMs: number = Date.now()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    return false;
  }
  const timeStr = /^\d{2}:\d{2}$/.test(event.endTime)
    ? event.endTime
    : /^\d{2}:\d{2}$/.test(event.startTime)
    ? event.startTime
    : "23:59";

  const endMs = Date.parse(`${event.date}T${timeStr}:00+05:30`);
  if (Number.isNaN(endMs)) return false;
  return endMs < nowMs;
}
