import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get, patch } from "../lib/api";
import { fmtDate } from "../lib/utils";
import { PriorityBadge, SkeletonList } from "../components/ui";

const COLUMNS = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"] as const;

interface Card {
  id: string; title: string; status: string; priority: string; dueDate?: string | null;
  project: { id: string; name: string }; assignee?: { name: string } | null;
}

export default function Kanban({ notify, refreshKey }: { notify: (m: string) => void; refreshKey: number }) {
  const [tasks, setTasks] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      params.set("pageSize", "100");
      const d = await get<{ tasks: Card[] }>(`/api/tasks?${params}`);
      setTasks(d.tasks);
      if (!projects.length) {
        const p = await get<{ projects: { id: string; name: string }[] }>("/api/projects");
        setProjects(p.projects);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  const byCol = useMemo(() => {
    const m: Record<string, Card[]> = {};
    for (const c of COLUMNS) m[c] = [];
    for (const t of tasks) {
      if (m[t.status]) m[t.status].push(t);
      else m.NOT_STARTED.push(t);
    }
    return m;
  }, [tasks]);

  async function move(taskId: string, status: string) {
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await patch(`/api/tasks/${taskId}`, { status });
    } catch (e) {
      setTasks(prev); // safe rollback on failure
      notify(e instanceof Error ? e.message : "Move failed — reverted");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Kanban</h1>
        <select className="input ml-auto max-w-[220px]" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter board by project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {loading ? <SkeletonList rows={3} /> : (
        <div className="kanban-scroll flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <div
              key={col}
              className="w-64 shrink-0 rounded-2xl bg-neutral-100 p-2 sm:w-72"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId && move(dragId, col)}
            >
              <div className="flex items-center justify-between px-2 py-1 text-xs font-bold uppercase tracking-wide text-neutral-500">
                <span>{col.replace(/_/g, " ")}</span>
                <span className="rounded-full bg-white px-2 py-0.5">{byCol[col].length}</span>
              </div>
              <div className="mt-1 space-y-2">
                {byCol[col].map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab rounded-xl border border-neutral-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                  >
                    <Link to={`/tasks/${t.id}`} className="text-sm font-semibold hover:underline">{t.title}</Link>
                    <div className="mt-1 truncate text-xs text-neutral-500">{t.project.name} · {t.assignee?.name ?? "Unassigned"}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <PriorityBadge priority={t.priority} />
                      <span className="text-[11px] text-neutral-500">{fmtDate(t.dueDate)}</span>
                    </div>
                    <div className="mt-2 flex gap-1">
                      {COLUMNS.filter((c) => c !== t.status).map((c) => (
                        <button key={c} className="rounded-lg bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-ationic-yellow hover:text-black" onClick={() => move(t.id, c)} title={`Move to ${c}`}>
                          → {c.split("_")[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {byCol[col].length === 0 && <p className="px-2 py-4 text-center text-xs text-neutral-400">Drop tasks here</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-400">Drag &amp; drop works with mouse and touch-friendly quick-move buttons. Status changes are saved and synced live.</p>
    </div>
  );
}
