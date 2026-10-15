import { useEffect, useState } from "react";
import { get, post, patch, del } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EmptyState, Field, Modal, SkeletonList } from "../components/ui";

interface Member { id: string; name: string; email: string; role: "ADMIN" | "MEMBER"; createdAt: string }

export default function Team({ notify }: { notify: (m: string) => void }) {
  const { user } = useAuth();
  const [users, setUsers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "MEMBER" });

  async function load() {
    setLoading(true);
    try {
      const d = await get<{ users: Member[] }>("/api/auth/users");
      setUsers(d.users);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/api/auth/users", form);
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "MEMBER" });
      notify("Team member added");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not add member");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Team</h1>
        {user?.role === "ADMIN" && <button className="btn-primary ml-auto" onClick={() => setOpen(true)}>+ Add member</button>}
      </div>
      {loading ? <SkeletonList /> : users.length === 0 ? <EmptyState title="No team members" /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {users.map((m) => (
            <li key={m.id} className="card flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-bold text-ationic-yellow">
                {m.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{m.name} {m.id === user?.id && <span className="text-xs text-neutral-400">(you)</span>}</div>
                <div className="truncate text-xs text-neutral-500">{m.email} · {m.role}</div>
              </div>
              {user?.role === "ADMIN" && m.id !== user?.id && (
                <div className="flex gap-1">
                  <button
                    className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold hover:bg-ationic-yellow"
                    onClick={async () => {
                      await patch(`/api/auth/users/${m.id}`, { role: m.role === "ADMIN" ? "MEMBER" : "ADMIN" });
                      notify("Role updated");
                      void load();
                    }}
                  >
                    {m.role === "ADMIN" ? "Demote" : "Promote"}
                  </button>
                  <button
                    className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                    onClick={async () => {
                      if (!confirm(`Remove ${m.name} from the workspace?`)) return;
                      try {
                        await del(`/api/auth/users/${m.id}`);
                        notify("Member removed");
                        void load();
                      } catch (err) {
                        notify(err instanceof Error ? err.message : "Remove failed");
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="card p-4 text-sm text-neutral-600">
        <span className="font-semibold text-neutral-900">How to add the second team member:</span> an admin clicks
        “Add member”, creates their login (name, agency email, temporary password), and shares it securely.
        Both members then log in at the same URL and share the same projects, tasks and bugs in real time.
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add team member">
        <form onSubmit={invite} className="space-y-3">
          <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field label="Temporary password (8+ chars)"><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
          </Field>
          <button className="btn-primary w-full">Add member</button>
        </form>
      </Modal>
    </div>
  );
}
