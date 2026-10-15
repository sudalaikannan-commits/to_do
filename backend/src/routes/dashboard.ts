import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/dashboard — live aggregates from the database (never hardcoded)
router.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const [
      activeProjects,
      myTasks,
      inProgress,
      inReview,
      completed,
      overdue,
      openBugs,
      upcomingDeadlines,
      recentActivity,
      projectStats,
      teamWorkload,
    ] = await Promise.all([
      prisma.project.count({ where: { status: { in: ["PLANNING", "NOT_STARTED", "IN_PROGRESS", "IN_REVIEW"] } } }),
      prisma.task.count({ where: { assigneeId: (_req as { user?: { id: string } }).user!.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
      prisma.task.count({ where: { status: "IN_PROGRESS" } }),
      prisma.task.count({ where: { status: "IN_REVIEW" } }),
      prisma.task.count({ where: { status: "COMPLETED" } }),
      prisma.task.count({ where: { dueDate: { lt: now }, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
      prisma.bug.count({ where: { status: { notIn: ["VERIFIED", "CLOSED"] } } }),
      prisma.task.findMany({
        where: { dueDate: { gte: now }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        include: { assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
        orderBy: { dueDate: "asc" },
        take: 8,
      }),
      prisma.activityLog.findMany({
        include: { actor: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.project.findMany({
        include: { tasks: { select: { status: true } } },
        take: 50,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { assignedTasks: true } },
        },
      }),
    ]);

    const myId = (_req as { user?: { id: string } }).user!.id;
    const myPriorityTasks = await prisma.task.findMany({
      where: { assigneeId: myId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
      take: 8,
    });

    const projects = projectStats.map((p) => {
      const total = p.tasks.length;
      const done = p.tasks.filter((t) => t.status === "COMPLETED").length;
      return { id: p.id, name: p.name, total, done, progress: total ? Math.round((done / total) * 100) : 0 };
    });

    res.json({
      stats: { activeProjects, myTasks, inProgress, inReview, completed, overdue, openBugs },
      upcomingDeadlines,
      recentActivity,
      projects,
      myPriorityTasks,
      teamWorkload: teamWorkload.map((u) => ({ id: u.id, name: u.name, openTasks: u._count.assignedTasks })),
    });
  })
);

// GET /api/search?q= — global search across projects, tasks, bugs
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 200).trim();
    if (!q) return res.json({ projects: [], tasks: [], bugs: [] });
    const [projects, tasks, bugs] = await Promise.all([
      prisma.project.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { clientName: { contains: q, mode: "insensitive" } }] },
        take: 10,
      }),
      prisma.task.findMany({
        where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
        include: { project: { select: { id: true, name: true } } },
        take: 15,
      }),
      prisma.bug.findMany({
        where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { bugCode: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
        include: { project: { select: { id: true, name: true } } },
        take: 15,
      }),
    ]);
    res.json({ projects, tasks, bugs });
  })
);

// GET /api/activity — recent workspace activity
router.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as { projectId?: string };
    const activities = await prisma.activityLog.findMany({
      where: projectId ? { projectId } : {},
      include: { actor: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ activities });
  })
);

export default router;
