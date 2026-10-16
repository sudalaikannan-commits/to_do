# Firebase Architecture — Ationic Project Management Platform

This document is the migration plan, data design, and deployment guide for the
move from the legacy stack (`backend/`: Express + PostgreSQL/Prisma + JWT
cookies + Socket.IO) to **Firebase + Netlify**. The legacy `backend/` is
preserved untouched as the local-dev stack and as the migration source.
Nothing here has been deployed yet.

## 1. Migration plan recap (Phase 1)

**Unchanged:** all 9 frontend pages, UI components, Layout, branding, routing,
all business rules (validation, bug review gate, RBAC semantics).

**Changed (frontend):**
- `frontend/src/lib/auth.tsx` — Firebase email/password + `users/{uid}` profile + custom-claim role
- `frontend/src/lib/api.ts` — same `get/post/patch/del` interface, now sends `Authorization: Bearer <ID token>`
- `frontend/src/lib/socket.tsx` — deleted, replaced by `frontend/src/lib/realtime.tsx` (5 scoped `onSnapshot` listeners driving the existing refresh/toast contract)
- `frontend/src/App.tsx` — `SocketProvider` → `RealtimeProvider` (3 lines)
- `frontend/src/pages/Login.tsx` — bootstrap now signs in via Firebase SDK after server-side provisioning
- `frontend/package.json` — added `firebase`, removed `socket.io-client`
- `frontend/vite.config.ts` — `/api` proxies to the Functions emulator in dev
- `frontend/.env.example` — `VITE_API_URL` + `VITE_FIREBASE_*` keys

**New (`functions/`):** Express API ported 1:1 onto Firestore (`src/routes/*`),
`src/store.ts` repositories, `src/auth.ts` (ID-token verification + custom
claims), `src/validation.ts` (same Zod rules), `src/workflow.ts` (bug gate),
`src/triggers.ts` (Auth-user cleanup + Blaze-only daily digest), single HTTPS
export `api` + one Auth trigger. Same `/api/*` paths and response shapes.

**Legacy API surface preserved (52 handlers):** auth bootstrap/me/users×4 ·
projects×5 · tasks×8 (incl. subtasks×3) · bugs×5 · comments×3 ·
notifications×3 · dashboard/search/activity×3 · health.

**Socket.IO events replaced (11 → 5 listeners):**
`task:created/updated/deleted` → tasks query; `bug:*` → bugs query;
`comment:added` → comments query; `project:*` → projects query;
`notification:new` → unread-notifications query. All bounded (`limit`),
single workspace, membership-constrained.

## 2. Firestore data model

Top-level collections for cross-project query patterns; subcollections only
where strictly parent-scoped:

```
users/{uid}                 email, name, role, avatarUrl, mustResetPassword?, createdAt
workspaces/ationic           name, slug
workspaces/ationic/members/{uid}   role
projects/{pid}              workspaceId, name, clientName?, description?, category,
                            status, priority, startDate?, dueDate?, ownerId,
                            createdById, memberIds[], tags[], links{}, notes?
tasks/{tid}                 workspaceId, projectId, title, description?, status,
                            priority, assigneeId?, creatorId, dates, labels[],
                            completedAt?
tasks/{tid}/subtasks/{sid}  title, done, position
bugs/{bid}                  workspaceId, projectId, bugCode (BUG-XXXX via
                            counters/bugs transaction), title, websiteUrl?,
                            description, steps?, expected?, actual?, pageRoute?,
                            device?, viewport?, severity, priority, assigneeId?,
                            reporterId, status, targetFixDate?, resolutionNotes?
comments/{cid}              workspaceId, projectId?/taskId?/bugId? (exactly one),
                            authorId, body
notifications/{nid}         userId, type, title, body?, link?, readAt?
activities/{aid}            workspaceId, projectId?, taskId?, bugId?, actorId?,
                            action, details{}
labels/{lid}                name, color
attachments/{aid}           metadata only (fileName, mimeType, sizeBytes,
                            storagePath); bytes live in Firebase Storage
counters/bugs               { next } for atomic BUG-XXXX allocation
```

Composite indexes: `firestore.indexes.json` (19 entries covering every
equality+order query above). Deploy with `firebase deploy --only firestore`.

