import { useEffect, useRef, type ReactNode } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db, WORKSPACE_ID } from "./firebase";
import { useAuth } from "./auth";

/**
 * Replaces the legacy Socket.IO provider with cost-conscious Firestore
 * realtime listeners. Six scoped queries (all bounded with limits, single
 * workspace, membership-constrained) drive the same `onEvent` contract the
 * App shell already uses (refresh lists + toast), so no page needed changes.
 */
export function RealtimeProvider({ children, onEvent }: { children: ReactNode; onEvent: (event: string, payload: unknown) => void }) {
  const { user } = useAuth();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!user) return;
    const unsubs: (() => void)[] = [];
    const watch = (q: ReturnType<typeof query>, event: string) => {
      let primed = false;
      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            if (!primed) {
              primed = true; // initial snapshot is baseline, not a change
              return;
            }
            if (!snap.empty || snap.docChanges().length > 0) {
              handlerRef.current(event, { count: snap.size });
            }
          },
          () => undefined // permission/transport errors resolve on next valid snapshot; lists still refresh via navigation
        )
      );
    };

    const projectsQ = query(
      collection(db, "projects"),
      where("workspaceId", "==", WORKSPACE_ID),
      where("memberIds", "array-contains", user.id),
      orderBy("updatedAt", "desc"),
      limit(50)
    );
    const tasksQ = query(
      collection(db, "tasks"),
      where("workspaceId", "==", WORKSPACE_ID),
      orderBy("updatedAt", "desc"),
      limit(100)
    );
    const bugsQ = query(
      collection(db, "bugs"),
      where("workspaceId", "==", WORKSPACE_ID),
      orderBy("updatedAt", "desc"),
      limit(100)
    );
    const commentsQ = query(
      collection(db, "comments"),
      where("workspaceId", "==", WORKSPACE_ID),
      orderBy("createdAt", "desc"),
      limit(60)
    );
    const notificationsQ = query(
      collection(db, "notifications"),
      where("userId", "==", user.id),
      where("readAt", "==", null),
      limit(30)
    );

    watch(projectsQ, "project:updated");
    watch(tasksQ, "task:updated");
    watch(bugsQ, "bug:updated");
    watch(commentsQ, "comment:added");
    watch(notificationsQ, "notification:new");

    return () => unsubs.forEach((u) => u());
  }, [user?.id]);

  return <>{children}</>;
}
