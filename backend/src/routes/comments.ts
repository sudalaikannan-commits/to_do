import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../middleware/auth.js";
import { commentSchema } from "../validators.js";
import { emitToWorkspace } from "../realtime.js";

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
    // Basic XSS defence: store raw text, frontend renders as text (never dangerouslySetInnerHTML).
    const clean = body.trim().slice(0, 5000);
    const comment = await prisma.comment.create({
      data: { body: clean, authorId: req.user!.id, taskId: taskId || null, bugId: bugId || null, projectId: projectId || null },
      include: { author: { select: { id: true, name: true } } },
    });
    // Resolve workspace for realtime + notify relevant users
    let workspaceId = "ationic";
    let link = "/";
    const notifyIds = new Set<string>();
    if (taskId) {
      const t = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
      if (t) {
        workspaceId = t.project.workspaceId;
        link = `/tasks/${taskId}`;
        if (t.assigneeId && t.assigneeId !== req.user!.id) notifyIds.add(t.assigneeId);
        if (t.creatorId !== req.user!.id) notifyIds.add(t.creatorId);
      }
    } else if (bugId) {
      const b = await prisma.bug.findUnique({ where: { id: bugId }, include: { project: true } });
      if (b) {
        workspaceId = b.project.workspaceId;
        link = `/bugs/${bugId}`;
        if (b.assigneeId && b.assigneeId !== req.user!.id) notifyIds.add(b.assigneeId);
      }
    } else if (projectId) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, include: { members: true } });
      if (p) {
        workspaceId = p.workspaceId;
        link = `/projects/${projectId}`;
        p.members.forEach((m) => { if (m.userId !== req.user!.id) notifyIds.add(m.userId); });
      }
    }
    for (const uid of notifyIds) {
      await prisma.notification.create({
        data: { userId: uid, type: "COMMENT", title: `${req.user!.id ? "New comment" : "New comment"}`, body: clean.slice(0, 140), link },
      });
    }
    emitToWorkspace(workspaceId, "comment:added", { commentId: comment.id, taskId, bugId, projectId });
    res.status(201).json({ comment });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) return safeError(res, 400, "Comment cannot be empty.");
    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing) return safeError(res, 404, "Comment not found.");
    if (existing.authorId !== req.user!.id && req.user!.role !== "ADMIN") {
      return safeError(res, 403, "You can only edit your own comments.");
    }
    const updated = await prisma.comment.update({ where: { id: req.params.id }, data: { body: body.trim().slice(0, 5000) } });
    res.json({ comment: updated });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing) return safeError(res, 404, "Comment not found.");
    if (existing.authorId !== req.user!.id && req.user!.role !== "ADMIN") {
      return safeError(res, 403, "You can only delete your own comments.");
    }
    await prisma.comment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

export default router;
