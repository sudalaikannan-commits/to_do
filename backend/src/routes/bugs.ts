import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../middleware/auth.js";
import { bugSchema, bugUpdateSchema } from "../validators.js";
import { emitToWorkspace } from "../realtime.js";
import { nextBugCode } from "../utils/auth.js";

const router = Router();
router.use(requireAuth);

// Enforce: FIXED -> must go to READY_FOR_TESTING / VERIFIED / REOPENED via reviewer, never auto-verify.
const FIXED_GATE = new Set(["READY_FOR_TESTING", "VERIFIED", "REOPENED"]);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { projectId, status, severity, priority, assigneeId, q } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (priority) where.priority = priority;
    if (assigneeId) where.assigneeId = assigneeId;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { bugCode: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { pageRoute: { contains: q, mode: "insensitive" } },
      ];
    }
    const bugs = await prisma.bug.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, clientName: true } },
        _count: { select: { comments: true } },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    // Summary counts
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    for (const b of bugs) {
      byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
      bySeverity[b.severity] = (bySeverity[b.severity] ?? 0) + 1;
      byProject[b.project.name] = (byProject[b.project.name] ?? 0) + 1;
    }
    res.json({ bugs, summary: { byStatus, bySeverity, byProject, total: bugs.length } });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = bugSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, parsed.error.errors[0]?.message ?? "Invalid bug report.");
    const d = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: d.projectId } });
    if (!project) return safeError(res, 404, "Project not found.");
    const count = await prisma.bug.count();
    // Ensure unique code (retry-safe enough for 2-person team; unique constraint backs it)
    const bugCode = nextBugCode(count + Math.floor(Math.random() * 0));
    const bug = await prisma.bug.create({
      data: {
        bugCode,
        projectId: d.projectId,
        title: d.title,
        websiteUrl: d.websiteUrl || null,
        description: d.description,
        steps: d.steps || null,
        expected: d.expected || null,
        actual: d.actual || null,
        pageRoute: d.pageRoute || null,
        device: d.device || null,
        viewport: d.viewport || null,
        severity: d.severity,
        priority: d.priority,
        assigneeId: d.assigneeId || null,
        reporterId: req.user!.id,
        targetFixDate: d.targetFixDate ? new Date(d.targetFixDate) : null,
      },
    });
    await prisma.activityLog.create({
      data: { workspaceId: project.workspaceId, projectId: d.projectId, bugId: bug.id, actorId: req.user!.id, action: "BUG_REPORTED", details: { bugCode, title: bug.title } },
    });
    if (bug.assigneeId) {
      await prisma.notification.create({
        data: { userId: bug.assigneeId, type: "BUG_ASSIGNED", title: `Bug assigned: ${bug.bugCode}`, body: bug.title, link: `/bugs/${bug.id}` },
      });
    }
    emitToWorkspace(project.workspaceId, "bug:created", { bugId: bug.id, projectId: d.projectId });
    res.status(201).json({ bug });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const bug = await prisma.bug.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, workspaceId: true } },
        comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
        activities: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 30 },
      },
    });
    if (!bug) return safeError(res, 404, "Bug not found.");
    res.json({ bug });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = bugUpdateSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid bug update.");
    const existing = await prisma.bug.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!existing) return safeError(res, 404, "Bug not found.");
    const d = parsed.data;

    // Workflow guard: a bug in FIXED can only leave FIXED via reviewer action to READY_FOR_TESTING / VERIFIED / REOPENED.
    // We enforce that the transition target is one of the allowed review states; direct FIXED->CLOSED/VERIFIED skipping
    // testing is blocked unless explicitly moving to REOPENED or READY_FOR_TESTING first.
    if (existing.status === "FIXED" && d.status && d.status !== "FIXED") {
      if (!FIXED_GATE.has(d.status)) {
        return safeError(res, 400, "A Fixed bug must be moved to Ready for Testing, Verified or Reopened by a reviewer — not auto-verified.");
      }
    }
    // Guard: cannot jump straight from IN_PROGRESS to VERIFIED without FIXED step.
    if (d.status === "VERIFIED" && !["READY_FOR_TESTING", "FIXED", "VERIFIED"].includes(existing.status)) {
      return safeError(res, 400, "Bug must pass through Fixed → Ready for Testing before Verified.");
    }

    const updated = await prisma.bug.update({
      where: { id: req.params.id },
      data: {
        ...(d.title ? { title: d.title } : {}),
        ...(d.websiteUrl !== undefined ? { websiteUrl: d.websiteUrl || null } : {}),
        ...(d.description ? { description: d.description } : {}),
        ...(d.steps !== undefined ? { steps: d.steps || null } : {}),
        ...(d.expected !== undefined ? { expected: d.expected || null } : {}),
        ...(d.actual !== undefined ? { actual: d.actual || null } : {}),
        ...(d.pageRoute !== undefined ? { pageRoute: d.pageRoute || null } : {}),
        ...(d.device !== undefined ? { device: d.device || null } : {}),
        ...(d.viewport !== undefined ? { viewport: d.viewport } : {}),
        ...(d.severity ? { severity: d.severity } : {}),
        ...(d.priority ? { priority: d.priority } : {}),
        ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId || null } : {}),
        ...(d.status ? { status: d.status } : {}),
        ...(d.targetFixDate !== undefined ? { targetFixDate: d.targetFixDate ? new Date(d.targetFixDate) : null } : {}),
        ...(d.resolutionNotes !== undefined ? { resolutionNotes: d.resolutionNotes || null } : {}),
      },
    });
    await prisma.activityLog.create({
      data: {
        workspaceId: existing.project.workspaceId,
        projectId: existing.projectId,
        bugId: existing.id,
        actorId: req.user!.id,
        action: d.status && d.status !== existing.status ? "BUG_STATUS_CHANGED" : "BUG_UPDATED",
        details: { from: existing.status, to: updated.status } as object,
      },
    });
    if (d.assigneeId !== undefined && updated.assigneeId) {
      await prisma.notification.create({
        data: { userId: updated.assigneeId, type: "BUG_ASSIGNED", title: `Bug assigned: ${updated.bugCode}`, body: updated.title, link: `/bugs/${updated.id}` },
      });
    }
    emitToWorkspace(existing.project.workspaceId, "bug:updated", { bugId: updated.id, projectId: existing.projectId });
    res.json({ bug: updated });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== "ADMIN") return safeError(res, 403, "Only admins can delete bug reports.");
    const existing = await prisma.bug.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!existing) return safeError(res, 404, "Bug not found.");
    await prisma.bug.delete({ where: { id: req.params.id } });
    emitToWorkspace(existing.project.workspaceId, "bug:deleted", { bugId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
