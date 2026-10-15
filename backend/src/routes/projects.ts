import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../middleware/auth.js";
import { projectSchema } from "../validators.js";
import { emitToWorkspace } from "../realtime.js";

const router = Router();
router.use(requireAuth);

async function defaultWorkspaceId() {
  let ws = await prisma.workspace.findUnique({ where: { slug: "ationic" } });
  if (!ws) ws = await prisma.workspace.create({ data: { name: "Ationic", slug: "ationic" } });
  return ws.id;
}

function progressFor(tasks: { status: string }[]): number {
  if (!tasks.length) return 0;
  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  return Math.round((done / tasks.length) * 100);
}

// GET /api/projects — searchable, filterable overview
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, status, category, priority, assigneeId, due } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (priority) where.priority = priority;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }
    if (due === "overdue") where.dueDate = { lt: new Date() };
    const projects = await prisma.project.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        tasks: { select: { id: true, status: true, assigneeId: true, dueDate: true } },
        bugs: { select: { id: true, status: true, severity: true } },
        _count: { select: { tasks: true, bugs: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    let filtered = projects;
    if (assigneeId) {
      filtered = projects.filter(
        (p) =>
          p.owner.id === assigneeId || p.members.some((m) => m.user.id === assigneeId) || p.tasks.some((t) => t.assigneeId === assigneeId)
      );
    }
    res.json({
      projects: filtered.map((p) => ({
        ...p,
        progress: progressFor(p.tasks),
        openBugs: p.bugs.filter((b) => !["VERIFIED", "CLOSED"].includes(b.status)).length,
      })),
    });
  })
);

// POST /api/projects
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, parsed.error.errors[0]?.message ?? "Invalid project data.");
    const d = parsed.data;
    const workspaceId = await defaultWorkspaceId();
    const owner = await prisma.user.findUnique({ where: { id: d.ownerId } });
    if (!owner) return safeError(res, 400, "Project owner not found.");
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId,
          name: d.name,
          clientName: d.clientName || null,
          description: d.description || null,
          category: d.category,
          status: d.status,
          priority: d.priority,
          startDate: d.startDate ? new Date(d.startDate) : null,
          dueDate: d.dueDate ? new Date(d.dueDate) : null,
          ownerId: d.ownerId,
          createdById: req.user!.id,
          tags: d.tags,
          links: d.links ?? undefined,
          notes: d.notes || null,
        },
      });
      const memberIds = Array.from(new Set([d.ownerId, req.user!.id, ...d.memberIds]));
      await tx.projectMember.createMany({
        data: memberIds.map((userId) => ({ projectId: created.id, userId })),
        skipDuplicates: true,
      });
      await tx.activityLog.create({
        data: { workspaceId, projectId: created.id, actorId: req.user!.id, action: "PROJECT_CREATED", details: { name: created.name } },
      });
      return created;
    });
    emitToWorkspace(workspaceId, "project:created", { projectId: project.id });
    res.status(201).json({ project });
  })
);

// GET /api/projects/:id — detailed workspace
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        bugs: {
          include: { assignee: { select: { id: true, name: true } }, reporter: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
        comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
        activities: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!project) return safeError(res, 404, "Project not found.");
    const progress = progressFor(project.tasks);
    res.json({ project: { ...project, progress } });
  })
);

// PATCH /api/projects/:id
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.partial().safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid project data.");
    const d = parsed.data;
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing) return safeError(res, 404, "Project not found.");
    // Members can update; only ADMIN can delete (enforced on DELETE). Role check for destructive status:
    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.project.update({
        where: { id: req.params.id },
        data: {
          ...(d.name ? { name: d.name } : {}),
          ...(d.clientName !== undefined ? { clientName: d.clientName || null } : {}),
          ...(d.description !== undefined ? { description: d.description || null } : {}),
          ...(d.category ? { category: d.category } : {}),
          ...(d.status ? { status: d.status } : {}),
          ...(d.priority ? { priority: d.priority } : {}),
          ...(d.startDate !== undefined ? { startDate: d.startDate ? new Date(d.startDate) : null } : {}),
          ...(d.dueDate !== undefined ? { dueDate: d.dueDate ? new Date(d.dueDate) : null } : {}),
          ...(d.ownerId ? { ownerId: d.ownerId } : {}),
          ...(d.tags ? { tags: d.tags } : {}),
          ...(d.links !== undefined ? { links: d.links ?? undefined } : {}),
          ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
        },
      });
      if (d.memberIds) {
        const ids = Array.from(new Set([p.ownerId, ...d.memberIds]));
        await tx.projectMember.deleteMany({ where: { projectId: p.id, userId: { notIn: ids } } });
        await tx.projectMember.createMany({
          data: ids.map((userId) => ({ projectId: p.id, userId })),
          skipDuplicates: true,
        });
      }
      await tx.activityLog.create({
        data: { workspaceId: p.workspaceId, projectId: p.id, actorId: req.user!.id, action: "PROJECT_UPDATED", details: d as object },
      });
      return p;
    });
    emitToWorkspace(updated.workspaceId, "project:updated", { projectId: updated.id });
    res.json({ project: updated });
  })
);

// DELETE /api/projects/:id — admin only
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== "ADMIN") return safeError(res, 403, "Only admins can delete projects.");
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing) return safeError(res, 404, "Project not found.");
    await prisma.project.delete({ where: { id: req.params.id } });
    emitToWorkspace(existing.workspaceId, "project:deleted", { projectId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
