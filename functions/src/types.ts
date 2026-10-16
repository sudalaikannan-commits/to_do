// Firestore document shapes for the Ationic workspace.
// Design: top-level collections for cross-project query patterns (my tasks,
// global bugs, search); subcollections only where strictly parent-scoped
// (subtasks, workspace members). Timestamps stored as Firestore Timestamps,
// serialized to ISO strings at the API boundary.

export type Role = "ADMIN" | "MEMBER";

export interface UserDoc {
  email: string;
  name: string;
  role: Role;
  avatarUrl?: string | null;
  mustResetPassword?: boolean;
  migratedAt?: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface WorkspaceDoc {
  name: string;
  slug: string;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface WorkspaceMemberDoc {
  role: Role;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface ProjectDoc {
  workspaceId: string;
  name: string;
  clientName?: string | null;
  description?: string | null;
  category: string;
  status: string;
  priority: string;
  startDate?: FirebaseFirestore.Timestamp | null;
  dueDate?: FirebaseFirestore.Timestamp | null;
  ownerId: string;
  createdById: string;
  memberIds: string[];
  tags: string[];
  links?: Record<string, string> | null;
  notes?: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface TaskDoc {
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assigneeId?: string | null;
  creatorId: string;
  startDate?: FirebaseFirestore.Timestamp | null;
  dueDate?: FirebaseFirestore.Timestamp | null;
  labels: string[];
  completedAt?: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface SubtaskDoc {
  title: string;
  done: boolean;
  position: number;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface BugDoc {
  workspaceId: string;
  projectId: string;
  bugCode: string;
  title: string;
  websiteUrl?: string | null;
  description: string;
  steps?: string | null;
  expected?: string | null;
  actual?: string | null;
  pageRoute?: string | null;
  device?: string | null;
  viewport?: string | null;
  severity: string;
  priority: string;
  assigneeId?: string | null;
  reporterId: string;
  status: string;
  targetFixDate?: FirebaseFirestore.Timestamp | null;
  resolutionNotes?: string | null;
  reportedAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface CommentDoc {
  workspaceId: string;
  projectId?: string | null;
  taskId?: string | null;
  bugId?: string | null;
  authorId: string;
  body: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface NotificationDoc {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface ActivityDoc {
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  bugId?: string | null;
  actorId?: string | null;
  action: string;
  details?: Record<string, unknown> | null;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface LabelDoc {
  name: string;
  color: string;
}

export interface AttachmentDoc {
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  bugId?: string | null;
  uploadedById: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: FirebaseFirestore.Timestamp;
}
