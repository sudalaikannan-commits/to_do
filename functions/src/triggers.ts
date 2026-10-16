import * as functions from "firebase-functions";
import { col, WORKSPACE_ID } from "./db.js";
import { notify } from "./store.js";

/** Cleanup when a Firebase Auth user is deleted: profile + memberships. */
export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  await col.users().doc(user.uid).delete().catch(() => undefined);
  await col.members().doc(user.uid).delete().catch(() => undefined);
  // Best-effort: unassign tasks/bugs owned by the deleted user (bounded).
  const [tasks, bugs] = await Promise.all([
    col.tasks().where("assigneeId", "==", user.uid).limit(100).select().get(),
    col.bugs().where("assigneeId", "==", user.uid).limit(100).select().get(),
  ]);
  const batch = col.users().firestore.batch();
  tasks.docs.forEach((d) => batch.update(d.ref, { assigneeId: null }));
  bugs.docs.forEach((d) => batch.update(d.ref, { assigneeId: null }));
  await batch.commit().catch(() => undefined);
});

/**
 * Daily overdue/due-soon digest (Cloud Scheduler — requires Blaze plan).
 * Notifies each member about their own overdue and due-in-48h tasks.
 */
export const dailyDigest = functions.pubsub.schedule("every day 07:00").timeZone("Asia/Kolkata").onRun(async () => {
  const now = new Date();
  const soon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const snap = await col.tasks()
    .where("workspaceId", "==", WORKSPACE_ID)
    .where("status", "in", ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"])
    .limit(500)
    .get();
  for (const d of snap.docs) {
    const t = d.data() as { assigneeId?: string | null; dueDate?: FirebaseFirestore.Timestamp | null; title: string; projectId: string };
    if (!t.assigneeId || !t.dueDate) continue;
    const due = t.dueDate.toDate().getTime();
    if (due < now.getTime()) {
      await notify(t.assigneeId, { type: "OVERDUE", title: `Overdue: ${t.title}`, body: "This task is past its due date.", link: `/tasks/${d.id}` });
    } else if (due <= soon.getTime()) {
      await notify(t.assigneeId, { type: "DUE_SOON", title: `Due soon: ${t.title}`, body: "Due within 48 hours.", link: `/tasks/${d.id}` });
    }
  }
});
