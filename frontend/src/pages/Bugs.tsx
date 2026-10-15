import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post, patch, del } from "../lib/api";
import { fmtDateTime } from "../lib/utils";
import { EmptyState, Field, Modal, PriorityBadge, SkeletonList, StatusBadge, Confirm } from "../components/ui";

interface BugRow {
  id: string; bugCode: string; title: string; status: string; severity: string; priority: string;
  project: { id: string; name: string }; assignee?: { id: string; name: string } | null;
}

export function BugList({ notify }: { notify: (m: string) => void }) {
  const [bugs, setBugs] = useState<BugRow[]>([]);
  const [summary, setSummary] = useState<{ byStatus: Record<string, number>; bySeverity: Record<string, number>; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ projectId: "", title: "", description: "", severity: "MODERATE", pageRoute: "", device: "" });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      const d = await get<{ bugs: BugRow[]; summary: { byStatus: Record<string, number>; bySeverity: Record<string, number>; total: number } }>(`/api/bugs?${params}`);
      setBugs(d.bugs);
      setSummary(d.summary);
      if (!projects.length) {
        const p = await get<{ projects: { id: string; name: string }[] }>("/api/projects");
        setProjects(p.projects);
        if (!form.projectId && p.projects.length) setForm((f) => ({ ...f, projectId: p.projects[0].id }));
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load bugs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, severity]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/api/bugs", {
        projectId: form.projectId, title: form.title, description: form.description || form.title,
        severity: form.severity, priority: "MEDIUM", pageRoute: form.pageRoute || null, device: form.device || null,
      });
      setOpen(false);
      setForm({ projectId: form.projectId, title: "", description: "", severity: "MODERATE", pageRoute: "", device: "" });
      notify("Bug reported");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not report bug");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Bug Tracker</h1>
        <button className="btn-primary ml-auto" onClick={() => setOpen(true)}>Report bug</button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="card p-3"><div className="text-xl font-extrabold">{summary.total}</div><div className="text-xs text-neutral-500">Total shown</div></div>
          {(["CRITICAL","MAJOR","MODERATE","MINOR"] as const).map((s) => (
            <div key={s} className="card p-3"><div className="text-xl font-extrabold">{summary.bySeverity[s] ?? 0}</div><div className="text-xs text-neutral-500">{s.toLowerCase()}</div></div>
          ))}
        </div>
      )}

      <div className="card flex flex-wrap gap-2 p-3">
        <input className="input max-w-xs" placeholder="Search title, BUG-0001…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} aria-label="Search bugs" />
        <select className="input max-w-[190px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {["REPORTED","CONFIRMED","NOT_STARTED","IN_PROGRESS","BLOCKED","FIXED","READY_FOR_TESTING","VERIFIED","REOPENED","CLOSED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select className="input max-w-[160px]" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity">
          <option value="">All severities</option>
          {["CRITICAL","MAJOR","MODERATE","MINOR"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-ghost" onClick={() => { setQ(""); setStatus(""); setSeverity(""); setTimeout(load, 0); }}>Clear</button>
      </div>

      {loading ? <SkeletonList /> : bugs.length === 0 ? (
        <EmptyState title="No bugs found" hint="A clean backlog. Report the first bug when QA finds one." action={<button className="btn-primary" onClick={() => setOpen(true)}>Report bug</button>} />
      ) : (
        <ul className="space-y-2">
          {bugs.map((b) => (
            <li key={b.id} className="card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Link to={`/bugs/${b.id}`} className="font-semibold hover:underline">{b.bugCode} · {b.title}</Link>
                <div className="truncate text-xs text-neutral-500">{b.project.name} · {b.assignee?.name ?? "Unassigned"}</div>
              </div>
              <PriorityBadge priority={b.severity} />
              <StatusBadge status={b.status} />
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Report a bug">
        <form onSubmit={create} className="space-y-3">
          <Field label="Project">
            <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} /></Field>
          <Field label="Description / steps"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {["CRITICAL","MAJOR","MODERATE","MINOR"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Page / route"><input className="input" value={form.pageRoute} onChange={(e) => setForm({ ...form, pageRoute: e.target.value })} placeholder="/pricing" /></Field>
          </div>
          <Field label="Device / browser"><input className="input" value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} /></Field>
          <button className="btn-primary w-full">Report bug</button>
        </form>
      </Modal>
    </div>
  );
}

interface BugDetailData {
  id: string; bugCode: string; title: string; description: string; steps?: string | null;
  expected?: string | null; actual?: string | null; pageRoute?: string | null; device?: string | null;
  viewport?: string | null; websiteUrl?: string | null; severity: string; priority: string; status: string;
  targetFixDate?: string | null; resolutionNotes?: string | null;
  project: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
  reporter: { name: string };
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
}

const REVIEW_TRANSITIONS = ["READY_FOR_TESTING", "VERIFIED", "REOPENED"];

export function BugDetail({ notify }: { notify: (m: string) => void }) {
  const { id } = useParams();
  const [b, setB] = useState<BugDetailData | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState("");
  const [delOpen, setDelOpen] = useState(false);

  async function load() {
    if (!id) return;
    const d = await get<{ bug: BugDetailData }>(`/api/bugs/${id}`);
    setB(d.bug);
    setNotes(d.bug.resolutionNotes ?? "");
    const u = await get<{ users: { id: string; name: string }[] }>("/api/auth/users");
    setUsers(u.users);
  }

  useEffect(() => {
    load().catch((e) => notify(e instanceof Error ? e.message : "Failed to load bug"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function update(body: unknown) {
    try {
      await patch(`/api/bugs/${id}`, body);
      notify("Bug updated");
      void load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Update failed");
    }
  }

  if (!b) return <SkeletonList />;

  return (
    <div className="space-y-4">
      <Link to="/bugs" className="text-sm text-neutral-500 hover:underline">← All bugs</Link>
      <div className="card p-5">
        <div className="text-xs font-bold text-neutral-400">{b.bugCode} · reported by {b.reporter.name}</div>
        <h1 className="mt-1 text-xl font-extrabold">{b.title}</h1>
        <p className="text-sm text-neutral-500">Project: <Link className="underline" to={`/projects/${b.project.id}`}>{b.project.name}</Link></p>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge status={b.status} />
          <PriorityBadge priority={b.severity} />
          <PriorityBadge priority={b.priority} />
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Page / route" value={b.pageRoute} />
          <Info label="Device / browser" value={b.device} />
          <Info label="Viewport" value={b.viewport} />
          <Info label="Website URL" value={b.websiteUrl} />
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <div><span className="label">Description</span><p className="whitespace-pre-wrap">{b.description}</p></div>
          {b.steps && <div><span className="label">Steps to reproduce</span><p className="whitespace-pre-wrap">{b.steps}</p></div>}
          <div className="grid gap-2 sm:grid-cols-2">
            {b.expected && <div><span className="label">Expected</span><p className="whitespace-pre-wrap">{b.expected}</p></div>}
            {b.actual && <div><span className="label">Actual</span><p className="whitespace-pre-wrap">{b.actual}</p></div>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <select className="input max-w-[220px]" value={b.status} onChange={(e) => update({ status: e.target.value })} aria-label="Bug status">
            {["REPORTED","CONFIRMED","NOT_STARTED","IN_PROGRESS","BLOCKED","FIXED","READY_FOR_TESTING","VERIFIED","REOPENED","CLOSED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <select className="input max-w-[190px]" value={b.assignee?.id ?? ""} onChange={(e) => update({ assigneeId: e.target.value || null })} aria-label="Bug assignee">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-ghost ml-auto !text-red-600" onClick={() => setDelOpen(true)}>Delete</button>
        </div>
        {b.status === "FIXED" && (
          <div className="mt-3 rounded-xl bg-yellow-50 p-3 text-sm">
            <span className="font-semibold">Reviewer action needed:</span> this bug is Fixed. Move it to{" "}
            {REVIEW_TRANSITIONS.map((s) => (
              <button key={s} className="mx-1 rounded-lg bg-ink px-2 py-0.5 text-xs font-bold text-ationic-yellow" onClick={() => update({ status: s })}>
                {s.replace(/_/g, " ")}
              </button>
            ))}
            . It is never auto-verified.
          </div>
        )}
        <div className="mt-3">
          <label className="label" htmlFor="notes">Resolution notes</label>
          <textarea id="notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (b.resolutionNotes ?? "")) update({ resolutionNotes: notes || null }); }} />
        </div>
      </div>

      <section className="card p-5">
        <h2 className="font-bold">Verification & comments</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            await post("/api/comments", { body: comment, bugId: id });
            setComment("");
            notify("Comment added");
            void load();
          }}
        >
          <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Test result, question…" aria-label="Add bug comment" />
          <button className="btn-primary shrink-0">Post</button>
        </form>
        <ul className="mt-3 space-y-2">
          {b.comments.map((c) => (
            <li key={c.id} className="rounded-xl bg-neutral-50 p-2.5 text-sm">
              <span className="font-semibold">{c.author.name}</span> <span className="text-xs text-neutral-400">{fmtDateTime(c.createdAt)}</span>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
          {b.comments.length === 0 && <li className="text-sm text-neutral-500">No comments yet.</li>}
        </ul>
      </section>

      <Confirm open={delOpen} onClose={() => setDelOpen(false)} title="Delete bug?" body="Admins only. This permanently deletes the bug report." onConfirm={async () => { await del(`/api/bugs/${id}`); window.location.href = "/bugs"; }} />
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 truncate">{value || "—"}</div>
    </div>
  );
}
