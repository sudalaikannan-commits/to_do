import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { initials } from "../lib/utils";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/projects", label: "Projects" },
  { to: "/board", label: "Kanban" },
  { to: "/tasks", label: "All Tasks" },
  { to: "/my-tasks", label: "My Tasks" },
  { to: "/bugs", label: "Bugs" },
  { to: "/team", label: "Team" },
  { to: "/notifications", label: "Notifications" },
];

export default function Layout({ children, toast }: { children: ReactNode; toast: string | null }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="space-y-1" aria-label="Primary">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `block rounded-xl px-3 py-2 text-sm font-medium transition ${
              isActive ? "bg-ationic-yellow text-black" : "text-neutral-300 hover:bg-white/10 hover:text-white"
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-ink p-5 text-white lg:flex">
        <Brand />
        <div className="mt-6 flex-1">{nav}</div>
        <UserCard
          onLogout={async () => {
            await logout();
            navigate("/login");
          }}
        />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-ink p-5 text-white">
            <Brand />
            <div className="mt-6 flex-1 overflow-y-auto">{nav}</div>
            <UserCard
              onLogout={async () => {
                await logout();
                navigate("/login");
              }}
            />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <button className="btn-ghost !px-3 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button>
            <div className="font-extrabold tracking-tight lg:hidden">
              Ationic<span className="text-ationic-yellow" style={{ WebkitTextStroke: "0.5px black" }}>.</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm text-neutral-500 sm:block">{user?.email}</span>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-bold text-ationic-yellow" title={user?.name}>
                {initials(user?.name ?? "?")}
              </div>
            </div>
          </div>
          {toast && (
            <div className="border-t border-neutral-200 bg-ationic-yellow px-4 py-1.5 text-center text-xs font-semibold text-black" role="status">
              {toast}
            </div>
          )}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo.svg" alt="Ationic logo" className="h-9 w-auto rounded-lg" />
      <div>
        <div className="text-sm font-extrabold leading-tight">Ationic<span className="text-ationic-yellow">.</span></div>
        <div className="text-[11px] text-neutral-400">Agency Workspace</div>
      </div>
    </div>
  );
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth();
  return (
    <div className="mt-6 rounded-2xl bg-white/5 p-3">
      <div className="text-sm font-semibold">{user?.name}</div>
      <div className="text-xs text-neutral-400">{user?.role === "ADMIN" ? "Admin" : "Member"}</div>
      <button onClick={onLogout} className="mt-3 w-full rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
        Log out
      </button>
    </div>
  );
}
