import type { Request, Response, NextFunction } from "express";
import { auth, col } from "./db.js";
import type { UserDoc } from "./types.js";

export interface FnUser {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      user?: FnUser;
    }
  }
}

/**
 * Verifies the Firebase ID token from `Authorization: Bearer <token>`.
 * Authoritative role comes from the custom claim (`admin: true`) with the
 * Firestore user document as the profile source — never from client input.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const decoded = await auth.verifyIdToken(token);
    const snap = await col.users().doc(decoded.uid).get();
    if (!snap.exists) return res.status(401).json({ error: "Workspace account not found" });
    const doc = snap.data() as UserDoc;
    const isAdmin = decoded.admin === true || doc.role === "ADMIN";
    req.user = { id: decoded.uid, email: doc.email, role: isAdmin ? "ADMIN" : "MEMBER", name: doc.name };
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Admin access required" });
  next();
}

/** Set (or clear) the authoritative admin custom claim for a user. */
export async function setAdminClaim(uid: string, isAdmin: boolean): Promise<void> {
  const user = await auth.getUser(uid).catch(() => null);
  if (!user) return;
  const claims = { ...(user.customClaims ?? {}) };
  if (isAdmin) claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(uid, claims);
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  const status =
    typeof err === "object" && err !== null && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : 500;
  if (status >= 500) return res.status(500).json({ error: "Internal server error" });
  return res.status(status).json({ error: "Invalid request" });
}

export function safeError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}
