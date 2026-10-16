# Ationic Project Management Platform

> **New Firebase architecture:** Netlify frontend + Firebase Auth + Firestore +
> Cloud Functions + Storage. See **[FIREBASE.md](./FIREBASE.md)** for the full
> migration plan, data model, deployment and data-migration guides. The
> `backend/` (Express + PostgreSQL/Prisma) below is the preserved legacy
> local-dev stack and migration source — it is not deleted.

Internal agency workspace for **Ationic** (https://ationic.agency/): multiple projects, task tracking,
website bug tracking, deadlines, assignments, comments, notifications and real-time collaboration
for the two-person agency team.

Brand: near-black `#0A0A0A`, white/off-white, Ationic bright yellow `#FFD400`.
Logo: `frontend/public/logo.svg` (text-based placeholder matching ationic.agency wordmark).
**Replace it with the supplied official logo file** (same path, same aspect) before production —
do not recolor or distort the official asset.

## Stack

- Frontend: React 18 + TypeScript + Vite + Tailwind CSS + React Router + socket.io-client
- Backend: Node.js + Express (TypeScript) + Prisma + PostgreSQL + Socket.IO + Zod + JWT-in-httpOnly-cookie
- Tests: Vitest (backend unit/integration of validation + auth helpers)

## Repository layout

```
backend/            Express API + Socket.IO + Prisma schema + seed + tests
  prisma/schema.prisma
  prisma/seed.ts
  src/index.ts      app bootstrap, security middleware, rate limits
  src/routes/       auth, projects, tasks, bugs, comments, notifications, dashboard/search/activity
  src/socket.ts     authenticated realtime channels
  src/validators.ts shared Zod validation
frontend/           Ationic-branded responsive SPA
  src/pages/        Login, Dashboard, Projects, ProjectDetail, Kanban, Tasks, Bugs, Team, Notifications
  src/components/  Layout (dark sidebar), ui primitives
  src/lib/         api client, auth context, socket hook, formatting
docker-compose.yml  local PostgreSQL 16
```

## Prerequisites

- Node.js 20+ (tested with Node 24), `npm`
- PostgreSQL 16+ (or `docker compose up db` — Docker only needed for the database)

## Quick start (local)

```bash
# 1. Database — option A: Docker
docker compose up -d db
# option B: existing Postgres — create db `ationic` and set DATABASE_URL accordingly

# 2. Backend
cd backend
cp .env.example .env
# edit .env: DATABASE_URL, JWT_SECRET (32+ random chars), FRONTEND_URL, ADMIN_EMAIL/ADMIN_PASSWORD
"C:\Program Files\nodejs\npm.cmd" install
"C:\Program Files\nodejs\npm.cmd" run db:push        # creates tables from prisma/schema.prisma
"C:\Program Files\nodejs\npm.cmd" run db:seed        # provisions first ADMIN from ADMIN_EMAIL/ADMIN_PASSWORD
"C:\Program Files\nodejs\npm.cmd" run dev            # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
cp .env.example .env
"C:\Program Files\nodejs\npm.cmd" install
"C:\Program Files\nodejs\npm.cmd" run dev            # http://localhost:5173
```

> First run without a seeded admin? Open the app → **Initialise workspace** on the login screen
> (calls `POST /api/auth/bootstrap`). It works only when zero users exist.

## Environment variables

Backend (`backend/.env`, see `backend/.env.example`):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required). Never commit real values. |
| `PORT` | API port (default 4000) |
| `FRONTEND_URL` | Allowed CORS/socket origin(s), comma-separated (e.g. `https://pm.ationic.agency`) |
| `JWT_SECRET` | Session signing secret, ≥32 random chars in production |
| `JWT_EXPIRES_IN` | Session lifetime (default `7d`) |
| `COOKIE_NAME` | Session cookie name (default `ationic_token`) |
| `COOKIE_SECURE` | `true` in production (HTTPS) so cookies are `Secure; SameSite=None` |
| `ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME` | Seed-only first admin credentials |

Frontend (`frontend/.env`): `VITE_API_URL` — empty for same-origin/proxy dev; set to backend URL when hosts differ.

## Database

Tables (see `backend/prisma/schema.prisma`): `User`, `Workspace`, `Membership`, `Project`,
`ProjectMember`, `Task`, `Subtask`, `Bug`, `Comment`, `Label`, `TaskLabel`, `Attachment`
(metadata only), `Notification`, `ActivityLog`.

```bash
cd backend
npm run db:push     # dev: sync schema
npm run db:migrate  # production: versioned migrations
npm run db:seed     # create first admin
```

Backup / restore:

```bash
pg_dump "$DATABASE_URL" -Fc -f ationic-$(date +%F).dump
pg_restore -d "$DATABASE_URL" ationic-YYYY-MM-DD.dump
```

