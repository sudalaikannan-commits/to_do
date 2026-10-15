import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireAdmin, safeError } from "../middleware/auth.js";
import { hashPassword, verifyPassword, signSession } from "../utils/auth.js";
import { config } from "../config.js";
import { loginSchema, registerSchema, createUserSchema } from "../validators.js";

const router = Router();

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

// POST /api/auth/bootstrap — creates the very first ADMIN when no users exist.
router.post(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid details. Name, valid email and 8+ char password required.");
    const count = await prisma.user.count();
    if (count > 0) return safeError(res, 403, "Workspace already initialised. Ask an admin to invite you.");
    const { name, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email: email.toLowerCase(), passwordHash, role: "ADMIN" },
    });
    let workspace = await prisma.workspace.findUnique({ where: { slug: "ationic" } });
    if (!workspace) workspace = await prisma.workspace.create({ data: { name: "Ationic", slug: "ationic" } });
    await prisma.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "ADMIN" } });
    const token = signSession({ sub: user.id, email: user.email, role: "ADMIN" });
    setSessionCookie(res, token);
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Enter a valid email and password.");
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user) return safeError(res, 401, "Invalid email or password.");
    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) return safeError(res, 401, "Invalid email or password.");
    const token = signSession({ sub: user.id, email: user.email, role: user.role });
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl } });
  })
);

router.post("/logout", (_req, res) => {
  res.clearCookie(config.cookieName, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? "none" : "lax",
  });
  res.json({ ok: true });
});

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });
    if (!user) return safeError(res, 401, "Not authenticated");
    res.json({ user });
  })
);

// Admin creates / invites team members (controlled creation — no open signup).
router.post(
  "/users",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid user details.");
    const email = parsed.data.email.toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return safeError(res, 409, "A user with this email already exists.");
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email, passwordHash, role: parsed.data.role },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    const workspace = await prisma.workspace.findUnique({ where: { slug: "ationic" } });
    if (workspace) {
      await prisma.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
        update: { role: parsed.data.role },
        create: { userId: user.id, workspaceId: workspace.id, role: parsed.data.role },
      });
    }
    await prisma.activityLog.create({
      data: { workspaceId: workspace?.id, actorId: req.user!.id, action: "USER_INVITED", details: { email } },
    });
    res.status(201).json({ user });
  })
);

router.get(
  "/users",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ users });
  })
);

router.patch(
  "/users/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { role, name } = req.body as { role?: "ADMIN" | "MEMBER"; name?: string };
    if (role && !["ADMIN", "MEMBER"].includes(role)) return safeError(res, 400, "Invalid role.");
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...(role ? { role } : {}), ...(name ? { name: String(name).slice(0, 80) } : {}) },
      select: { id: true, name: true, email: true, role: true },
    });
    res.json({ user: updated });
  })
);

router.delete(
  "/users/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) return safeError(res, 400, "You cannot remove your own account.");
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

export default router;
