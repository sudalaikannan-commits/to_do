import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plain, salt);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SessionPayload {
  sub: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

export function signSession(p: SessionPayload): string {
  return jwt.sign(p, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

export function verifySession(token: string): SessionPayload {
  return jwt.verify(token, config.jwtSecret) as SessionPayload;
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

export function nextBugCode(existingMax: number): string {
  const n = existingMax + 1;
  return `BUG-${String(n).padStart(4, "0")}`;
}