## 3. Auth migration

- Client: Firebase email/password (`signInWithEmailAndPassword`). No passwords
  in Firestore — ever.
- Server: `Authorization: Bearer <ID token>` → `verifyIdToken()` → load
  `users/{uid}` → attach `{id, email, role, name}`. Role is authoritative via
  the `admin: true` custom claim (set by bootstrap / createUser / setRole),
  with the user document as fallback.
- Bootstrap-first-admin preserved: `POST /api/auth/bootstrap` works only when
  zero users exist; creates the Auth user + claim + profile + membership.
- Admin-only ops (create/setRole/delete user, project & bug deletion) enforced
  in Functions. Firestore rules additionally deny all client writes except a
  tightly-scoped self-profile update and own-notification read flags.

## 4. Storage

`storage.rules`: `attachments/{projectId}/{file}` readable/writable only by
project members, ≤10 MB, images/PDF only; `avatars/{uid}/` owner-writeable
≤2 MB; everything else denied. Only metadata in Firestore.

## 5. Local development (emulators)

```bash
npm i -g firebase-tools   # once (needs Java 17+ for emulators: NOT installed here)
cd functions && npm install
firebase emulators:start  # auth :9099, functions :5001, firestore :8080, storage :9199, UI :4002
cd ../frontend && npm install && npm run dev  # /api proxied to the Functions emulator
```

## 6. Data migration (PostgreSQL → Firestore)

Script: `functions/migrate/pg-to-firestore.ts` (read-only on Postgres).
Plan: users matched **by email → new Firebase UID** (Auth users created
without passwords; `mustResetPassword: true`); all other row IDs reused as
document IDs so references stay intact; user-reference fields rewritten via
the email map; `bugCode`s kept and `counters/bugs.next` seeded past the max;
password hashes never copied; attachment binaries not moved.

```bash
cd functions
PGDATABASE_URL="postgresql://..." GOOGLE_APPLICATION_CREDENTIALS="/secure/sa.json" npm run migrate:dry
PGDATABASE_URL="postgresql://..." GOOGLE_APPLICATION_CREDENTIALS="/secure/sa.json" npm run migrate
# or target the emulator:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 PGDATABASE_URL="..." npm run migrate
```

Manual steps after auto-migration: each user sets a password via the Firebase
"forgot password" email; copy attachment files to Storage and fix
`storagePath`; verify `counters/bugs`; re-invite any users missing from Auth.

## 7. Deployment (NOT done — credentials/resources not available)

**Firebase project:** Console → create project (region `asia-south1` to match
functions) → enable Authentication (Email/Password) → create Firestore
(Native mode, same region) → enable Storage → `firebase use --add` (replace
`.firebaserc` placeholder) → `firebase deploy --only firestore,storage`
(rules+indexes) → `cd functions && npm run build` →
`firebase deploy --only functions`. Note: the scheduled `dailyDigest`
requires the Blaze plan (Cloud Scheduler); the rest works on Spark.

**Netlify:** New site from repo (or drag `frontend/dist`) with
Base directory `frontend`, Build `npm run build`, Publish `dist`,
Node 20; add all `VITE_*` env vars from `frontend/.env.example`
(`VITE_API_URL=https://asia-south1-<project>.cloudfunctions.net/api`);
HTTPS + SPA redirect + headers come from `netlify.toml`.

## 8. Environment variables

| File | Key vars |
|---|---|
| `frontend/.env` | `VITE_API_URL`, `VITE_FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID/STORAGE_BUCKET/MESSAGING_SENDER_ID/APP_ID` (public client keys) |
| `functions/.env` | `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`, migration-only `PGDATABASE_URL`, `GOOGLE_APPLICATION_CREDENTIALS`, emulator hosts |
| Never commit | service-account JSON, any private key, real passwords |

## 9. Verification status (this workspace)

- `functions`: `tsc` build, `tsc --noEmit`, vitest (bug gate, validators, progress, timestamp serialization)
- `frontend`: `tsc --noEmit`, `vite build`
- Emulator/auth/rules/realtime live tests: NOT run — Java + firebase-tools are
  unavailable in this environment, so no emulator; security-rules tests need
  the emulator. Rules ship on least-privilege + server-enforced design.
