/**
 * ONE-WAY migration: PostgreSQL (legacy backend DB) -> Cloud Firestore.
 *
 * - Does NOT modify or delete the PostgreSQL database (read-only source).
 * - Reuses PostgreSQL row IDs as Firestore document IDs, so every
 *   project/task/bug/comment reference stays intact without remapping.
 * - User IDs cannot be reused: Firebase Auth owns user identity. Users are
 *   matched by EMAIL -> new Firebase UID, and all user references
 *   (ownerId, assigneeId, reporterId, authorId, actorId, memberIds) are
 *   rewritten through that map.
 * - Password hashes are NEVER copied (Firebase Auth cannot import bcrypt
 *   this way, and must not receive them). Migrated users are created WITHOUT
 *   a password and flagged `mustResetPassword`; each person sets their own
 *   password via the Firebase "forgot password" email flow.
 * - Attachment binaries are NOT moved (metadata only); copy files to
 *   Firebase Storage manually, then update `storagePath`.
 *
 * Usage (from functions/):
 *   PGDATABASE_URL="postgresql://..." \
 *   GOOGLE_APPLICATION_CREDENTIALS="/secure/service-account.json" \
 *   npx tsx migrate/pg-to-firestore.ts --dry-run   # plan only
 *   npx tsx migrate/pg-to-firestore.ts             # real run
 * Or target the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 *                        FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
 *
 * Prints counts only — never passwords, hashes, tokens or secrets.
 */
import admin from "firebase-admin";
import { Pool } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

if (!process.env.PGDATABASE_URL) {
  console.error("Set PGDATABASE_URL to the source PostgreSQL connection string.");
  process.exit(1);
}

if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore();
const fbauth = admin.auth();
const pg = new Pool({ connectionString: process.env.PGDATABASE_URL });
const BATCH = 400;

const T = (d: unknown): FirebaseFirestore.Timestamp | null =>
  d instanceof Date ? admin.firestore.Timestamp.fromDate(d) : null;
const now = () => admin.firestore.FieldValue.serverTimestamp();

async function rows<T>(sql: string): Promise<T[]> {
  const r = await pg.query(sql);
  return r.rows as T[];
}

async function writeBatch(
  collection: string,
  docs: { id: string; data: Record<string, unknown>; sub?: { name: string; docs: { id: string; data: Record<string, unknown> }[] }[] }[],
  summary: Record<string, number>
) {
  if (DRY_RUN) {
    summary[collection] = (summary[collection] ?? 0) + docs.length;
    return;
  }
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + BATCH)) {
      const ref = db.collection(collection).doc(d.id);
      batch.set(ref, d.data, { merge: false });
      for (const s of d.sub ?? []) {
        for (const sd of s.docs) batch.set(ref.collection(s.name).doc(sd.id), sd.data);
      }
    }
    await batch.commit();
  }
  summary[collection] = (summary[collection] ?? 0) + docs.length;
}

interface PgUser { id: string; email: string; name: string; role: string; avatarUrl: string | null; createdAt: Date; updatedAt: Date }

