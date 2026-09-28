# Turjuman v2 — Quran Memorization Center Management System

> Note: general-purpose instructions (token savings, frontend efficiency) live in the global `~/.codex/AGENTS.md` and are loaded automatically alongside this file. This file holds only what is specific to this project.

## Start here (mandatory every session)
1. Read `progress.md` first to know what's done, what changed, what's left, and the next step.
2. Read `docs/requirements.md` when working on any feature (the owner's decisions — the final reference).
3. Read `docs/architecture.md` when touching the database, permissions, or sync.
4. Before ending any session, update `progress.md` (what was done, what changed, decisions, pending issues, next step). Don't end the session without it.

## What this project is
A complete rebuild of the "Turjuman Al-Quran" system (Arabic RTL, mobile-first, PWA, works offline). The site is effectively for one center (Ubayy ibn Ka'b center); the frontend is single-center, while the server stays structurally multi-center to preserve the isolation rule below.
The owner speaks Arabic; address him in Arabic. Code and identifiers are in English, UI text is in Arabic.

## Tech stack
- **Frontend**: Vite + React 19 + TypeScript + React Router + plain CSS with custom properties (RTL, mobile-first). PWA via `vite-plugin-pwa`.
- **Server**: Cloudflare Worker with Hono + D1 database (SQLite) — real relational tables (no JSON blobs). Validation with zod.
- **Hosting**: a single Worker serves the built frontend (`dist/`) and the `/api/*` interface.
- **Auth**: JWT (HS256) in an `HttpOnly; Secure; SameSite=Strict` cookie, passwords hashed with PBKDF2 (never read, logged, or returned; only reset).
- **Tests**: Vitest. Write a test for every calculation (Quran, grades) and every permission rule.

## Commands
```bash
npm install
npm run db:migrate:local   # applies migrations/ to local D1
npm run db:seed:local      # local test data (two centers + accounts)
npm run dev                # server on :8787 and frontend on :5173 (proxy to /api)
npm run typecheck
npm test                    # unit (Vitest)
npm run test:api           # integration (7 phases): requires wrangler dev and a clean local DB
npm run build
npm run deploy             # builds itself; apply migrations before it: wrangler d1 migrations apply turjuman-v2-db --remote
```
Before deploying: `npx wrangler whoami` must be zaid.mosque@gmail.com. Integration tests are not idempotent: reset `.wrangler/state/v3/d1` then run `db:migrate:local` and `db:seed:local` before every full run. Leftover `wrangler dev` processes hold the port — kill them by command line, not by image name.

## Folder structure
- `worker/` the server (Hono): `index.ts`, `routes/`, `lib/` (auth, crypto, quran, db).
- `src/` the frontend: `pages/`, `components/`, `lib/` (api, auth, quran), `styles/`.
- `migrations/` numbered D1 migrations (never edit an applied migration; add a new one).
- `docs/` requirements and architecture. `scripts/` local tools.

## Rules that must not be broken
1. **Center isolation**: every query includes `center_id` from the session, never from the request body.
2. **Permissions live on the server**, not just the frontend. Any new route goes through `requireAuth(roles)` plus an ownership check (a teacher for their own circle only, a student for themselves only).
3. **Passwords**: never stored in plaintext, never logged, never returned in any response.
4. **Secrets** (`JWT_SECRET`, `ADMIN_BOOTSTRAP_KEY`) via `wrangler secret`/`--var` locally; no default values in code and never committed to git.
5. **The UI is Arabic RTL** using logical properties (`margin-inline`, `padding-inline`), designed mobile-first for a 360px width.
6. **No `alert/prompt/confirm` windows** — use the dialog component.
7. **Quran calculations** live in a pure, tested module that supports per-student memorization direction (descending: An-Nas → Al-Fatiha, ascending: Al-Fatiha → An-Nas). The Medina mushaf's 604-page table is in `shared/quran-data.ts`.
8. **Accounts are for the guardian only**: standalone student accounts were removed. The guardian is an entity independent of the account (`guardians` table, its own `id`, nullable `user_id`). Relationship 1:M: `students.guardian_id` → `guardians.id`. The login account is stored with role `student`, and the effective `guardian` role is derived in `worker/lib/auth.ts`, carrying `auth.guardianId`. Any ownership check for a guardian compares `students.guardian_id` to `auth.guardianId`, never `auth.userId`.
9. **Derived roles**: the `CHECK` constraint on `users.role` in D1 must not be extended. `guardian` and `stage_manager` are derived from a stored role (`STORED_ROLE`) in `loadAuth`. Use the functions in `worker/lib/access.ts` (`studentScope`, `circleScope`, `stageTeacherScope`, `assertStageCircle`) for scope checks — don't write the condition by hand. Out of scope = 404, not 403.
10. Don't implement a feature that is excluded or deferred in `docs/requirements.md` without the owner's request.
11. Don't commit or push unless the owner asks.

## Work habits
- Build in small, runnable stages, test them for real (tests + running the UI) before declaring something done.
- When a requirement is ambiguous, check `docs/requirements.md` first, then ask the owner one clear question.
