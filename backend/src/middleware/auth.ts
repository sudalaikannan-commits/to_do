import type { Request, Response, NextFunction } from "express";
import { verifySession } from "../utils/auth.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

export interface AuthUser {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[config.cookieName] as string | undefined;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const payload = verifySession(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, name: true },
    });
    if (!user) return res.status(401).json({ error: "Session user no longer exists" });
    req.user = user as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Admin access required" });
  next();
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