async function main() {
  const summary: Record<string, number> = {};

  // ---- 1. Users: match by email -> Firebase UID (no passwords migrated) ----
  const pgUsers = await rows<PgUser>(`SELECT id, email, name, role, "avatarUrl", "createdAt", "updatedAt" FROM "User" ORDER BY "createdAt"`);
  const uidByPgId = new Map<string, string>();
  for (const u of pgUsers) {
    if (DRY_RUN) {
      uidByPgId.set(u.id, `uid-for:${u.email}`);
      continue;
    }
    let user;
    try {
      user = await fbauth.createUser({ email: u.email, displayName: u.name, emailVerified: true });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "auth/email-already-exists") {
        user = await fbauth.getUserByEmail(u.email);
      } else throw e;
    }
    const isAdmin = u.role === "ADMIN";
    const current = (await fbauth.getUser(user.uid)).customClaims ?? {};
    await fbauth.setCustomUserClaims(user.uid, { ...current, ...(isAdmin ? { admin: true } : {}) });
    await db.collection("users").doc(user.uid).set(
      {
        email: u.email, name: u.name, role: u.role, avatarUrl: u.avatarUrl,
        mustResetPassword: true, migratedAt: now(), createdAt: T(u.createdAt), updatedAt: T(u.updatedAt),
      },
      { merge: true }
    );
    uidByPgId.set(u.id, user.uid);
  }
  summary.users = pgUsers.length;
  console.log(`users: ${pgUsers.length} mapped by email (passwords NOT migrated; users set their own via reset email)`);

  const uid = (pgId: string | null | undefined): string | null =>
    pgId ? (uidByPgId.get(pgId) ?? (DRY_RUN ? `uid-for:${pgId}` : null)) : null;

  // ---- 2. Workspace + memberships ----
  const ws = await rows<{ id: string; name: string; slug: string }>(`SELECT id, name, slug FROM "Workspace"`);
  const wsId = ws[0]?.id ?? "ationic";
  if (!DRY_RUN) {
    await db.collection("workspaces").doc("ationic").set({ name: ws[0]?.name ?? "Ationic", slug: "ationic", createdAt: now() }, { merge: true });
  }
  const memberships = await rows<{ userId: string; workspaceId: string; role: string }>(`SELECT "userId", "workspaceId", role FROM "Membership"`);
  if (!DRY_RUN) {
    const batch = db.batch();
    for (const m of memberships) {
      const id = uid(m.userId);
      if (id) batch.set(db.collection("workspaces").doc("ationic").collection("members").doc(id), { role: m.role, createdAt: now() });
    }
    await batch.commit();
  }
  summary["workspaces/ationic/members"] = memberships.length;

  // ---- 3. Projects (+ memberIds from ProjectMember) ----
  const projects = await rows<Record<string, never>>(`SELECT * FROM "Project" ORDER BY "createdAt"`);
  const members = await rows<{ projectId: string; userId: string }>(`SELECT "projectId", "userId" FROM "ProjectMember"`);
  const membersByProject = new Map<string, string[]>();
  for (const m of members) {
    const id = uid(m.userId);
    if (!id) continue;
    if (!membersByProject.has(m.projectId)) membersByProject.set(m.projectId, []);
    membersByProject.get(m.projectId)!.push(id);
  }
  await writeBatch(
    "projects",
    (projects as unknown as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      data: {
        workspaceId: wsId ? "ationic" : "ationic",
        name: p.name, clientName: p.clientName ?? null, description: p.description ?? null,
        category: p.category, status: p.status, priority: p.priority,
        startDate: T(p.startDate), dueDate: T(p.dueDate),
        ownerId: uid(p.ownerId as string), createdById: uid(p.createdById as string),
        memberIds: membersByProject.get(p.id as string) ?? [],
        tags: (p.tags as string[]) ?? [], links: p.links ?? null, notes: p.notes ?? null,
        createdAt: T(p.createdAt), updatedAt: T(p.updatedAt),
      },
    })),
    summary
  );

  // ---- 4. Tasks + subtasks ----
  const tasks = await rows<Record<string, unknown>[]>(`SELECT * FROM "Task" ORDER BY "createdAt"`);
  const subtasks = await rows<Record<string, unknown>[]>(`SELECT * FROM "Subtask" ORDER BY "position"`);
  const subsByTask = new Map<string, { id: string; data: Record<string, unknown> }[]>();
  for (const s of subtasks as unknown as Record<string, unknown>[]) {
    const arr = subsByTask.get(s.taskId as string) ?? [];
    arr.push({ id: s.id as string, data: { title: s.title, done: s.done, position: s.position, createdAt: T(s.createdAt) } });
    subsByTask.set(s.taskId as string, arr);
  }
  await writeBatch(
    "tasks",
    (tasks as unknown as Record<string, unknown>[]).map((t) => ({
      id: t.id as string,
      data: {
        workspaceId: "ationic", projectId: t.projectId, title: t.title, description: t.description ?? null,
        status: t.status, priority: t.priority, assigneeId: uid(t.assigneeId as string),
        creatorId: uid(t.creatorId as string), startDate: T(t.startDate), dueDate: T(t.dueDate),
        labels: (t.labels as string[]) ?? [], completedAt: T(t.completedAt),
        createdAt: T(t.createdAt), updatedAt: T(t.updatedAt),
      },
      sub: [{ name: "subtasks", docs: subsByTask.get(t.id as string) ?? [] }],
    })),
    summary
  );

  // ---- 5. Bugs (keep BUG-XXXX codes; seed the counter past the max) ----
  const bugs = await rows<Record<string, unknown>[]>(`SELECT * FROM "Bug" ORDER BY "createdAt"`);
  let maxCode = 0;
  await writeBatch(
    "bugs",
    (bugs as unknown as Record<string, unknown>[]).map((b) => {
      const n = parseInt(String(b.bugCode).replace(/\D/g, ""), 10);
      if (!Number.isNaN(n) && n > maxCode) maxCode = n;
      return {
        id: b.id as string,
        data: {
          workspaceId: "ationic", projectId: b.projectId, bugCode: b.bugCode, title: b.title,
          websiteUrl: b.websiteUrl ?? null, description: b.description, steps: b.steps ?? null,
          expected: b.expected ?? null, actual: b.actual ?? null, pageRoute: b.pageRoute ?? null,
          device: b.device ?? null, viewport: b.viewport ?? null, severity: b.severity, priority: b.priority,
          assigneeId: uid(b.assigneeId as string), reporterId: uid(b.reporterId as string), status: b.status,
          targetFixDate: T(b.targetFixDate), resolutionNotes: b.resolutionNotes ?? null,
          reportedAt: T(b.reportedAt), createdAt: T(b.createdAt), updatedAt: T(b.updatedAt),
        },
      };
    }),
    summary
  );
  if (!DRY_RUN) await db.collection("counters").doc("bugs").set({ next: maxCode }, { merge: true });
  console.log(`bugs counter seeded at next=${maxCode}`);

  // ---- 6. Comments / labels / notifications / activities / attachments ----
  const comments = await rows<Record<string, unknown>[]>(`SELECT * FROM "Comment" ORDER BY "createdAt"`);
  await writeBatch(
    "comments",
    (comments as unknown as Record<string, unknown>[]).map((c) => ({
      id: c.id as string,
      data: {
        workspaceId: "ationic", projectId: (c.projectId as string) ?? null, taskId: (c.taskId as string) ?? null,
        bugId: (c.bugId as string) ?? null, authorId: uid(c.authorId as string), body: c.body,
        createdAt: T(c.createdAt), updatedAt: T(c.updatedAt),
      },
    })),
    summary
  );

  const labels = await rows<{ id: string; name: string; color: string }>(`SELECT id, name, color FROM "Label"`);
  await writeBatch("labels", labels.map((l) => ({ id: l.id, data: { name: l.name, color: l.color } })), summary);

  const notifs = await rows<Record<string, unknown>[]>(`SELECT * FROM "Notification" ORDER BY "createdAt"`);
  await writeBatch(
    "notifications",
    (notifs as unknown as Record<string, unknown>[]).map((n) => ({
      id: n.id as string,
      data: {
        userId: uid(n.userId as string), type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null,
        readAt: T(n.readAt), createdAt: T(n.createdAt),
      },
    })),
    summary
  );

  const acts = await rows<Record<string, unknown>[]>(`SELECT * FROM "ActivityLog" ORDER BY "createdAt"`);
  await writeBatch(
    "activities",
    (acts as unknown as Record<string, unknown>[]).map((a) => ({
      id: a.id as string,
      data: {
        workspaceId: "ationic", projectId: (a.projectId as string) ?? null, taskId: (a.taskId as string) ?? null,
        bugId: (a.bugId as string) ?? null, actorId: uid(a.actorId as string),
        action: a.action, details: (a.details as Record<string, unknown>) ?? null, createdAt: T(a.createdAt),
      },
    })),
    summary
  );

  const atts = await rows<Record<string, unknown>[]>(`SELECT * FROM "Attachment"`);
  await writeBatch(
    "attachments",
    (atts as unknown as Record<string, unknown>[]).map((a) => ({
      id: a.id as string,
      data: {
        workspaceId: "ationic", projectId: (a.projectId as string) ?? null, taskId: (a.taskId as string) ?? null,
        bugId: (a.bugId as string) ?? null, uploadedById: uid(a.uploadedById as string),
        fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, storagePath: a.storagePath,
        createdAt: T(a.createdAt),
      },
    })),
    summary
  );
  if (atts.length) console.log(`NOTE: ${atts.length} attachment FILES must be copied to Firebase Storage manually; only metadata migrated.`);

  console.log(DRY_RUN ? "DRY-RUN plan (nothing written):" : "Migration complete:");
  console.log(JSON.stringify(summary, null, 2));
  await pg.end();
}

main().catch((e) => {
  console.error("Migration failed:", (e as Error).message);
  process.exit(1);
});
