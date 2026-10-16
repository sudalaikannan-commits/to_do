import { Router } from "express";
import { col, doc, FieldValue, ts, WORKSPACE_ID } from "../db.js";
import { asyncHandler, requireAuth, safeError } from "../auth.js";
import { bugSchema, bugUpdateSchema } from "../validation.js";
import { allocateBugCode, logActivity, notify, userMap } from "../store.js";
import { checkBugTransition } from "../workflow.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { projectId, status, severity, priority, assigneeId, q } = req.query as Record<string, string | undefined>;
    let query: FirebaseFirestore.Query = col.bugs().where("workspaceId", "==", WORKSPACE_ID);
    if (projectId) query = query.where("projectId", "==", projectId);
    if (severity) query = query.where("severity", "==", severity);
    if (priority) query = query.where("priority", "==", priority);
    if (assigneeId) query = query.where("assigneeId", "==", assigneeId);
    if (status) query = query.where("status", "==", status);
    const snap = await query.orderBy("createdAt", "desc").limit(200).get();
    let rows = snap.docs.map((d) => doc(d) as unknown as Record<string, unknown>);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((b) =>
        [b.title, b.bugCode, b.description, b.pageRoute].some((v) => typeof v === "string" && v.toLowerCase().includes(needle))
      );
    }
    const users = await userMap(rows.map((b) => b.assigneeId as string).concat(rows.map((b) => b.reporterId as string)));
    const projects = await Promise.all(rows.map((b) => col.projects().doc(b.projectId as string).get()));
    const bugs: Record<string, unknown>[] = rows.map((b, i) => {
      const a = users[(b.assigneeId as string) ?? ""];
      const r = users[(b.reporterId as string) ?? ""];
      const pd = projects[i].exists ? (projects[i].data() as { name: string; clientName?: string }) : { name: "Project" };
      return {
        ...b,
        assignee: a ? { id: a.id, name: a.name } : null,
        reporter: r ? { id: r.id, name: r.name } : null,
        project: { id: b.projectId, name: pd.name, clientName: pd.clientName ?? null },
      };
    });
    const withCounts: Record<string, unknown>[] = await Promise.all(
      bugs.map(async (b) => {
        const comments = await col.comments().where("bugId", "==", b.id as string).select().get();
        return { ...b, _count: { comments: comments.size } };
      })
    );
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    for (const b of withCounts) {
      byStatus[b.status as string] = (byStatus[b.status as string] ?? 0) + 1;
      bySeverity[b.severity as string] = (bySeverity[b.severity as string] ?? 0) + 1;
      const pn = (b.project as { name: string }).name;
      byProject[pn] = (byProject[pn] ?? 0) + 1;
    }
    res.json({ bugs: withCounts, summary: { byStatus, bySeverity, byProject, total: withCounts.length } });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = bugSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, parsed.error.errors[0]?.message ?? "Invalid bug report.");
    const d = parsed.data;
    const projectSnap = await col.projects().doc(d.projectId).get();
    if (!projectSnap.exists) return safeError(res, 404, "Project not found.");
    const { code } = await allocateBugCode();
    const now = FieldValue.serverTimestamp();
    const ref = await col.bugs().add({
      workspaceId: WORKSPACE_ID,
      projectId: d.projectId,
      bugCode: code,
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
      status: "REPORTED",
      reportedAt: now,
      targetFixDate: ts(d.targetFixDate),
      resolutionNotes: null,
      createdAt: now,
      updatedAt: now,
    });
    await logActivity({ workspaceId: WORKSPACE_ID, projectId: d.projectId, bugId: ref.id, actorId: req.user!.id, action: "BUG_REPORTED", details: { bugCode: code, title: d.title } });
    if (d.assigneeId) {
      await notify(d.assigneeId, { type: "BUG_ASSIGNED", title: `Bug assigned: ${code}`, body: d.title, link: `/bugs/${ref.id}` });
    }
    res.status(201).json({ bug: doc(await ref.get()) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const snap = await col.bugs().doc(req.params.id).get();
    const b = doc(snap) as unknown as Record<string, unknown> | null;
    if (!b) return safeError(res, 404, "Bug not found.");
    const [commentSnap, activitySnap, users, projectSnap] = await Promise.all([
      col.comments().where("bugId", "==", req.params.id).orderBy("createdAt").get(),
      col.activities().where("bugId", "==", req.params.id).orderBy("createdAt", "desc").limit(30).get(),
      userMap([b.assigneeId as string, b.reporterId as string]),
      col.projects().doc(b.projectId as string).get(),
    ]);
    const a = users[(b.assigneeId as string) ?? ""];
    const r = users[(b.reporterId as string) ?? ""];
    const commentUsers = await userMap(commentSnap.docs.map((c) => (c.data() as { authorId: string }).authorId));
    const activityUsers = await userMap(activitySnap.docs.map((am) => (am.data() as { actorId?: string }).actorId));
    res.json({
      bug: {
        ...b,
        assignee: a ? { id: a.id, name: a.name } : null,
        reporter: r ? { id: r.id, name: r.name } : null,
        project: { id: b.projectId, name: projectSnap.exists ? (projectSnap.data() as { name: string }).name : "Project", workspaceId: WORKSPACE_ID },
        comments: commentSnap.docs.map((c) => {
          const cd = doc(c) as unknown as Record<string, unknown>;
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
    const parsed = bugUpdateSchema.safeParse(req.body);
    if (!parsed.success) return safeError(res, 400, "Invalid bug update.");
    const ref = col.bugs().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return safeError(res, 404, "Bug not found.");
    const prev = snap.data() as { status: string; projectId: string; bugCode: string; title: string };
    const d = parsed.data;
    if (d.status && d.status !== prev.status) {
      const blocked = checkBugTransition(prev.status, d.status);
      if (blocked) return safeError(res, 400, blocked);
    }
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (d.title) updates.title = d.title;
    if (d.websiteUrl !== undefined) updates.websiteUrl = d.websiteUrl || null;
    if (d.description) updates.description = d.description;
    if (d.steps !== undefined) updates.steps = d.steps || null;
    if (d.expected !== undefined) updates.expected = d.expected || null;
    if (d.actual !== undefined) updates.actual = d.actual || null;
    if (d.pageRoute !== undefined) updates.pageRoute = d.pageRoute || null;
    if (d.device !== undefined) updates.device = d.device || null;
    if (d.viewport !== undefined) updates.viewport = d.viewport;
    if (d.severity) updates.severity = d.severity;
    if (d.priority) updates.priority = d.priority;
    if (d.assigneeId !== undefined) updates.assigneeId = d.assigneeId || null;
    if (d.status) updates.status = d.status;
    if (d.targetFixDate !== undefined) updates.targetFixDate = ts(d.targetFixDate);
    if (d.resolutionNotes !== undefined) updates.resolutionNotes = d.resolutionNotes || null;
    await ref.update(updates);
    await logActivity({
      workspaceId: WORKSPACE_ID, projectId: prev.projectId, bugId: ref.id, actorId: req.user!.id,
      action: d.status && d.status !== prev.status ? "BUG_STATUS_CHANGED" : "BUG_UPDATED",
      details: { from: prev.status, to: (updates.status as string) ?? prev.status },
    });
    const updated = doc(await ref.get()) as unknown as Record<string, unknown>;
    if (d.assigneeId !== undefined && updated.assigneeId) {
      await notify(updated.assigneeId as string, { type: "BUG_ASSIGNED", title: `Bug assigned: ${prev.bugCode}`, body: updated.title as string, link: `/bugs/${ref.id}` });
    }
    res.json({ bug: updated });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== "ADMIN") return safeError(res, 403, "Only admins can delete bug reports.");
    const snap = await col.bugs().doc(req.params.id).get();
    if (!snap.exists) return safeError(res, 404, "Bug not found.");
    const comments = await col.comments().where("bugId", "==", req.params.id).select().get();
    const batch = col.bugs().firestore.batch();
    comments.docs.forEach((c) => batch.delete(c.ref));
    batch.delete(snap.ref);
    await batch.commit();
    res.json({ ok: true });
  })
);

export default router;