## Adding the second team member

1. Admin logs in → **Team** → **+ Add member** → name, agency email, temporary 8+ char password, role.
2. Share credentials over a secure channel; member logs in and changes password (profile change
   coming; for now admin can reset via delete/recreate or direct DB update).
3. Both members open the same deployed URL — same projects/tasks/bugs, live-synced via Socket.IO.

## Authentication & security

- bcrypt (12 rounds) password hashing; no plaintext storage.
- JWT session in `httpOnly` cookie (`Secure` + `SameSite=None` when `COOKIE_SECURE=true`); 7-day expiry; server re-validates user on each request; logout clears cookie.
- No open signup: first user via `bootstrap` (zero-users only), further users created by `ADMIN` only.
- Backend permission enforcement: admin-only project/bug deletion and user management; task deletion restricted to admin or creator; comment edit/delete restricted to author or admin.
- Zod validation on every mutating endpoint; Prisma parameterised queries (no string SQL); comments rendered as plain text (no `dangerouslySetInnerHTML`).
- Helmet headers, strict CORS allowlist with credentials, rate limits on login (50/15min) and bootstrap (10/hr).
- Secrets only via env vars; `.env` files git-ignored; generic error messages (no stack traces to clients).

## Real-time collaboration

- Socket.IO at `/socket.io`, auth via session cookie (or `auth.token`), rooms `workspace:ationic` + per-project `project:{id}`.
- Events: `task:created/updated/deleted`, `bug:created/updated/deleted`, `comment:added`,
  `project:created/updated/deleted`, `notification:new`.
- Frontend `SocketProvider` re-fetches affected lists on any event and shows a toast — no manual refresh needed.
- Status changes use optimistic UI with rollback on failure; bug `FIXED` gate enforced server-side.

## Bug workflow (enforced)

`REPORTED → CONFIRMED → NOT_STARTED → IN_PROGRESS → BLOCKED → FIXED → READY_FOR_TESTING → VERIFIED → CLOSED`
(with `REOPENED` escape). Rules: a `FIXED` bug can only move to `READY_FOR_TESTING` / `VERIFIED` /
`REOPENED` (reviewer step, never auto-verified); `VERIFIED` requires passing through `FIXED`/`READY_FOR_TESTING`.

## Tests & checks

```bash
cd backend
npm run test   # vitest: validation, bug-gate schema, password hashing, JWT round-trip
npm run lint   # tsc --noEmit
cd ../frontend
npm run build  # tsc + vite build
```

Manual QA checklist: login/logout, expired-session redirect, project CRUD, task assign/complete/reopen,
bug report → fix → ready-for-testing → verified/reopened, comments, notifications read/unread,
global search + filters, two-browser live sync, 320/375/390/768/1024/1440px layouts.

## Production deployment checklist

- [ ] Managed PostgreSQL (e.g. Neon/Supabase/RDS); set `DATABASE_URL`; run `npm run db:migrate`.
- [ ] Backend host (Render/Fly/VPS): set `NODE_ENV=production`, strong `JWT_SECRET`, `FRONTEND_URL=https://<frontend>`, `COOKIE_SECURE=true`; `npm run build && npm start`.
- [ ] Frontend host (Vercel/Netlify): `VITE_API_URL=https://<backend>`; `npm run build` → `dist/`.
- [ ] HTTPS on both; CORS origin exactly matches frontend; cookies `Secure`.
- [ ] Seed admin via env + `db:seed`, then remove/rotate `ADMIN_PASSWORD`.
- [ ] Replace `frontend/public/logo.svg` with official logo; verify at 320px–1440px.
- [ ] Schedule `pg_dump` backups; test restore once.
- [ ] **Not claimed live until both tiers share the same production database and two-login sync is verified.**

## Known limitations (honest)

- No live deployment is configured in this repo — no hosting credentials were available, so
  multi-user sync against production Postgres is implemented but **not end-to-end verified here**.
- Attachments: schema + metadata model exist; binary upload endpoints are intentionally not enabled
  (use linked URLs in notes/links until object storage + AV scanning is added).
- Password reset e-mail flow is not wired (no SMTP config supplied); admin provisions/resets accounts.
- Avatar upload, saved filter presets, calendar view and e-mail mentions are future enhancements;
  All/My/Overdue/Completed views, Kanban, global search and notifications are implemented.

## Acceptance mapping

Dashboard live stats · multi-project workspaces · task CRUD + checklist + comments ·
per-project + global bug tracker with severity/status workflow and FIXED review gate ·
Kanban drag-and-drop + list/my/all/overdue/completed views · Socket.IO live sync ·
activity log + persistent notifications · global search/filters · responsive 320px→1440px ·
PostgreSQL + Prisma migrations + seed · RBAC + hardened sessions + rate limits + tests.
