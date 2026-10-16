import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { post } from "../lib/api";
import { Field } from "../components/ui";

export default function Login() {
  const { login, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Bootstrap mode: first-run admin creation
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [name, setName] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        // Bootstrap creates the first Firebase Auth user + ADMIN profile server-side,
        // then we sign in with the same credentials via the Firebase client SDK.
        await post("/api/auth/bootstrap", { name, email, password });
        await login(email, password);
      }
      navigate("/");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <img src="/logo.svg" alt="Ationic logo" className="h-11 w-auto" />
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight">Agency Workspace</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {mode === "login" ? "Sign in to manage projects, tasks and bugs." : "Create the first admin account for this workspace."}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "bootstrap" && (
            <Field label="Full name">
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password">
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "bootstrap" ? 8 : 1} autoComplete="current-password" />
          </Field>
          {(localError || error) && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{localError ?? error}</p>
          )}
          <button className="btn-primary w-full !py-2.5" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create admin account"}
          </button>
        </form>
        <div className="mt-5 text-center text-xs text-neutral-500">
          {mode === "login" ? (
            <span>
              First time here?{" "}
              <button className="font-semibold text-black underline" onClick={() => setMode("bootstrap")}>Initialise workspace</button>
            </span>
          ) : (
            <span>
              Already set up?{" "}
              <button className="font-semibold text-black underline" onClick={() => setMode("login")}>Back to login</button>
            </span>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-neutral-400">
          Internal tool · <Link className="underline" to="https://ationic.agency/" target="_blank" rel="noreferrer">ationic.agency</Link>
        </p>
      </div>
    </div>
  );
}
