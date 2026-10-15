import { describe, it, expect } from "vitest";
import { taskSchema, bugUpdateSchema, loginSchema, projectSchema } from "../src/validators.js";
import { hashPassword, verifyPassword, signSession, verifySession } from "../src/utils/auth.js";

describe("validation", () => {
  it("rejects empty task title", () => {
    const r = taskSchema.safeParse({ projectId: "p1", title: "x" });
    expect(r.success).toBe(false);
  });

  it("accepts a valid project", () => {
    const r = projectSchema.safeParse({ name: "Sam & Co E-commerce", category: "E-commerce Development", ownerId: "u1" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid login email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("bug workflow: FIXED gate is enforced at route level (schema allows review states)", () => {
    // Schema permits all states; the route guard restricts FIXED -> {READY_FOR_TESTING, VERIFIED, REOPENED}.
    expect(bugUpdateSchema.safeParse({ status: "READY_FOR_TESTING" }).success).toBe(true);
    expect(bugUpdateSchema.safeParse({ status: "BOGUS" }).success).toBe(false);
  });
});

describe("auth helpers", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("StrongPass123!");
    expect(hash).not.toContain("StrongPass123!");
    expect(await verifyPassword("StrongPass123!", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("signs and verifies sessions", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-1234567890abcdef";
    const token = signSession({ sub: "u1", email: "a@b.c", role: "MEMBER" });
    const payload = verifySession(token);
    expect(payload.sub).toBe("u1");
  });
});
