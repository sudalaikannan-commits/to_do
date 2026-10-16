import { col, doc, FieldValue, Timestamp, WORKSPACE_ID } from "./db.js";
import type { ActivityDoc, NotificationDoc } from "./types.js";

// ---------- users ----------

export async function userMap(ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  const out: Record<string, { id: string; name: string; email?: string }> = {};
  await Promise.all(
    unique.map(async (id) => {
      const snap = await col.users().doc(id).get();
      if (snap.exists) {
        const d = snap.data() as { name: string; email: string };
        out[id] = { id, name: d.name, email: d.email };
      }
    })
  );
  return out;
}

export async function ensureWorkspace(): Promise<string> {
  const ref = col.workspaces().doc(WORKSPACE_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ name: "Ationic", slug: "ationic", createdAt: FieldValue.serverTimestamp() });
  }
  return WORKSPACE_ID;
}

// ---------- activity + notifications ----------

export async function logActivity(a: Omit<ActivityDoc, "createdAt">): Promise<void> {
  await col.activities().add({ ...a, createdAt: FieldValue.serverTimestamp() });
}

export async function notify(
  userId: string | null | undefined,
  n: { type: string; title: string; body?: string | null; link?: string | null }
): Promise<void> {
  if (!userId) return;
  await col.notifications().add({
    userId,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ---------- dashboard aggregates ----------

const OPEN_TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

export async function dashboardFor(userId: string) {
  const now = Timestamp.now();
  const tasks = col.tasks().where("workspaceId", "==", WORKSPACE_ID);
  const bugs = col.bugs().where("workspaceId", "==", WORKSPACE_ID);
  const projects = col.projects().where("workspaceId", "==", WORKSPACE_ID);

  const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;

  const [activeProjects, myTasks, inProgress, inReview, completed, overdue, openBugs] = await Promise.all([
    count(projects.where("status", "in", ["PLANNING", "NOT_STARTED", "IN_PROGRESS", "IN_REVIEW"])),
    count(tasks.where("assigneeId", "==", userId).where("status", "in", OPEN_TASK_STATUSES)),
    count(tasks.where("status", "==", "IN_PROGRESS")),
    count(tasks.where("status", "==", "IN_REVIEW")),
    count(tasks.where("status", "==", "COMPLETED")),
    count(tasks.where("dueDate", "<", now).where("status", "in", OPEN_TASK_STATUSES)),
    count(bugs.where("status", "not-in", ["VERIFIED", "CLOSED"])),
  ]);

  const [upcomingSnap, activitySnap, projectSnap, mineSnap, usersSnap] = await Promise.all([
    tasks.where("dueDate", ">=", now).where("status", "in", OPEN_TASK_STATUSES).orderBy("dueDate").limit(8).get(),
    col.activities().where("workspaceId", "==", WORKSPACE_ID).orderBy("createdAt", "desc").limit(15).get(),
    projects.orderBy("updatedAt", "desc").limit(50).get(),
    tasks.where("assigneeId", "==", userId).where("status", "in", OPEN_TASK_STATUSES).orderBy("dueDate").limit(8).get(),
    col.users().get(),
  ]);

  const projectIds = new Set<string>();
  upcomingSnap.forEach((d) => projectIds.add((d.data() as { projectId: string }).projectId));
  mineSnap.forEach((d) => projectIds.add((d.data() as { projectId: string }).projectId));
  const [projectDocs, users] = await Promise.all([
    Promise.all([...projectIds].map((id) => col.projects().doc(id).get())),
    Promise.resolve(userMap([
      ...upcomingSnap.docs.map((d) => (d.data() as { assigneeId?: string }).assigneeId),
      ...activitySnap.docs.map((d) => (d.data() as { actorId?: string }).actorId),
    ])),
  ]);
  const projectName = (id: string) => {
    const f = projectDocs.find((p) => p.id === id);
    return f?.exists ? { id, name: (f.data() as { name: string }).name } : { id, name: "Project" };
  };

  const upcomingDeadlines = upcomingSnap.docs.map((d) => {
    const t = doc(d) as unknown as Record<string, unknown>;
    const a = users[(t.assigneeId as string) ?? ""];
    return { ...t, project: projectName(t.projectId as string), assignee: a ? { name: a.name } : null };
  });
  const recentActivity = activitySnap.docs.map((d) => {
    const a = doc(d) as unknown as Record<string, unknown>;
    const actor = users[(a.actorId as string) ?? ""];
    return { ...a, actor: actor ? { name: actor.name } : null, project: a.projectId ? projectName(a.projectId as string) : null };
  });
  const myPriorityTasks = mineSnap.docs.map((d) => {
    const t = doc(d) as unknown as Record<string, unknown>;
    return { ...t, project: projectName(t.projectId as string) };
  });

  // Project progress needs per-project task statuses (bounded: 50 projects × tasks).
  const projectList = await Promise.all(
    projectSnap.docs.map(async (p) => {
      const pd = doc(p) as unknown as { id: string; name: string };
      const ts = await tasks.where("projectId", "==", pd.id).select("status").get();
      const statuses = ts.docs.map((t) => (t.data() as { status: string }).status);
      const done = statuses.filter((s) => s === "COMPLETED").length;
      return { id: pd.id, name: pd.name, total: statuses.length, done, progress: statuses.length ? Math.round((done / statuses.length) * 100) : 0 };
    })
  );

  // Team workload: open task counts per user.
  const teamWorkload = await Promise.all(
    usersSnap.docs.map(async (u) => {
      const open = await count(tasks.where("assigneeId", "==", u.id).where("status", "in", OPEN_TASK_STATUSES));
      return { id: u.id, name: (u.data() as { name: string }).name, openTasks: open };
    })
  );

  return {
    stats: { activeProjects, myTasks, inProgress, inReview, completed, overdue, openBugs },
    upcomingDeadlines,
    recentActivity,
    projects: projectList,
    myPriorityTasks,
    teamWorkload,
  };
}

// ---------- batched cascade delete for a project ----------

export async function deleteProjectCascade(projectId: string): Promise<void> {
  const BATCH = 400;
  const taskSnap = await col.tasks().where("projectId", "==", projectId).select().get();
  for (const t of taskSnap.docs) {
    const subs = await col.subtasks(t.id).select().get();
    for (let i = 0; i < subs.docs.length; i += BATCH) {
      const b = col.subtasks(t.id).firestore.batch();
      subs.docs.slice(i, i + BATCH).forEach((s) => b.delete(s.ref));
      await b.commit();
    }
  }
  const collections: FirebaseFirestore.Query[] = [
    col.tasks().where("projectId", "==", projectId),
    col.bugs().where("projectId", "==", projectId),
    col.comments().where("projectId", "==", projectId),
    col.activities().where("projectId", "==", projectId),
    col.attachments().where("projectId", "==", projectId),
  ];
  for (const q of collections) {
    const snap = await q.select().get();
    for (let i = 0; i < snap.docs.length; i += BATCH) {
      const b = col.projects().firestore.batch();
      snap.docs.slice(i, i + BATCH).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  // Comments attached to tasks/bugs of this project (parent refs, not projectId).
  const taskIds = new Set(taskSnap.docs.map((d) => d.id));
  const bugSnap = await col.bugs().where("projectId", "==", projectId).select().get();
  const bugIds = new Set(bugSnap.docs.map((d) => d.id));
  const [taskComments, bugComments] = await Promise.all([
    taskIds.size ? col.comments().where("taskId", "in", [...taskIds].slice(0, 10)).select().get() : null,
    bugIds.size ? col.comments().where("bugId", "in", [...bugIds].slice(0, 10)).select().get() : null,
  ]);
  for (const snap of [taskComments, bugComments]) {
    if (!snap || snap.empty) continue;
    const b = col.projects().firestore.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await col.projects().doc(projectId).delete();
}

/** Allocate the next BUG-XXXX code atomically. */
export async function allocateBugCode(): Promise<{ code: string }> {
  const ref = col.counters().doc("bugs");
  const code = await col.projects().firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = ((snap.exists ? (snap.data() as { next?: number }).next : 0) ?? 0) + 1;
    tx.set(ref, { next }, { merge: true });
    return `BUG-${String(next).padStart(4, "0")}`;
  });
  return { code };
}
