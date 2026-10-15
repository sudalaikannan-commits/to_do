import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../lib/api";
import { fmtDate, isOverdue, prettyEnum } from "../lib/utils";
import { EmptyState, SkeletonList, StatusBadge } from "../components/ui";

interface DashboardData {
  stats: { activeProjects: number; myTasks: number; inProgress: number; inReview: number; completed: number; overdue: number; openBugs: number };
  upcomingDeadlines: { id: string; title: string; dueDate: string; project: { id: string; name: string }; assignee?: { name: string } | null }[];
  recentActivity: { id: string; action: string; createdAt: string; actor?: { name: string } | null; project?: { name: string } | null }[];
  projects: { id: string; name: string; total: number; done: number; progress: number }[];
  myPriorityTasks: { id: string; title: string; dueDate?: string | null; status: string; priority: string; project: { id: string; name: string } }[];
  teamWorkload: { id: string; name: string; openTasks: number }[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const d = await get<DashboardData>("/api/dashboard");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) return <div className="card p-6 text-sm text-red-700" role="alert">{error}</div>;
  if (!data) return <SkeletonList rows={5} />;

  const cards = [
    { label: "Active projects", value: data.stats.activeProjects, link: "/projects" },
    { label: "My tasks", value: data.stats.myTasks, link: "/my-tasks" },
    { label: "In progress", value: data.stats.inProgress, link: "/board" },
    { label: "Awaiting review", value: data.stats.inReview, link: "/board" },
    { label: "Completed", value: data.stats.completed, link: "/tasks?view=completed" },
    { label: "Overdue", value: data.stats.overdue, link: "/tasks?view=overdue", alert: data.stats.overdue > 0 },
    { label: "Open bugs", value: data.stats.openBugs, link: "/bugs" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Good day 👋</h1>
          <p className="text-sm text-neutral-500">Here's what's happening across your agency workspace.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to="/projects" className="btn-primary">+ New project</Link>
          <Link to="/tasks" className="btn-ghost">+ New task</Link>
          <Link to="/bugs" className="btn-ghost">Report bug</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.link} className={`card p-4 transition hover:shadow-md ${c.alert ? "border-red-300" : ""}`}>
            <div className={`text-2xl font-extrabold ${c.alert ? "text-red-600" : ""}`}>{c.value}</div>
            <div className="text-xs font-medium text-neutral-500">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-bold">My priority tasks</h2>
          {data.myPriorityTasks.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing assigned. You're all clear. 🎉</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.myPriorityTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                    <div className="text-xs text-neutral-500">{t.project.name} · due {fmtDate(t.dueDate)} {isOverdue(t.dueDate, t.status) && <span className="font-bold text-red-600">· Overdue</span>}</div>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-bold">Upcoming deadlines</h2>
          {data.upcomingDeadlines.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No upcoming deadlines.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.upcomingDeadlines.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-neutral-500">{t.project.name} · {fmtDate(t.dueDate)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-bold">Project progress</h2>
          {data.projects.length === 0 ? (
            <EmptyState title="No projects yet" hint="Create your first client project to see progress here." action={<Link to="/projects" className="btn-primary">Create project</Link>} />
          ) : (
            <ul className="mt-3 space-y-3">
              {data.projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <div className="flex items-center justify-between text-sm">
                    <Link to={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <span className="text-xs text-neutral-500">{p.progress}% · {p.done}/{p.total}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-ationic-yellow" style={{ width: `${p.progress}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-bold">Team workload</h2>
          <ul className="mt-3 space-y-2">
            {data.teamWorkload.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-xl border border-neutral-100 p-2.5 text-sm">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-neutral-500">{m.openTasks} open tasks</span>
              </li>
            ))}
          </ul>
          <h2 className="mt-5 font-bold">Recent activity</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.recentActivity.slice(0, 8).map((a) => (
              <li key={a.id} className="text-neutral-600">
                <span className="font-medium text-neutral-900">{a.actor?.name ?? "System"}</span>{" "}
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{prettyEnum(a.action)}</span>{" "}
                {a.project && <span className="text-xs">· {a.project.name}</span>}
              </li>
            ))}
            {data.recentActivity.length === 0 && <li className="text-neutral-500">No activity yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
