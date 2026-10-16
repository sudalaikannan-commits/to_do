import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { RealtimeProvider } from "./lib/realtime";
import { get } from "./lib/api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Kanban from "./pages/Kanban";
import { TaskList, TaskDetail } from "./pages/Tasks";
import { BugList, BugDetail } from "./pages/Bugs";
import Team from "./pages/Team";
import Notifications from "./pages/Notifications";

function Shell() {
  const { user, loading } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unread, setUnread] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ projects: { id: string; name: string }[]; tasks: { id: string; title: string }[]; bugs: { id: string; bugCode: string; title: string }[] } | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const onSocketEvent = useCallback((event: string) => {
    // Live refresh: any workspace change bumps lists; toast the meaningful ones.
    setRefreshKey((k) => k + 1);
    if (["task:created", "task:updated", "bug:created", "bug:updated", "comment:added"].includes(event)) {
      setToast(`Live update: ${event.replace(":", " ")}`);
      window.setTimeout(() => setToast(null), 2500);
    }
    if (event === "notification:new") void fetchUnread();
  }, []);

  async function fetchUnread() {
    try {
      const d = await get<{ unreadCount: number }>("/api/notifications?unread=true");
      setUnread(d.unreadCount);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (user) void fetchUnread();
  }, [user, refreshKey]);

  useEffect(() => {
    if (!query.trim() || !user) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const d = await get<{ projects: never[]; tasks: never[]; bugs: never[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        setResults(d as never as typeof results);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, user]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-neutral-500">Loading Ationic workspace…</div>;
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <RealtimeProvider onEvent={onSocketEvent}>
      <Layout toast={toast}>
        <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
          <input
            className="input max-w-md"
            placeholder="Global search: projects, tasks, BUG-0001… (press Enter)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Global search"
          />
          <SearchResults results={results} onPick={() => { setQuery(""); setResults(null); }} />
          <Link to="/notifications" className="btn-ghost ml-auto !py-1.5 text-xs">
            🔔 Notifications {unread > 0 && <span className="ml-1 rounded-full bg-ationic-yellow px-2 py-0.5 font-bold text-black">{unread}</span>}
          </Link>
        </div>
        <Routes>
          <Route path="/" element={<Dashboard key={refreshKey} />} />
          <Route path="/projects" element={<Projects key={refreshKey} notify={notify} />} />
          <Route path="/projects/:id" element={<ProjectDetail key={refreshKey} notify={notify} />} />
          <Route path="/board" element={<Kanban notify={notify} refreshKey={refreshKey} />} />
          <Route path="/tasks" element={<TaskList key={refreshKey} notify={notify} />} />
          <Route path="/my-tasks" element={<TaskList key={refreshKey} notify={notify} mine />} />
          <Route path="/tasks/:id" element={<TaskDetail key={refreshKey} notify={notify} />} />
          <Route path="/bugs" element={<BugList key={refreshKey} notify={notify} />} />
          <Route path="/bugs/:id" element={<BugDetail key={refreshKey} notify={notify} />} />
          <Route path="/team" element={<Team notify={notify} />} />
          <Route path="/notifications" element={<Notifications notify={notify} onRead={fetchUnread} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<div className="card p-8 text-center text-sm text-neutral-500">Page not found. <Link className="underline" to="/">Go home</Link></div>} />
        </Routes>
      </Layout>
    </RealtimeProvider>
  );
}

function SearchResults({ results, onPick }: { results: { projects: { id: string; name: string }[]; tasks: { id: string; title: string }[]; bugs: { id: string; bugCode: string; title: string }[] } | null; onPick: () => void }) {
  const navigate = useNavigate();
  if (!results) return <span className="text-xs text-neutral-400">Shared workspace · live sync on</span>;
  const empty = !results.projects.length && !results.tasks.length && !results.bugs.length;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {empty && <span className="text-neutral-400">No matches.</span>}
      {results.projects.slice(0, 3).map((p) => (
        <button key={p.id} className="rounded-full bg-neutral-100 px-2.5 py-1 font-semibold hover:bg-ationic-yellow" onClick={() => { onPick(); navigate(`/projects/${p.id}`); }}>📁 {p.name}</button>
      ))}
      {results.tasks.slice(0, 3).map((t) => (
        <button key={t.id} className="rounded-full bg-neutral-100 px-2.5 py-1 font-semibold hover:bg-ationic-yellow" onClick={() => { onPick(); navigate(`/tasks/${t.id}`); }}>✓ {t.title.slice(0, 30)}</button>
      ))}
      {results.bugs.slice(0, 3).map((b) => (
        <button key={b.id} className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-ationic-yellow hover:text-black" onClick={() => { onPick(); navigate(`/bugs/${b.id}`); }}>🐞 {b.bugCode}</button>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}
