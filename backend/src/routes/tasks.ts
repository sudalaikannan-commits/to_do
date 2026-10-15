import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../middleware/auth.js";
import { taskSchema, taskUpdateSchema, subtaskSchema } from "../validators.js";
import { emitToWorkspace } from "../realtime.js";

const router = Router();
router.use(requireAuth);

async function logTask(projectId: string, taskId: string, actorId: string, action: string, details?: object) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  await prisma.activityLog.create({
    data: { workspaceId: project?.workspaceId, projectId, taskId, actorId, action, details: details ?? {} },
  });
}

async function notifyAssignee(userId: string | null | undefined, title: string, body: string, link: string) {
  if (!userId) return;
  await prisma.notification.create({ data: { userId, type: "TASK_ASSIGNED", title, body, link } });
  emitToWorkspace("ationic", "notification:new", { userId });
}

// GET /api/tasks — filters: projectId, assigneeId(me), status, priority, q, overdue, page
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, status, priority, assigneeId, projectId, view, page = "1", pageSize = "50" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assigneeId === "me") where.assigneeId = req.user!.id;
    else if (assigneeId) where.assigneeId = assigneeId;
    if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
    if (view === "overdue") where.AND = [{ dueDate: { lt: new Date() } }, { status: { notIn: ["COMPLETED", "CANCELLED"] } }];
    if (view === "completed") where.status = "COMPLETED";
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 50));
    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        include: {
          assignee: { select: { id: true, name: true } },
          project: { select: { id: true, name: true, clientName: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        skip: (p - 1) * ps,
        take: ps,
      }),
    ]);
    res.json({ tasks, total, page: p, pageSize: ps });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, parsed.error.errors[0]?.message ?? "Invalid task data.");
    const d = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: d.projectId } });
    if (!project) return safeError(res, 404, "Project not found.");
    const task = await prisma.task.create({
      data: {
        projectId: d.projectId,
        title: d.title,
        description: d.description || null,
        status: d.status,
        priority: d.priority,
        assigneeId: d.assigneeId || null,
        creatorId: req.user!.id,
        startDate: d.startDate ? new Date(d.startDate) : null,
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        labels: d.labels,
      },
      include: { assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    });
    await logTask(d.projectId, task.id, req.user!.id, "TASK_CREATED", { title: task.title });
    await notifyAssignee(task.assigneeId, `Assigned: ${task.title}`, `Project: ${task.project.name}`, `/tasks/${task.id}`);
    emitToWorkspace(project.workspaceId, "task:created", { taskId: task.id, projectId: d.projectId });
    res.status(201).json({ task });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, workspaceId: true } },
        subtasks: { orderBy: { position: "asc" } },
        comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
        activities: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 30 },
      },
    });
    if (!task) return safeError(res, 404, "Task not found.");
    res.json({ task });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid task data.");
    const existing = await prisma.task.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!existing) return safeError(res, 404, "Task not found.");
    const d = parsed.data;
    const prevAssignee = existing.assigneeId;
    const prevStatus = existing.status;
    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...(d.title ? { title: d.title } : {}),
        ...(d.description !== undefined ? { description: d.description || null } : {}),
        ...(d.status ? { status: d.status, completedAt: d.status === "COMPLETED" ? new Date() : null } : {}),
        ...(d.priority ? { priority: d.priority } : {}),
        ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId || null } : {}),
        ...(d.startDate !== undefined ? { startDate: d.startDate ? new Date(d.startDate) : null } : {}),
        ...(d.dueDate !== undefined ? { dueDate: d.dueDate ? new Date(d.dueDate) : null } : {}),
        ...(d.labels ? { labels: d.labels } : {}),
      },
    });
    if (d.status && d.status !== prevStatus) {
      await logTask(existing.projectId, existing.id, req.user!.id, d.status === "COMPLETED" ? "TASK_COMPLETED" : "STATUS_CHANGED", {
        from: prevStatus,
        to: d.status,
      });
    }
    if (d.assigneeId !== undefined && d.assigneeId !== prevAssignee) {
      await logTask(existing.projectId, existing.id, req.user!.id, "ASSIGNEE_CHANGED", { from: prevAssignee, to: d.assigneeId });
      await notifyAssignee(updated.assigneeId, `Assigned: ${updated.title}`, "You have a new task assignment.", `/tasks/${updated.id}`);
    }
    if (d.dueDate !== undefined) {
      await logTask(existing.projectId, existing.id, req.user!.id, "DEADLINE_CHANGED", { dueDate: d.dueDate });
    }
    emitToWorkspace(existing.project.workspaceId, "task:updated", { taskId: updated.id, projectId: existing.projectId });
    res.json({ task: updated });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.task.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!existing) return safeError(res, 404, "Task not found.");
    if (req.user!.role !== "ADMIN" && existing.creatorId !== req.user!.id) {
      return safeError(res, 403, "Only admins or the task creator can delete this task.");
    }
    await prisma.task.delete({ where: { id: req.params.id } });
    emitToWorkspace(existing.project.workspaceId, "task:deleted", { taskId: req.params.id, projectId: existing.projectId });
    res.json({ ok: true });
  })
);

// Subtasks
router.post(
  "/:id/subtasks",
  asyncHandler(async (req, res) => {
    const parsed = subtaskSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid subtask.");
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) return safeError(res, 404, "Task not found.");
    const count = await prisma.subtask.count({ where: { taskId: task.id } });
    const sub = await prisma.subtask.create({
      data: { taskId: task.id, title: parsed.data.title, done: parsed.data.done ?? false, position: parsed.data.position ?? count },
    });
    res.status(201).json({ subtask: sub });
  })
);

router.patch(
  "/:id/subtasks/:subId",
  asyncHandler(async (req, res) => {
    const parsed = subtaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid subtask.");
    const sub = await prisma.subtask.update({ where: { id: req.params.subId }, data: parsed.data });
    res.json({ subtask: sub });
  })
);

router.delete(
  "/:id/subtasks/:subId",
  asyncHandler(async (req, res) => {
    await prisma.subtask.delete({ where: { id: req.params.subId } });
    res.json({ ok: true });
  })
);

export default router;
