import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { get, post, patch } from "../lib/api";
import { fmtDate, fmtDateTime } from "../lib/utils";
import { EmptyState, Field, Modal, PriorityBadge, SkeletonList, StatusBadge } from "../components/ui";

interface Detail {
  id: string; name: string; clientName?: string | null; description?: string | null; category: string;
  status: string; priority: string; startDate?: string | null; dueDate?: string | null; progress: number;
  owner: { id: string; name: string };
  members: { user: { id: string; name: string } }[];
  tasks: { id: string; title: string; status: string; priority: string; dueDate?: string | null; assignee?: { id: string; name: string } | null }[];
  bugs: { id: string; bugCode: string; title: string; status: string; severity: string; assignee?: { name: string } | null }[];
  activities: { id: string; action: string; createdAt: string; actor?: { name: string } | null }[];
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
}

export default function ProjectDetail({ notify }: { notify: (m: string) => void }) {
  const { id } = useParams();
  const [p, setP] = useState<Detail | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", assigneeId: "", dueDate: "", priority: "MEDIUM" });
  const [bugForm, setBugForm] = useState({ title: "", description: "", severity: "MODERATE", priority: "MEDIUM", pageRoute: "", device: "" });

  async function load() {
    if (!id) return;
    try {
      const d = await get<{ project: Detail }>(`/api/projects/${id}`);
      setP(d.project);
      const u = await get<{ users: { id: string; name: string }[] }>("/api/auth/users");
      setUsers(u.users);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load project");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/api/tasks", {
        projectId: id, title: taskForm.title, description: null, status: "NOT_STARTED",
        priority: taskForm.priority, assigneeId: taskForm.assigneeId || null, labels: [],
        dueDate: taskForm.dueDate ? new Date(taskForm.dueDate).toISOString() : null,
      });
      setTaskOpen(false);
      setTaskForm({ title: "", assigneeId: "", dueDate: "", priority: "MEDIUM" });
      notify("Task created");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not create task");
    }
  }

  async function createBug(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/api/bugs", {
        projectId: id, title: bugForm.title, description: bugForm.description || bugForm.title,
        severity: bugForm.severity, priority: bugForm.priority,
        pageRoute: bugForm.pageRoute || null, device: bugForm.device || null,
      });
      setBugOpen(false);
      setBugForm({ title: "", description: "", severity: "MODERATE", priority: "MEDIUM", pageRoute: "", device: "" });
      notify("Bug reported");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not report bug");
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      await post("/api/comments", { body: comment, projectId: id });
      setComment("");
      notify("Comment added");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not add comment");
    }
  }

  if (!p) return <SkeletonList />;
  return (
    <div className="space-y-4">
      <Link to="/projects" className="text-sm text-neutral-500 hover:underline">← All projects</Link>
      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight">{p.name}</h1>
            <p className="text-sm text-neutral-500">{p.clientName ?? "No client"} · {p.category} · Owner: {p.owner.name}</p>
            {p.description && <p className="mt-2 text-sm text-neutral-700">{p.description}</p>}
          </div>
          <div className="flex gap-1.5"><StatusBadge status={p.status} /><PriorityBadge priority={p.priority} /></div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-neutral-500"><span>Progress</span><span>{p.progress}% · due {fmtDate(p.dueDate)}</span></div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full rounded-full bg-ationic-yellow" style={{ width: `${p.progress}%` }} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setTaskOpen(true)}>+ Task</button>
          <button className="btn-ghost" onClick={() => setBugOpen(true)}>Report bug</button>
          <StatusChanger id={p.id} current={p.status} onDone={load} notify={notify} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-bold">Tasks ({p.tasks.length})</h2>
          {p.tasks.length === 0 ? <p className="mt-2 text-sm text-neutral-500">No tasks yet.</p> : (
            <ul className="mt-3 space-y-2">
              {p.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                    <div className="text-xs text-neutral-500">{t.assignee?.name ?? "Unassigned"} · due {fmtDate(t.dueDate)}</div>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-bold">Bug tracker ({p.bugs.length})</h2>
          {p.bugs.length === 0 ? <p className="mt-2 text-sm text-neutral-500">No bugs reported. 🎉</p> : (
            <ul className="mt-3 space-y-2">
              {p.bugs.map((b) => (
                <li key={b.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/bugs/${b.id}`} className="font-medium hover:underline">{b.bugCode} · {b.title}</Link>
                    <div className="text-xs text-neutral-500">{b.assignee?.name ?? "Unassigned"}</div>
                  </div>
                  <div className="flex gap-1"><StatusBadge status={b.status} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-bold">Discussion</h2>
          <form onSubmit={addComment} className="mt-3 flex gap-2">
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a project update…" aria-label="Add project comment" />
            <button className="btn-primary shrink-0">Post</button>
          </form>
          <ul className="mt-3 space-y-2">
            {p.comments.map((c) => (
              <li key={c.id} className="rounded-xl bg-neutral-50 p-2.5 text-sm">
                <span className="font-semibold">{c.author.name}</span> <span className="text-xs text-neutral-400">{fmtDateTime(c.createdAt)}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
            {p.comments.length === 0 && <li className="text-sm text-neutral-500">No comments yet.</li>}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="font-bold">Activity history</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-neutral-600">
            {p.activities.map((a) => (
              <li key={a.id}><span className="font-medium text-neutral-900">{a.actor?.name ?? "System"}</span> · {a.action.replace(/_/g, " ")} · <span className="text-xs">{fmtDateTime(a.createdAt)}</span></li>
            ))}
            {p.activities.length === 0 && <EmptyState title="No activity yet" />}
          </ul>
        </section>
      </div>

      <Modal open={taskOpen} onClose={() => setTaskOpen(false)} title="New task">
        <form onSubmit={createTask} className="space-y-3">
          <Field label="Title"><input className="input" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required minLength={2} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee">
              <select className="input" value={taskForm.assigneeId} onChange={(e) => setTaskForm({ ...taskForm, assigneeId: e.target.value })}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
                {["URGENT","HIGH","MEDIUM","LOW"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Due date"><input type="date" className="input" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} /></Field>
          <button className="btn-primary w-full">Create task</button>
        </form>
      </Modal>

      <Modal open={bugOpen} onClose={() => setBugOpen(false)} title="Report a bug">
        <form onSubmit={createBug} className="space-y-3">
          <Field label="Bug title"><input className="input" value={bugForm.title} onChange={(e) => setBugForm({ ...bugForm, title: e.target.value })} required minLength={2} placeholder="e.g. Mobile nav overlaps the logo" /></Field>
          <Field label="Details / steps to reproduce"><textarea className="input" rows={3} value={bugForm.description} onChange={(e) => setBugForm({ ...bugForm, description: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select className="input" value={bugForm.severity} onChange={(e) => setBugForm({ ...bugForm, severity: e.target.value })}>
                {["CRITICAL","MAJOR","MODERATE","MINOR"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Affected page / route"><input className="input" value={bugForm.pageRoute} onChange={(e) => setBugForm({ ...bugForm, pageRoute: e.target.value })} placeholder="/about" /></Field>
          </div>
          <Field label="Device / browser"><input className="input" value={bugForm.device} onChange={(e) => setBugForm({ ...bugForm, device: e.target.value })} placeholder="iPhone 14 · Safari" /></Field>
          <button className="btn-primary w-full">Report bug</button>
        </form>
      </Modal>
    </div>
  );
}

function StatusChanger({ id, current, onDone, notify }: { id: string; current: string; onDone: () => void; notify: (m: string) => void }) {
  const [v, setV] = useState(current);
  useEffect(() => setV(current), [current]);
  return (
    <select
      className="input max-w-[180px]"
      value={v}
      aria-label="Change project status"
      onChange={async (e) => {
        const next = e.target.value;
        setV(next);
        try {
          await patch(`/api/projects/${id}`, { status: next });
          notify("Project status updated");
          onDone();
        } catch (err) {
          notify(err instanceof Error ? err.message : "Update failed");
          setV(current);
        }
      }}
    >
      {["PLANNING","NOT_STARTED","IN_PROGRESS","ON_HOLD","IN_REVIEW","COMPLETED","CANCELLED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
    </select>
  );
}
