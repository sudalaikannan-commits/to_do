import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { get, post, patch, del } from "../lib/api";
import { fmtDate, fmtDateTime, isOverdue } from "../lib/utils";
import { EmptyState, Field, Modal, PriorityBadge, SkeletonList, StatusBadge, Confirm } from "../components/ui";

interface TaskRow {
  id: string; title: string; status: string; priority: string; dueDate?: string | null;
  project: { id: string; name: string }; assignee?: { id: string; name: string } | null;
}

export function TaskList({ notify, mine }: { notify: (m: string) => void; mine?: boolean }) {
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") ?? "";
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ projectId: "", title: "", assigneeId: "", priority: "MEDIUM", dueDate: "" });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (mine) params.set("assigneeId", "me");
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (view) params.set("view", view);
      const d = await get<{ tasks: TaskRow[] }>(`/api/tasks?${params}`);
      setTasks(d.tasks);
      if (!projects.length) {
        const p = await get<{ projects: { id: string; name: string }[] }>("/api/projects");
        setProjects(p.projects);
        if (!form.projectId && p.projects.length) setForm((f) => ({ ...f, projectId: p.projects[0].id }));
        const u = await get<{ users: { id: string; name: string }[] }>("/api/auth/users");
        setUsers(u.users);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, status, mine]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/api/tasks", {
        projectId: form.projectId, title: form.title, status: "NOT_STARTED",
        priority: form.priority, assigneeId: form.assigneeId || null, labels: [],
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      setOpen(false);
      setForm({ projectId: form.projectId, title: "", assigneeId: "", priority: "MEDIUM", dueDate: "" });
      notify("Task created");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not create task");
    }
  }

  const title = mine ? "My Tasks" : view === "overdue" ? "Overdue Tasks" : view === "completed" ? "Recently Completed" : "All Tasks";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <button className="btn-primary ml-auto" onClick={() => setOpen(true)}>+ New task</button>
      </div>
      <div className="card flex flex-wrap gap-2 p-3">
        <input className="input max-w-xs" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} aria-label="Search tasks" />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {["NOT_STARTED","IN_PROGRESS","BLOCKED","IN_REVIEW","COMPLETED","CANCELLED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <button className="btn-ghost" onClick={() => { setQ(""); setStatus(""); setTimeout(load, 0); }}>Clear</button>
      </div>
      {loading ? <SkeletonList /> : tasks.length === 0 ? (
        <EmptyState title="No tasks found" hint="Try clearing filters, or create a new task." action={<button className="btn-primary" onClick={() => setOpen(true)}>Create task</button>} />
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Link to={`/tasks/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>
                <div className="truncate text-xs text-neutral-500">
                  {t.project.name} · {t.assignee?.name ?? "Unassigned"} · due {fmtDate(t.dueDate)}{" "}
                  {isOverdue(t.dueDate, t.status) && <span className="font-bold text-red-600">· Overdue</span>}
                </div>
              </div>
              <PriorityBadge priority={t.priority} />
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New task">
        <form onSubmit={create} className="space-y-3">
          <Field label="Project">
            <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee">
              <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {["URGENT","HIGH","MEDIUM","LOW"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Due date"><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <button className="btn-primary w-full">Create task</button>
        </form>
      </Modal>
    </div>
  );
}

interface TaskDetailData {
  id: string; title: string; description?: string | null; status: string; priority: string;
  dueDate?: string | null; startDate?: string | null; labels: string[];
  project: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
  creator: { name: string };
  subtasks: { id: string; title: string; done: boolean }[];
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
}

export function TaskDetail({ notify }: { notify: (m: string) => void }) {
  const { id } = useParams();
  const [t, setT] = useState<TaskDetailData | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [comment, setComment] = useState("");
  const [sub, setSub] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [desc, setDesc] = useState("");

  async function load() {
    if (!id) return;
    const d = await get<{ task: TaskDetailData }>(`/api/tasks/${id}`);
    setT(d.task);
    setDesc(d.task.description ?? "");
    const u = await get<{ users: { id: string; name: string }[] }>("/api/auth/users");
    setUsers(u.users);
  }

  useEffect(() => {
    load().catch((e) => notify(e instanceof Error ? e.message : "Failed to load task"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function update(body: unknown) {
    try {
      await patch(`/api/tasks/${id}`, body);
      notify("Task updated");
      void load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Update failed");
    }
  }

  if (!t) return <SkeletonList />;
  const doneCount = t.subtasks.filter((s) => s.done).length;

  return (
    <div className="space-y-4">
      <Link to="/tasks" className="text-sm text-neutral-500 hover:underline">← All tasks</Link>
      <div className="card p-5">
        <h1 className="text-xl font-extrabold">{t.title}</h1>
        <p className="text-sm text-neutral-500">Project: <Link className="underline" to={`/projects/${t.project.id}`}>{t.project.name}</Link> · Created by {t.creator.name}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="input max-w-[190px]" value={t.status} onChange={(e) => update({ status: e.target.value })} aria-label="Task status">
            {["NOT_STARTED","IN_PROGRESS","BLOCKED","IN_REVIEW","COMPLETED","CANCELLED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <select className="input max-w-[150px]" value={t.priority} onChange={(e) => update({ priority: e.target.value })} aria-label="Task priority">
            {["URGENT","HIGH","MEDIUM","LOW"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="input max-w-[190px]" value={t.assignee?.id ?? ""} onChange={(e) => update({ assigneeId: e.target.value || null })} aria-label="Task assignee">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-ghost ml-auto !text-red-600" onClick={() => setDelOpen(true)}>Delete</button>
        </div>
        <div className="mt-4">
          <label className="label" htmlFor="desc">Description</label>
          <textarea id="desc" className="input" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => { if (desc !== (t.description ?? "")) update({ description: desc || null }); }} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="due">Due date</label>
            <input id="due" type="date" className="input" value={t.dueDate ? t.dueDate.slice(0, 10) : ""} onChange={(e) => update({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </div>
          <div className="text-sm text-neutral-500 self-end">Checklist: {doneCount}/{t.subtasks.length} done</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-bold">Checklist</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!sub.trim()) return;
              await post(`/api/tasks/${id}/subtasks`, { title: sub });
              setSub("");
              void load();
            }}
          >
            <input className="input" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a subtask…" aria-label="Add subtask" />
            <button className="btn-primary shrink-0">Add</button>
          </form>
          <ul className="mt-3 space-y-1.5">
            {t.subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 p-2 text-sm">
                <input
                  type="checkbox" checked={s.done} aria-label={`Mark ${s.title} done`}
                  onChange={async (e) => {
                    await patch(`/api/tasks/${id}/subtasks/${s.id}`, { done: e.target.checked });
                    void load();
                  }}
                />
                <span className={s.done ? "line-through text-neutral-400" : ""}>{s.title}</span>
              </li>
            ))}
            {t.subtasks.length === 0 && <li className="text-sm text-neutral-500">No subtasks yet.</li>}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="font-bold">Comments</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              await post("/api/comments", { body: comment, taskId: id });
              setComment("");
              notify("Comment added");
              void load();
            }}
          >
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write an update…" aria-label="Add comment" />
            <button className="btn-primary shrink-0">Post</button>
          </form>
          <ul className="mt-3 space-y-2">
            {t.comments.map((c) => (
              <li key={c.id} className="rounded-xl bg-neutral-50 p-2.5 text-sm">
                <span className="font-semibold">{c.author.name}</span> <span className="text-xs text-neutral-400">{fmtDateTime(c.createdAt)}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
            {t.comments.length === 0 && <li className="text-sm text-neutral-500">No comments yet.</li>}
          </ul>
        </section>
      </div>

      <Confirm
        open={delOpen} onClose={() => setDelOpen(false)} title="Delete task?"
        body="This permanently deletes the task and its checklist and comments."
        onConfirm={async () => {
          await del(`/api/tasks/${id}`);
          window.location.href = "/tasks";
        }}
      />
    </div>
  );
}
