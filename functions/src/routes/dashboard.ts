import { Router } from "express";
import { col, doc, WORKSPACE_ID } from "../db.js";
import { asyncHandler, requireAuth } from "../auth.js";
import { dashboardFor, userMap } from "../store.js";

const router = Router();
router.use(requireAuth);

// GET /api/dashboard — live aggregates (never hardcoded)
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    res.json(await dashboardFor(req.user!.id));
  })
);

// GET /api/search?q= — across projects, tasks, bugs (bounded fetch + in-memory
// match; upgrade path is a search extension for larger workspaces)
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 200).trim().toLowerCase();
    if (!q) return res.json({ projects: [], tasks: [], bugs: [] });
    const [pSnap, tSnap, bSnap] = await Promise.all([
      col.projects().where("workspaceId", "==", WORKSPACE_ID).limit(100).get(),
      col.tasks().where("workspaceId", "==", WORKSPACE_ID).limit(200).get(),
      col.bugs().where("workspaceId", "==", WORKSPACE_ID).limit(200).get(),
    ]);
    const match = (...vals: unknown[]) =>
      vals.some((v) => typeof v === "string" && v.toLowerCase().includes(q));
    const projects = pSnap.docs
      .map((d) => doc(d) as unknown as Record<string, unknown>)
      .filter((p) => match(p.name, p.clientName))
      .slice(0, 10);
    const tasks = tSnap.docs
      .map((d) => doc(d) as unknown as Record<string, unknown>)
      .filter((t) => match(t.title, t.description))
      .slice(0, 15);
    const bugs = bSnap.docs
      .map((d) => doc(d) as unknown as Record<string, unknown>)
      .filter((b) => match(b.title, b.bugCode, b.description))
      .slice(0, 15);
    const projectName = async (id: string) => {
      const s = await col.projects().doc(id).get();
      return s.exists ? { id, name: (s.data() as { name: string }).name } : { id, name: "Project" };
    };
    res.json({
      projects,
      tasks: await Promise.all(tasks.map(async (t) => ({ ...t, project: await projectName(t.projectId as string) }))),
      bugs: await Promise.all(bugs.map(async (b) => ({ ...b, project: await projectName(b.projectId as string) }))),
    });
  })
);

// GET /api/activity — recent workspace/project activity
router.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as { projectId?: string };
    let query: FirebaseFirestore.Query = col.activities().where("workspaceId", "==", WORKSPACE_ID);
    if (projectId) query = query.where("projectId", "==", projectId);
    const snap = await query.orderBy("createdAt", "desc").limit(100).get();
    const rows = snap.docs.map((d) => doc(d) as unknown as Record<string, unknown>);
    const users = await userMap(rows.map((r) => r.actorId as string));
    const activities = await Promise.all(
      rows.map(async (r) => {
        const actor = users[(r.actorId as string) ?? ""];
        let project: { id: string; name: string } | null = null;
        if (r.projectId) {
          const ps = await col.projects().doc(r.projectId as string).get();
          project = { id: r.projectId as string, name: ps.exists ? (ps.data() as { name: string }).name : "Project" };
        }
        return { ...r, actor: actor ? { id: actor.id, name: actor.name } : null, project };
      })
    );
    res.json({ activities });
  })
);

export default router;
