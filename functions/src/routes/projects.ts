import { Router } from "express";
import { col, doc, FieldValue, ts, WORKSPACE_ID } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../auth.js";
import { projectSchema } from "../validation.js";
import { ensureWorkspace, logActivity, userMap } from "../store.js";
import { progressFor } from "../workflow.js";

const router = Router();
router.use(requireAuth);

function shapeProject(p: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { ...p, ...extra };
}

// GET /api/projects — searchable, filterable overview
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, status, category, priority, assigneeId, due } = req.query as Record<string, string | undefined>;
    let snap = await col.projects().where("workspaceId", "==", WORKSPACE_ID).orderBy("updatedAt", "desc").limit(100).get();
    let projects = snap.docs.map((d) => doc(d) as unknown as Record<string, unknown>);

    if (status) projects = projects.filter((p) => p.status === status);
    if (category) projects = projects.filter((p) => p.category === category);
    if (priority) projects = projects.filter((p) => p.priority === priority);
    if (q) {
      const needle = q.toLowerCase();
      projects = projects.filter((p) =>
        [p.name, p.clientName, p.description].some((v) => typeof v === "string" && v.toLowerCase().includes(needle))
      );
    }
    if (due === "overdue") {
      const now = Date.now();
      projects = projects.filter((p) => p.dueDate && new Date(p.dueDate as string).getTime() < now);
    }

    const out = await Promise.all(
      projects.map(async (p) => {
        const [taskSnap, bugSnap, users] = await Promise.all([
          col.tasks().where("projectId", "==", p.id).select("status", "assigneeId", "dueDate").get(),
          col.bugs().where("projectId", "==", p.id).select("status", "severity").get(),
          userMap([(p.ownerId as string), ...((p.memberIds as string[]) ?? [])]),
        ]);
        const tasks = taskSnap.docs.map((t) => t.data() as { status: string; assigneeId?: string });
        const bugs = bugSnap.docs.map((b) => b.data() as { status: string; severity: string });
        let filtered = true;
        if (assigneeId) {
          filtered =
            p.ownerId === assigneeId ||
            ((p.memberIds as string[]) ?? []).includes(assigneeId) ||
            tasks.some((t) => t.assigneeId === assigneeId);
        }
        if (!filtered) return null;
        const owner = users[p.ownerId as string];
        return shapeProject(p, {
          owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : { id: p.ownerId, name: "Unknown" },
          members: ((p.memberIds as string[]) ?? []).map((id) => ({ user: users[id] ?? { id, name: "Unknown" } })),
          tasks,
          bugs,
          _count: { tasks: tasks.length, bugs: bugs.length },
          progress: progressFor(tasks.map((t) => t.status)),
          openBugs: bugs.filter((b) => !["VERIFIED", "CLOSED"].includes(b.status)).length,
        });
      })
    );
    res.json({ projects: out.filter(Boolean) });
  })
);

// POST /api/projects
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, parsed.error.errors[0]?.message ?? "Invalid project data.");
    const d = parsed.data;
    await ensureWorkspace();
    const ownerSnap = await col.users().doc(d.ownerId).get();
    if (!ownerSnap.exists) return safeError(res, 400, "Project owner not found.");
    const now = FieldValue.serverTimestamp();
    const memberIds = Array.from(new Set([d.ownerId, req.user!.id, ...d.memberIds]));
    const ref = await col.projects().add({
      workspaceId: WORKSPACE_ID,
      name: d.name,
      clientName: d.clientName || null,
      description: d.description || null,
      category: d.category,
      status: d.status,
      priority: d.priority,
      startDate: ts(d.startDate),
      dueDate: ts(d.dueDate),
      ownerId: d.ownerId,
      createdById: req.user!.id,
      tags: d.tags,
      links: d.links ?? null,
      notes: d.notes || null,
      memberIds,
      createdAt: now,
      updatedAt: now,
    });
    await logActivity({ workspaceId: WORKSPACE_ID, projectId: ref.id, actorId: req.user!.id, action: "PROJECT_CREATED", details: { name: d.name } });
    const created = doc(await ref.get()) as unknown as Record<string, unknown>;
    res.status(201).json({ project: created });
  })
);

