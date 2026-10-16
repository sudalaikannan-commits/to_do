// Bug workflow transition rules (pure logic — unit tested).
// Enforces the review gate: a FIXED bug is never auto-verified; a reviewer
// must move it to READY_FOR_TESTING, VERIFIED or REOPENED.

const FIXED_GATE = new Set(["READY_FOR_TESTING", "VERIFIED", "REOPENED"]);

export function checkBugTransition(from: string, to: string): string | null {
  if (!to || to === from) return null;
  // A bug in FIXED can only leave via reviewer action.
  if (from === "FIXED" && !FIXED_GATE.has(to)) {
    return "A Fixed bug must be moved to Ready for Testing, Verified or Reopened by a reviewer — not auto-verified.";
  }
  // Cannot jump straight to VERIFIED without passing through FIXED/READY_FOR_TESTING.
  if (to === "VERIFIED" && !["READY_FOR_TESTING", "FIXED", "VERIFIED"].includes(from)) {
    return "Bug must pass through Fixed → Ready for Testing before Verified.";
  }
  return null;
}

export function nextBugCode(maxExisting: number): string {
  return `BUG-${String(maxExisting + 1).padStart(4, "0")}`;
}

export function progressFor(statuses: string[]): number {
  if (!statuses.length) return 0;
  const done = statuses.filter((s) => s === "COMPLETED").length;
  return Math.round((done / statuses.length) * 100);
}
