export function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d?: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function isOverdue(due?: string | null, status?: string): boolean {
  if (!due) return false;
  if (status === "COMPLETED" || status === "CANCELLED" || status === "VERIFIED" || status === "CLOSED") return false;
  return new Date(due).getTime() < Date.now();
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    PLANNING: "bg-neutral-100 text-neutral-700",
    NOT_STARTED: "bg-neutral-100 text-neutral-700",
    IN_PROGRESS: "bg-blue-100 text-blue-800",
    BLOCKED: "bg-red-100 text-red-800",
    ON_HOLD: "bg-orange-100 text-orange-800",
    IN_REVIEW: "bg-purple-100 text-purple-800",
    READY_FOR_TESTING: "bg-purple-100 text-purple-800",
    REPORTED: "bg-neutral-100 text-neutral-700",
    CONFIRMED: "bg-blue-100 text-blue-800",
    FIXED: "bg-teal-100 text-teal-800",
    VERIFIED: "bg-green-100 text-green-800",
    REOPENED: "bg-orange-100 text-orange-800",
    COMPLETED: "bg-green-100 text-green-800",
    CLOSED: "bg-neutral-200 text-neutral-700",
    CANCELLED: "bg-neutral-200 text-neutral-500",
  };
  return map[status] ?? "bg-neutral-100 text-neutral-700";
}

export function priorityColor(p: string): string {
  const map: Record<string, string> = {
    URGENT: "bg-red-600 text-white",
    HIGH: "bg-orange-100 text-orange-800 border border-orange-300",
    MEDIUM: "bg-yellow-100 text-yellow-900 border border-yellow-300",
    LOW: "bg-neutral-100 text-neutral-600 border border-neutral-200",
    CRITICAL: "bg-red-600 text-white",
    MAJOR: "bg-orange-100 text-orange-800",
    MODERATE: "bg-yellow-100 text-yellow-900",
    MINOR: "bg-neutral-100 text-neutral-600",
  };
  return map[p] ?? "bg-neutral-100 text-neutral-600";
}

export function prettyEnum(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
