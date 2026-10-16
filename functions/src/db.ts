import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const auth = admin.auth();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;

export const WORKSPACE_ID = "ationic";

export const col = {
  users: () => db.collection("users"),
  workspaces: () => db.collection("workspaces"),
  members: (ws = WORKSPACE_ID) => db.collection("workspaces").doc(ws).collection("members"),
  projects: () => db.collection("projects"),
  tasks: () => db.collection("tasks"),
  subtasks: (taskId: string) => db.collection("tasks").doc(taskId).collection("subtasks"),
  bugs: () => db.collection("bugs"),
  comments: () => db.collection("comments"),
  notifications: () => db.collection("notifications"),
  activities: () => db.collection("activities"),
  labels: () => db.collection("labels"),
  attachments: () => db.collection("attachments"),
  counters: () => db.collection("counters"),
};

type TsLike = FirebaseFirestore.Timestamp | { toDate?: () => Date } | Date | string | null | undefined;

/** Serialize Firestore Timestamps (and Dates) to ISO strings for API responses. */
export function iso(v: TsLike): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  const maybe = v as { toDate?: () => Date };
  if (typeof maybe.toDate === "function") return maybe.toDate().toISOString();
  return null;
}

/** Parse an optional ISO date input into a Firestore Timestamp (or null). */
export function ts(input?: string | null): FirebaseFirestore.Timestamp | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

/** Shape a document snapshot into a JSON-safe API object with string id + ISO dates. */
export function doc<T extends Record<string, unknown>>(
  snap: FirebaseFirestore.DocumentSnapshot
): (T & { id: string }) | null {
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const out: Record<string, unknown> = { id: snap.id };
  for (const [k, v] of Object.entries(data)) {
    out[k] = isTimestamp(v) ? iso(v) : v;
  }
  return out as T & { id: string };
}

function isTimestamp(v: unknown): v is FirebaseFirestore.Timestamp {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { toDate?: unknown }).toDate === "function"
  );
}
