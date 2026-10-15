import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post, patch } from "../lib/api";
import { fmtDateTime } from "../lib/utils";
import { EmptyState, SkeletonList } from "../components/ui";

interface N { id: string; type: string; title: string; body?: string | null; link?: string | null; readAt?: string | null; createdAt: string }

export default function Notifications({ notify, onRead }: { notify: (m: string) => void; onRead: () => void }) {
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await get<{ notifications: N[] }>("/api/notifications");
      setItems(d.notifications);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(id: string) {
    await patch(`/api/notifications/${id}/read`, {});
    onRead();
    void load();
  }

  async function readAll() {
    await post("/api/notifications/read-all", {});
    onRead();
    void load();
  }

  if (loading) return <SkeletonList />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Notifications</h1>
        <button className="btn-ghost ml-auto" onClick={readAll}>Mark all read</button>
      </div>
      {items.length === 0 ? <EmptyState title="You're all caught up" hint="Assignments, comments and review requests will appear here." /> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`card flex items-center gap-3 p-3 ${n.readAt ? "opacity-70" : "border-ationic-yellow"}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{n.title}</div>
                {n.body && <div className="truncate text-xs text-neutral-500">{n.body}</div>}
                <div className="text-[11px] text-neutral-400">{fmtDateTime(n.createdAt)} · {n.type.replace(/_/g, " ")}</div>
              </div>
              {n.link && <Link to={n.link} className="btn-ghost !px-2.5 !py-1 text-xs">Open</Link>}
              {!n.readAt && <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => markRead(n.id)}>Read</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
