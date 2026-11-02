# AI-Powered Online Quiz System

A React and Express application for academic assessments and personal learning.
**Stage 1 is implemented:** project foundation, student/lecturer accounts, secure
sessions, role authorization, and operator-managed lecturer verification.
Quizzes, courses, AI, uploads, and challenges are not implemented yet.

## Requirements

- Node.js 24 LTS and npm 11 or newer. `.nvmrc` records the Node major.
- PostgreSQL 17 (other supported PostgreSQL versions may work but are not verified).
- A local PostgreSQL database and a dedicated application user with schema/migration
  privileges. Do not run the app with a database superuser.

## Local setup

Run all commands from the repository root unless stated otherwise.

```powershell
npm ci
Copy-Item apps/api/.env.example apps/api/.env
```

Create an empty `ai_quiz` database and an application database user using your local
PostgreSQL administration tools. Set `DATABASE_URL` in `apps/api/.env` using those
credentials. URL-encode special characters in database passwords. Generate a JWT
secret locally and paste it into that file:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm run db:generate
npm run db:deploy
npm run dev
```

Open **http://localhost:5173**. The API listens on **http://127.0.0.1:3001**.
Use `localhost` in the browser to match the default `APP_ORIGIN`. Vite proxies `/api`
to Express; the browser uses same-origin cookies and needs no API URL or secrets.
To use `127.0.0.1:5173` instead, change `APP_ORIGIN` accordingly.

Start applications separately if preferred:

```powershell
npm run dev -w @quiz/api
npm run dev -w @quiz/web
```

The readiness endpoint is `GET /api/v1/health` and checks the database connection.
After changing the schema during development, use
`npm run db:migrate -w @quiz/api -- --name <name>`.
Use `db:deploy` to apply committed migrations without creating new ones.

## Environment variables

Only the backend requires environment configuration. `apps/api/.env` is ignored.
The server fails safely if required values are absent or invalid.

| Variable | Required/default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection URL; optional `?schema=public` |
| `JWT_SECRET` | Required, random, at least 32 characters | Access-token signing; generate independently per environment |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3001` | API port; update the Vite proxy if changed locally |
| `APP_ORIGIN` | `http://localhost:5173` | Exact browser origin, no trailing slash; HTTPS required in production |
| `ACCESS_TOKEN_MINUTES` | `10`, range 1–30 | JWT lifetime |
| `SESSION_DAYS` | `7`, range 1–30 | Absolute refresh-session lifetime; rotation does not extend it |
| `BCRYPT_ROUNDS` | `12`, range 10–14 | Password-hash work factor; integration tests use 10 |
| `TRUST_PROXY_HOPS` | `0`, range 0–3 | Exact trusted reverse-proxy hop count; never enable indiscriminately |
| `TEST_DATABASE_URL` | Optional, tests only | Dedicated PostgreSQL database with a name ending `_test` |
| `PG_BIN` | Optional, tests only | Directory containing `initdb` and `pg_ctl` if not on PATH |

No Gemini key is needed for Stage 1. Never put backend secrets in `VITE_*` variables.

## Lecturer verification

Registration accepts `STUDENT` or `LECTURER`. Every lecturer begins `PENDING`.
An unverified lecturer can sign in and view their verification state, but the API
refuses official assessment eligibility.

An authorized operator with shell and application database access runs:

```powershell
npm run lecturer:verify -- --email lecturer@example.edu --actor institution-operator --decision approve --reason "Confirmed appointment against the staff directory"
```

Use `--decision reject` to reject or withdraw approval. The command accepts only an
active lecturer account and writes the decision and audit event in one transaction.
The actor is an operator-supplied identifier, not proof of identity: OS/deployment
and database permissions are the administrative security boundary. Restrict access
to the command and database credentials to designated operators. There is no public
verification endpoint and no administrator account or dashboard.

Permission checks read current database state, so changes apply to existing
sessions immediately. Lecturers can refresh their verification page to see updates.

## Authentication and security

- Passwords use bcrypt. Registration requires 12 characters and at most 72 UTF-8
  bytes to avoid bcrypt truncation. Emails are trimmed, normalized, and unique.
- Short-lived HS256 JWTs and opaque refresh tokens use HttpOnly, SameSite=Lax
  cookies. Production cookies are Secure. No tokens are returned in JSON or stored
  in browser local/session storage.
- Refresh tokens are stored only as SHA-256 hashes. Rotation preserves absolute
  expiry; reuse revokes the complete session family. Rotation and logout serialize
  on a shared database row to prevent concurrent requests leaving a live session.
