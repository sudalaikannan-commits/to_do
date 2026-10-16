import { Router } from "express";
import { auth, col, doc, FieldValue, WORKSPACE_ID } from "../db.js";
import { asyncHandler, requireAuth, requireAdmin, safeError, setAdminClaim } from "../auth.js";
import { bootstrapSchema, createUserSchema } from "../validation.js";
import { ensureWorkspace, logActivity } from "../store.js";

const router = Router();

function publicUser(u: Record<string, unknown>) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatarUrl ?? null, createdAt: u.createdAt };
}

// POST /api/auth/bootstrap — first ADMIN only when no users exist. No passwords stored.
router.post(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid details. Name, valid email and 8+ char password required.");
    const existing = await col.users().limit(1).select().get();
    if (!existing.empty) return safeError(res, 403, "Workspace already initialised. Ask an admin to invite you.");
    const { name, email, password } = parsed.data;
    const user = await auth.createUser({ email: email.toLowerCase(), password, displayName: name });
    await setAdminClaim(user.uid, true);
    const now = FieldValue.serverTimestamp();
    await col.users().doc(user.uid).set({
      email: user.email,
      name,
      role: "ADMIN",
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await ensureWorkspace();
    await col.members().doc(user.uid).set({ role: "ADMIN", createdAt: now });
    res.status(201).json({ user: { id: user.uid, name, email: user.email, role: "ADMIN" } });
  })
);

// GET /api/auth/me — identity from verified ID token (no /login: client uses Firebase SDK).
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const snap = await col.users().doc(req.user!.id).get();
    const u = doc(snap) as unknown as Record<string, unknown> | null;
    if (!u) return safeError(res, 401, "Not authenticated");
    res.json({ user: publicUser(u) });
  })
);

// Admin creates team members (controlled creation — no open signup).
router.post(
  "/users",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid user details.");
    const email = parsed.data.email.toLowerCase();
    const existing = await auth.getUserByEmail(email).catch(() => null);
    if (existing) return safeError(res, 409, "A user with this email already exists.");
    const created = await auth.createUser({ email, password: parsed.data.password, displayName: parsed.data.name });
    await setAdminClaim(created.uid, parsed.data.role === "ADMIN");
    const now = FieldValue.serverTimestamp();
    await col.users().doc(created.uid).set({
      email,
      name: parsed.data.name,
      role: parsed.data.role,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await ensureWorkspace();
    await col.members().doc(created.uid).set({ role: parsed.data.role, createdAt: now });
    await logActivity({ workspaceId: WORKSPACE_ID, actorId: req.user!.id, action: "USER_INVITED", details: { email } });
    res.status(201).json({ user: { id: created.uid, name: parsed.data.name, email, role: parsed.data.role } });
  })
);

router.get(
  "/users",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const snap = await col.users().orderBy("createdAt").get();
    res.json({ users: snap.docs.map((d) => publicUser(doc(d) as unknown as Record<string, unknown>)) });
  })
);

router.patch(
  "/users/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { role, name } = req.body as { role?: "ADMIN" | "MEMBER"; name?: string };
    if (role && !["ADMIN", "MEMBER"].includes(role)) return safeError(res, 400, "Invalid role.");
    const ref = col.users().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return safeError(res, 404, "User not found.");
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (role) updates.role = role;
    if (name) updates.name = String(name).slice(0, 80);
    await ref.update(updates);
    if (role) {
      await setAdminClaim(req.params.id, role === "ADMIN");
      await col.members().doc(req.params.id).set({ role, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    const updated = doc(await ref.get()) as unknown as Record<string, unknown>;
    res.json({ user: publicUser(updated!) });
  })
);

router.delete(
  "/users/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) return safeError(res, 400, "You cannot remove your own account.");
    await auth.deleteUser(req.params.id);
    // users doc + memberships removed by the onUserDeleted trigger.
    res.json({ ok: true });
  })
);

export default router;
