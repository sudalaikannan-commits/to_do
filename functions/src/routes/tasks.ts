import { Router } from "express";
import { col, doc, FieldValue, ts, WORKSPACE_ID } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../auth.js";
import { taskSchema, taskUpdateSchema, subtaskSchema } from "../validation.js";
import { logActivity, notify, userMap } from "../store.js";

const router = Router();
router.use(requireAuth);

// GET /api/tasks — filters: projectId, assigneeId(me), status, priority, q, view, page
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, status, priority, assigneeId, projectId, view, page = "1", pageSize = "50" } = req.query as Record<string, string>;
    let query: FirebaseFirestore.Query = col.tasks().where("workspaceId", "==", WORKSPACE_ID);
    if (projectId) query = query.where("projectId", "==", projectId);
    if (priority) query = query.where("priority", "==", priority);
    if (assigneeId === "me") query = query.where("assigneeId", "==", req.user!.id);
    else if (assigneeId) query = query.where("assigneeId", "==", assigneeId);
    if (view === "overdue") {
      query = query.where("dueDate", "<", new Date()).where("status", "in", ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"]);
    } else if (view === "completed") {
      query = query.where("status", "==", "COMPLETED");
    } else if (status) {
      query = query.where("status", "==", status);
    }
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 50));
    const total = (await query.count().get()).data().count;
    const snap = await query.orderBy("dueDate").orderBy("createdAt", "desc").offset((p - 1) * ps).limit(ps).get();
    let rows = snap.docs.map((d) => doc(d) as unknown as Record<string, unknown>);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((t) =>
        [t.title, t.description].some((v) => typeof v === "string" && v.toLowerCase().includes(needle))
      );
    }
    const users = await userMap(rows.map((t) => t.assigneeId as string));
    const projects = await Promise.all(rows.map((t) => col.projects().doc(t.projectId as string).get()));
    const tasks: Record<string, unknown>[] = rows.map((t, i) => {
      const a = users[(t.assigneeId as string) ?? ""];
      const pd = projects[i].exists ? (projects[i].data() as { name: string; clientName?: string }) : { name: "Project" };
      return {
        ...t,
        assignee: a ? { id: a.id, name: a.name } : null,
        project: { id: t.projectId, name: pd.name, clientName: pd.clientName ?? null },
      };
    });
    // Subtask/comment counts per task (bounded page).
    const withCounts = await Promise.all(
      tasks.map(async (t) => {
        const [subs, comments] = await Promise.all([
          col.subtasks(t.id as string).select().get(),
          col.comments().where("taskId", "==", t.id as string).select().get(),
        ]);
        return { ...t, _count: { subtasks: subs.size, comments: comments.size } };
      })
    );
    res.json({ tasks: withCounts, total, page: p, pageSize: ps });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, parsed.error.errors[0]?.message ?? "Invalid task data.");
    const d = parsed.data;
    const projectSnap = await col.projects().doc(d.projectId).get();
    if (!projectSnap.exists) return safeError(res, 404, "Project not found.");
    const now = FieldValue.serverTimestamp();
    const ref = await col.tasks().add({
      workspaceId: WORKSPACE_ID,
      projectId: d.projectId,
      title: d.title,
      description: d.description || null,
      status: d.status,
      priority: d.priority,
      assigneeId: d.assigneeId || null,
      creatorId: req.user!.id,
      startDate: ts(d.startDate),
      dueDate: ts(d.dueDate),
      labels: d.labels,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await logActivity({ workspaceId: WORKSPACE_ID, projectId: d.projectId, taskId: ref.id, actorId: req.user!.id, action: "TASK_CREATED", details: { title: d.title } });
    const created = doc(await ref.get()) as unknown as Record<string, unknown>;
    const users = await userMap([created.assigneeId as string]);
    const a = users[(created.assigneeId as string) ?? ""];
    const task: Record<string, unknown> = {
      ...created,
      assignee: a ? { id: a.id, name: a.name } : null,
      project: { id: d.projectId, name: (projectSnap.data() as { name: string }).name },
    };
    await notify(a?.id ?? null, { type: "TASK_ASSIGNED", title: `Assigned: ${d.title}`, body: `Project: ${(projectSnap.data() as { name: string }).name}`, link: `/tasks/${ref.id}` });
    res.status(201).json({ task });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const snap = await col.tasks().doc(req.params.id).get();
    const t = doc(snap) as unknown as Record<string, unknown> | null;
    if (!t) return safeError(res, 404, "Task not found.");
    const [subSnap, commentSnap, activitySnap, users, projectSnap] = await Promise.all([
      col.subtasks(req.params.id).orderBy("position").get(),
      col.comments().where("taskId", "==", req.params.id).orderBy("createdAt").get(),
      col.activities().where("taskId", "==", req.params.id).orderBy("createdAt", "desc").limit(30).get(),
      userMap([t.assigneeId as string, t.creatorId as string]),
      col.projects().doc(t.projectId as string).get(),
    ]);
    const a = users[(t.assigneeId as string) ?? ""];
    const c = users[(t.creatorId as string) ?? ""];
    const commentUsers = await userMap(commentSnap.docs.map((cm) => (cm.data() as { authorId: string }).authorId));
    const activityUsers = await userMap(activitySnap.docs.map((am) => (am.data() as { actorId?: string }).actorId));
    res.json({
      task: {
        ...t,
        assignee: a ? { id: a.id, name: a.name, email: a.email } : null,
        creator: c ? { id: c.id, name: c.name } : null,
        project: { id: t.projectId, name: projectSnap.exists ? (projectSnap.data() as { name: string }).name : "Project", workspaceId: WORKSPACE_ID },
        subtasks: subSnap.docs.map((s) => doc(s)),
        comments: commentSnap.docs.map((cm) => {
          const cd = doc(cm) as unknown as Record<string, unknown>;
          const au = commentUsers[(cd.authorId as string) ?? ""];
          return { ...cd, author: { id: cd.authorId, name: au?.name ?? "Unknown" } };
        }),
        activities: activitySnap.docs.map((am) => {
          const ad = doc(am) as unknown as Record<string, unknown>;
          const au = activityUsers[(ad.actorId as string) ?? ""];
          return { ...ad, actor: au ? { id: au.id, name: au.name } : null };
        }),
      },
    });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid task data.");
    const ref = col.tasks().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return safeError(res, 404, "Task not found.");
    const prev = snap.data() as { assigneeId?: string | null; status: string; projectId: string; title: string };
    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (d.title) updates.title = d.title;
    if (d.description !== undefined) updates.description = d.description || null;
    if (d.status) {
      updates.status = d.status;
      updates.completedAt = d.status === "COMPLETED" ? FieldValue.serverTimestamp() : null;
    }
    if (d.priority) updates.priority = d.priority;
    if (d.assigneeId !== undefined) updates.assigneeId = d.assigneeId || null;
    if (d.startDate !== undefined) updates.startDate = ts(d.startDate);
    if (d.dueDate !== undefined) updates.dueDate = ts(d.dueDate);
    if (d.labels) updates.labels = d.labels;
    await ref.update(updates);
    if (d.status && d.status !== prev.status) {
      await logActivity({
        workspaceId: WORKSPACE_ID, projectId: prev.projectId, taskId: ref.id, actorId: req.user!.id,
        action: d.status === "COMPLETED" ? "TASK_COMPLETED" : "STATUS_CHANGED",
        details: { from: prev.status, to: d.status },
      });
    }
    if (d.assigneeId !== undefined && d.assigneeId !== prev.assigneeId) {
      await logActivity({
        workspaceId: WORKSPACE_ID, projectId: prev.projectId, taskId: ref.id, actorId: req.user!.id,
        action: "ASSIGNEE_CHANGED", details: { from: prev.assigneeId ?? null, to: d.assigneeId },
      });
      await notify(d.assigneeId || null, { type: "TASK_ASSIGNED", title: `Assigned: ${prev.title}`, body: "You have a new task assignment.", link: `/tasks/${ref.id}` });
    }
    if (d.dueDate !== undefined) {
      await logActivity({ workspaceId: WORKSPACE_ID, projectId: prev.projectId, taskId: ref.id, actorId: req.user!.id, action: "DEADLINE_CHANGED", details: { dueDate: d.dueDate } });
    }
    const updated = doc(await ref.get());
    res.json({ task: updated });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const snap = await col.tasks().doc(req.params.id).get();
    if (!snap.exists) return safeError(res, 404, "Task not found.");
    const t = snap.data() as { creatorId: string };
    if (req.user!.role !== "ADMIN" && t.creatorId !== req.user!.id) {
      return safeError(res, 403, "Only admins or the task creator can delete this task.");
    }
    const subs = await col.subtasks(req.params.id).select().get();
    const comments = await col.comments().where("taskId", "==", req.params.id).select().get();
    const batch = col.tasks().firestore.batch();
    subs.docs.forEach((s) => batch.delete(s.ref));
    comments.docs.forEach((c) => batch.delete(c.ref));
    batch.delete(snap.ref);
    await batch.commit();
    res.json({ ok: true });
  })
);

// Subtasks
router.post(
  "/:id/subtasks",
  asyncHandler(async (req, res) => {
    const parsed = subtaskSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid subtask.");
    const taskSnap = await col.tasks().doc(req.params.id).get();
    if (!taskSnap.exists) return safeError(res, 404, "Task not found.");
    const existing = await col.subtasks(req.params.id).select().get();
    const ref = await col.subtasks(req.params.id).add({
      title: parsed.data.title,
      done: parsed.data.done ?? false,
      position: parsed.data.position ?? existing.size,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ subtask: doc(await ref.get()) });
  })
);

router.patch(
  "/:id/subtasks/:subId",
  asyncHandler(async (req, res) => {
    const parsed = subtaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid subtask.");
    const ref = col.subtasks(req.params.id).doc(req.params.subId);
    await ref.update(parsed.data as Record<string, unknown>);
    res.json({ subtask: doc(await ref.get()) });
  })
);

router.delete(
  "/:id/subtasks/:subId",
  asyncHandler(async (req, res) => {
    await col.subtasks(req.params.id).doc(req.params.subId).delete();
    res.json({ ok: true });
  })
);

export default router;