- Every authenticated request checks the session and account in PostgreSQL.
  Logout immediately revokes the current family, including copied access cookies.
- State-changing requests require the exact `Origin`, `X-CSRF-Protection: 1`, and
  JSON content type. Cross-site Fetch Metadata is rejected. No permissive CORS.
- Helmet, bounded JSON bodies, strict schemas, rate limits, safe errors, and
  non-cacheable API responses are enabled. Unknown account and bad-password login
  failures use the same response.
- Login and registration share a 20-request/15-minute/IP limit; all API requests
  have a 120-request/minute/IP limit. These in-memory limits assume a single API
  instance. A shared limiter is required before horizontal scaling.
- Separate tabs refreshing the same token concurrently can trigger conservative
  replay revocation and require another sign-in. Within one tab, refresh is coalesced.

## Architecture

```text
apps/
  api/
    prisma/             Schema and committed SQL migrations
    src/
      commands/         Operator-only administrative commands
      config/           Validated backend configuration
      infrastructure/   Prisma/PostgreSQL adapter
      middleware/       Safe API errors
      modules/auth/     Validation, sessions, JWTs, authorization, routes
      modules/users/    Audited lecturer-verification service
      types/            Express request context
    test/               Unit and real PostgreSQL integration tests
  web/
    src/
      app/              Routes, authenticated workspace, navigation
      components/       Shared presentation components
      features/         Authentication, account, verification, dashboards
      lib/              API client and browser-safe contracts
      test/             Component and session-client tests
scripts/                Isolated PostgreSQL test runner
```

`packages/shared` is reserved for contracts that need reuse; no shared package is
necessary yet. Prisma entities and private credentials never enter browser code.
Prisma 7 uses `prisma.config.ts` and the PostgreSQL driver adapter. The generated
client is ignored and regenerated before API builds/type checks.

The initial schema contains `User`, `LecturerVerification`, `RefreshSession`, and
`AuditEvent`. The migration also enforces normalized email at the database level.
Express routes validate input, invoke services, and return explicit public DTOs.
The frontend uses React Router and TanStack Query; Tailwind 4 is integrated through
the Vite plugin. Instrument Sans is bundled locally, with no external font request.

## Checks and tests

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

`npm test` runs unit and browser-component tests. PostgreSQL integration tests
are separate and never substitute SQLite or a mock for database behavior.

With PostgreSQL tools on PATH, `test:integration` creates a temporary loopback-only
cluster in ignored `.local/`, generates a unique schema, applies the real migration,
runs tests, stops PostgreSQL, and deletes its own cluster. No existing server is
modified. The temporary server uses trust authentication only on loopback; do not
use this configuration for development or production. Do not run this mode as root
on Unix; use a dedicated test database instead.

Alternatively, copy `apps/api/.env.test.example` to `apps/api/.env.test`, configure
`TEST_DATABASE_URL`, and run the same command. It uses a fresh random schema and
drops only that schema after the run. The database name must end `_test`.
The test user needs schema creation privileges. CI uses a disposable PostgreSQL 17
service and this mode. Credentials in the CI workflow are only for that temporary
service, never for a deployed database.

Coverage includes normalized/concurrent registration, password hashing and input
limits, invalid credentials, CSRF, private cookies, roles, verification/auditing,
refresh rotation/replay, concurrent refresh/logout, expiry, disabled accounts,
logout, token tampering, rate limits, and frontend authentication states.

The development lint toolchain pins `minimatch` to the patched 11.x line through
an override. Recheck compatibility and advisories when upgrading lint dependencies.

## Production boundary and next stage

This is a Stage 1 foundation, not a production launch. Email verification, password
recovery, profile editing, and multi-device session management are not implemented.
Before launch, add the agreed email/recovery flow, retention cleanup for expired
session rows, backup/restore procedures, monitoring, and deployment configuration.
Do not delete session-family root rows while any member of that family is valid.

For a deployment, build both apps, apply migrations, run `npm run start -w @quiz/api`,
serve `apps/web/dist` with SPA history fallback, and reverse-proxy `/api` to Express
on the same origin. Configure TLS, HTTPS `APP_ORIGIN`, production mode, and the exact
proxy hop count. The API deliberately binds to loopback for this topology.

Stage 2 requires separate approval: manual practice quiz creation and the shared
quiz engine, including start/resume, autosave, server timing, submission, grading,
and results. Courses, assessments, question banks, AI, uploads, and challenges follow
the later approved stages.
