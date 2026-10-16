import { Router } from "express";
import { col, doc, FieldValue, WORKSPACE_ID } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../auth.js";
import { commentSchema } from "../validation.js";
import { notify, userMap } from "../store.js";

const router = Router();
router.use(requireAuth);

// POST /api/comments — body: { body, taskId?, bugId?, projectId? } (exactly one parent)
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Comment cannot be empty.");
    const { body, taskId, bugId, projectId } = parsed.data;
    const parents = [taskId, bugId, projectId].filter(Boolean);
    if (parents.length !== 1) return safeError(res, 400, "Comment must belong to exactly one task, bug or project.");
    // Stored + rendered as plain text (frontend never uses dangerouslySetInnerHTML).
    const clean = body.trim().slice(0, 5000);
    const now = FieldValue.serverTimestamp();
    const ref = await col.comments().add({
      workspaceId: WORKSPACE_ID,
      projectId: projectId || null,
      taskId: taskId || null,
      bugId: bugId || null,
      authorId: req.user!.id,
      body: clean,
      createdAt: now,
      updatedAt: now,
    });
    let link = "/";
    const notifyIds = new Set<string>();
    if (taskId) {
      const t = await col.tasks().doc(taskId).get();
      if (t.exists) {
        const td = t.data() as { assigneeId?: string | null; creatorId: string };
        link = `/tasks/${taskId}`;
        if (td.assigneeId && td.assigneeId !== req.user!.id) notifyIds.add(td.assigneeId);
        if (td.creatorId !== req.user!.id) notifyIds.add(td.creatorId);
      }
    } else if (bugId) {
      const b = await col.bugs().doc(bugId).get();
      if (b.exists) {
        const bd = b.data() as { assigneeId?: string | null };
        link = `/bugs/${bugId}`;
        if (bd.assigneeId && bd.assigneeId !== req.user!.id) notifyIds.add(bd.assigneeId);
      }
    } else if (projectId) {
      const p = await col.projects().doc(projectId).get();
      if (p.exists) {
        link = `/projects/${projectId}`;
        ((p.data() as { memberIds?: string[] }).memberIds ?? []).forEach((m) => {
          if (m !== req.user!.id) notifyIds.add(m);
        });
      }
    }
    for (const uid of notifyIds) {
      await notify(uid, { type: "COMMENT", title: "New comment", body: clean.slice(0, 140), link });
    }
    const created = doc(await ref.get()) as unknown as Record<string, unknown>;
    res.status(201).json({ comment: { ...created, author: { id: req.user!.id, name: req.user!.name } } });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) return safeError(res, 400, "Comment cannot be empty.");
    const ref = col.comments().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return safeError(res, 404, "Comment not found.");
    const existing = snap.data() as { authorId: string };
    if (existing.authorId !== req.user!.id && req.user!.role !== "ADMIN") {
      return safeError(res, 403, "You can only edit your own comments.");
    }
    await ref.update({ body: body.trim().slice(0, 5000), updatedAt: FieldValue.serverTimestamp() });
    res.json({ comment: doc(await ref.get()) });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const ref = col.comments().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return safeError(res, 404, "Comment not found.");
    const existing = snap.data() as { authorId: string };
    if (existing.authorId !== req.user!.id && req.user!.role !== "ADMIN") {
      return safeError(res, 403, "You can only delete your own comments.");
    }
    await ref.delete();
    res.json({ ok: true });
  })
);

export default router;
