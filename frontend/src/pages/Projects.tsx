import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post, patch, del } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EmptyState, Modal, Field, StatusBadge, PriorityBadge, SkeletonList, Confirm } from "../components/ui";

const CATEGORIES = ["Website Development","E-commerce Development","Website Maintenance","Website Bug Fixes","UI/UX Design","SEO","Social Media Marketing","Google Ads","Meta Ads","Content Creation","Branding and Graphic Design","Email Marketing","Automation","Other"];
const STATUSES = ["PLANNING","NOT_STARTED","IN_PROGRESS","ON_HOLD","IN_REVIEW","COMPLETED","CANCELLED"];

interface Project {
  id: string; name: string; clientName?: string | null; category: string; status: string; priority: string;
  dueDate?: string | null; progress: number; openBugs: number; owner: { id: string; name: string };
  _count: { tasks: number; bugs: number };
}

export default function Projects({ notify }: { notify: (m: string) => void }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", clientName: "", category: "Website Development", status: "PLANNING", priority: "MEDIUM", dueDate: "", description: "", ownerId: "" });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      const d = await get<{ projects: Project[] }>(`/api/projects?${params}`);
      setProjects(d.projects);
      const u = await get<{ users: { id: string; name: string }[] }>("/api/auth/users");
      setUsers(u.users);
      if (!form.ownerId && u.users.length) setForm((f) => ({ ...f, ownerId: user?.id ?? u.users[0].id }));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/api/projects", {
        name: form.name, clientName: form.clientName || null, category: form.category,
        status: form.status, priority: form.priority, ownerId: form.ownerId,
        memberIds: [], tags: [], description: form.description || null,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      setOpen(false);
      setForm({ name: "", clientName: "", category: "Website Development", status: "PLANNING", priority: "MEDIUM", dueDate: "", description: "", ownerId: user?.id ?? "" });
      notify("Project created");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not create project");
    }
  }

  async function remove() {
    if (!delId) return;
    try {
      await del(`/api/projects/${delId}`);
      setDelId(null);
      notify("Project deleted");
      void load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Projects</h1>
        <button className="btn-primary ml-auto" onClick={() => setOpen(true)}>+ New project</button>
      </div>

      <div className="card flex flex-wrap gap-2 p-3">
        <input className="input max-w-xs" placeholder="Search projects or clients…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} aria-label="Search projects" />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select className="input max-w-[220px]" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn-ghost" onClick={() => { setQ(""); setStatus(""); setCategory(""); setTimeout(load, 0); }}>Clear</button>
      </div>

      {loading ? <SkeletonList /> : projects.length === 0 ? (
        <EmptyState title="No projects found" hint="Create a project for a client website, campaign or retainer." action={<button className="btn-primary" onClick={() => setOpen(true)}>Create project</button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Link to={`/projects/${p.id}`} className="font-bold hover:underline">{p.name}</Link>
                  <div className="truncate text-xs text-neutral-500">{p.clientName ?? p.category} · Owner: {p.owner.name}</div>
                </div>
                {user?.role === "ADMIN" && (
                  <button className="text-xs text-red-600 hover:underline" onClick={() => setDelId(p.id)}>Delete</button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge status={p.status} />
                <PriorityBadge priority={p.priority} />
                {p.openBugs > 0 && <span className="badge bg-red-100 text-red-700">{p.openBugs} open bugs</span>}
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs text-neutral-500"><span>{p._count.tasks} tasks</span><span>{p.progress}%</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-ationic-yellow" style={{ width: `${p.progress}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <form onSubmit={create} className="space-y-3">
          <Field label="Project name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client / business"><input className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {["URGENT","HIGH","MEDIUM","LOW"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <select className="input" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <button className="btn-primary w-full">Create project</button>
        </form>
      </Modal>

      <Confirm open={!!delId} onClose={() => setDelId(null)} onConfirm={remove} title="Delete project?" body="This permanently deletes the project, its tasks and bug reports. This cannot be undone." />
    </div>
  );
}

export async function updateProject(id: string, body: unknown) {
  return patch(`/api/projects/${id}`, body);
}
