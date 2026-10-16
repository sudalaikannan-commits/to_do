import { describe, it, expect } from "vitest";
import { checkBugTransition, nextBugCode, progressFor } from "./workflow.js";
import { bootstrapSchema, bugSchema, bugUpdateSchema, projectSchema, taskSchema } from "./validation.js";
import { iso } from "./db.js";

describe("bug review gate", () => {
  it("blocks FIXED -> CLOSED (must go through review)", () => {
    expect(checkBugTransition("FIXED", "CLOSED")).toMatch(/review/i);
  });

  it("allows FIXED -> READY_FOR_TESTING / VERIFIED / REOPENED", () => {
    expect(checkBugTransition("FIXED", "READY_FOR_TESTING")).toBeNull();
    expect(checkBugTransition("FIXED", "VERIFIED")).toBeNull();
    expect(checkBugTransition("FIXED", "REOPENED")).toBeNull();
  });

  it("blocks jumping straight to VERIFIED from IN_PROGRESS", () => {
    expect(checkBugTransition("IN_PROGRESS", "VERIFIED")).toMatch(/Ready for Testing/);
  });

  it("allows normal progression and no-ops", () => {
    expect(checkBugTransition("REPORTED", "CONFIRMED")).toBeNull();
    expect(checkBugTransition("IN_PROGRESS", "IN_PROGRESS")).toBeNull();
  });

  it("allocates sequential BUG-XXXX codes", () => {
    expect(nextBugCode(0)).toBe("BUG-0001");
    expect(nextBugCode(42)).toBe("BUG-0043");
  });
});

describe("project progress", () => {
  it("computes completion percentage", () => {
    expect(progressFor([])).toBe(0);
    expect(progressFor(["COMPLETED", "IN_PROGRESS", "COMPLETED", "NOT_STARTED"])).toBe(50);
  });
});

describe("validation parity with legacy API", () => {
  it("rejects short task titles and bad project payloads", () => {
    expect(taskSchema.safeParse({ projectId: "p1", title: "x" }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "SEO Retainer", category: "SEO", ownerId: "u1" }).success).toBe(true);
  });

  it("accepts bug reports and allows all review states at schema level", () => {
    expect(
      bugSchema.safeParse({ projectId: "p1", title: "Nav overlaps logo", description: "details here" }).success
    ).toBe(true);
    expect(bugUpdateSchema.safeParse({ status: "READY_FOR_TESTING" }).success).toBe(true);
    expect(bugUpdateSchema.safeParse({ status: "BOGUS" }).success).toBe(false);
  });

  it("requires bootstrap name/email/strong password", () => {
    expect(bootstrapSchema.safeParse({ name: "A", email: "bad", password: "short" }).success).toBe(false);
  });
});

describe("timestamp serialization", () => {
  it("converts Firestore-like timestamps and dates to ISO", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(iso(d)).toBe("2026-01-02T03:04:05.000Z");
    expect(iso({ toDate: () => d })).toBe("2026-01-02T03:04:05.000Z");
    expect(iso(null)).toBeNull();
    expect(iso(undefined)).toBeNull();
  });
});