// GET /api/projects/:id — detailed workspace
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const snap = await col.projects().doc(req.params.id).get();
    const p = doc(snap) as unknown as Record<string, unknown> | null;
    if (!p) return safeError(res, 404, "Project not found.");
    const [taskSnap, bugSnap, commentSnap, activitySnap, users] = await Promise.all([
      col.tasks().where("projectId", "==", p.id).orderBy("createdAt", "desc").get(),
      col.bugs().where("projectId", "==", p.id).orderBy("createdAt", "desc").get(),
      col.comments().where("projectId", "==", p.id).orderBy("createdAt", "desc").limit(50).get(),
      col.activities().where("projectId", "==", p.id).orderBy("createdAt", "desc").limit(50).get(),
      userMap([
        p.ownerId as string,
        p.createdById as string,
        ...((p.memberIds as string[]) ?? []),
      ]),
    ]);
    const tasks: Record<string, unknown>[] = await Promise.all(
      taskSnap.docs.map(async (t) => {
        const td = doc(t) as unknown as Record<string, unknown>;
        const [subs, comments] = await Promise.all([
          col.subtasks(t.id).select().get(),
          col.comments().where("taskId", "==", t.id).select().get(),
        ]);
        const a = users[(td.assigneeId as string) ?? ""];
        return { ...td, assignee: a ? { id: a.id, name: a.name } : null, _count: { subtasks: subs.size, comments: comments.size } };
      })
    );
    const bugs = bugSnap.docs.map((b) => {
      const bd = doc(b) as unknown as Record<string, unknown>;
      const a = users[(bd.assigneeId as string) ?? ""];
      const r = users[(bd.reporterId as string) ?? ""];
      return { ...bd, assignee: a ? { id: a.id, name: a.name } : null, reporter: r ? { id: r.id, name: r.name } : null };
    });
    const comments = commentSnap.docs.map((c) => {
      const cd = doc(c) as unknown as Record<string, unknown>;
      const a = users[(cd.authorId as string) ?? ""];
      return { ...cd, author: { id: cd.authorId, name: a?.name ?? "Unknown" } };
    });
    const activities = activitySnap.docs.map((a) => {
      const ad = doc(a) as unknown as Record<string, unknown>;
      const actor = users[(ad.actorId as string) ?? ""];
      return { ...ad, actor: actor ? { id: actor.id, name: actor.name } : null };
    });
    const owner = users[p.ownerId as string];
    const creator = users[p.createdById as string];
    res.json({
      project: {
        ...p,
        owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : { id: p.ownerId, name: "Unknown" },
        creator: creator ? { id: creator.id, name: creator.name } : null,
        members: ((p.memberIds as string[]) ?? []).map((id) => ({ user: users[id] ?? { id, name: "Unknown" } })),
        tasks,
        bugs,
        comments,
        activities,
        progress: progressFor(tasks.map((t) => t.status as string)),
      },
    });
  })
);

// PATCH /api/projects/:id
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.partial().safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid project data.");
    const ref = col.projects().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return safeError(res, 404, "Project not found.");
    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (d.name) updates.name = d.name;
    if (d.clientName !== undefined) updates.clientName = d.clientName || null;
    if (d.description !== undefined) updates.description = d.description || null;
    if (d.category) updates.category = d.category;
    if (d.status) updates.status = d.status;
    if (d.priority) updates.priority = d.priority;
    if (d.startDate !== undefined) updates.startDate = ts(d.startDate);
    if (d.dueDate !== undefined) updates.dueDate = ts(d.dueDate);
    if (d.ownerId) updates.ownerId = d.ownerId;
    if (d.tags) updates.tags = d.tags;
    if (d.links !== undefined) updates.links = d.links ?? null;
    if (d.notes !== undefined) updates.notes = d.notes || null;
    if (d.memberIds) {
      const ownerId = (d.ownerId as string | undefined) ?? ((snap.data() as { ownerId: string }).ownerId);
      updates.memberIds = Array.from(new Set([ownerId, ...d.memberIds]));
    }
    await ref.update(updates);
    await logActivity({ workspaceId: WORKSPACE_ID, projectId: ref.id, actorId: req.user!.id, action: "PROJECT_UPDATED", details: (d as unknown as Record<string, unknown>) ?? {} });
    const updated = doc(await ref.get());
    res.json({ project: updated });
  })
);

// DELETE /api/projects/:id — admin only (cascade handled in store)
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== "ADMIN") return safeError(res, 403, "Only admins can delete projects.");
    const snap = await col.projects().doc(req.params.id).get();
    if (!snap.exists) return safeError(res, 404, "Project not found.");
    const { deleteProjectCascade } = await import("../store.js");
    await deleteProjectCascade(req.params.id);
    res.json({ ok: true });
  })
);

export default router;
