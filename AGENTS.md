# Project instructions

## Scope and architecture

- This is the AI-Powered Online Quiz System, an npm workspaces monorepo.
- Stage 1 implements foundation and authentication only. Do not begin later stages
  without explicit user approval. Do not add quizzes, AI, uploads, or challenges
  as part of authentication work.
- Frontend: React, Vite, TypeScript, Tailwind 4 (`apps/web`).
- Backend: Node 24, Express 5, TypeScript, Prisma 7, PostgreSQL (`apps/api`).
- Keep one API and database. Avoid additional infrastructure without a concrete need.
- Add `packages/shared` only when actual shared contracts warrant it. Never share
  Prisma entities or secret-bearing backend objects with frontend code.

## Setup and verification

- See README.md for setup. Run `npm ci`, configure `apps/api/.env`, then
  `npm run db:generate` and `npm run db:deploy` before `npm run dev`.
- Use `http://localhost:5173` to match the default allowed origin. Vite proxies `/api`.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` for changes
  affecting both apps. Run `npm run test:integration` for auth/database changes.
- Integration tests must use PostgreSQL. The runner uses a temporary local cluster
  or `TEST_DATABASE_URL` targeting a database ending `_test`; each run isolates a
  random schema. Never reset or truncate a developer or production database.
- Prisma's generated client and build output are ignored. Commit migrations and
  the npm lockfile. Review SQL, including custom constraints absent from Prisma syntax.
- Commands that create migrations run in `apps/api`, or through its npm workspace.

## Backend conventions

- Routes validate requests with strict Zod schemas. Services own business rules and
  transactions. Authorization is enforced on the server, never only in React.
- Return explicit public DTOs. Do not serialize raw users, sessions, or answer keys.
- Reuse `authenticate`, `requireRole`, and `requireVerifiedLecturer` on future routes.
- Lecturer roles are self-selected; lecturer verification is operator-controlled.
  No registration request may set account status or approval fields.
- Use HttpOnly cookies, exact origin checks, custom CSRF headers, and JSON bodies for
  mutations. Do not weaken CORS/CSRF to fix a local origin mismatch.
- Check current database session/account state for every authenticated request.
- Refresh sessions rotate within an absolute expiry. Logout/replay revoke families.
  Keep family-root locking consistent across session mutations. Do not throw inside
  a transaction if doing so would roll back required security revocation.
- Use bcrypt with byte-length validation; never silently truncate passwords.
- Audit lecturer decisions transactionally. The CLI's authority comes from restricted
  shell/database access, not a public admin endpoint or an operator-provided name.
- Never log request bodies, passwords, tokens, environment contents, or raw database
  error objects. Use sanitized errors and request IDs.
- Single-process in-memory rate limits are intentional for Stage 1. Revisit before
  deploying multiple API instances.

## Frontend conventions

- Organize by feature; keep reusable components small and semantic.
- React Router owns navigation; TanStack Query owns server session state. Do not
  copy server data into unnecessary local state or effects.
- Keep auth tokens out of localStorage/sessionStorage and frontend environment values.
- Reuse API refresh handling and preserve retryable connection-error states.
- Use the existing Instrument Sans typography, sage/neutral surfaces, spacing tokens,
  restrained status colors, and consistent form controls. No gradients or fabricated
  statistics. Empty states must reflect actual available functionality.
- Support keyboard access, visible focus, labeled inputs, accessible errors,
  reduced motion, and phone layouts. Never add dead navigation for unbuilt features.
- Tests should verify meaningful behavior and security boundaries rather than mirror
  implementation. Use component tests for auth states and PostgreSQL for concurrency.

## Secrets and changes

- Never commit `.env` files, database contents, generated credentials, or secrets.
  Only placeholder environment examples belong in Git.
- Preserve unrelated work. Keep changes scoped, maintainable, and documented.
- Do not install forced major dependency fixes blindly. Recheck lint/tests/build
  after tooling changes, including the patched minimatch override.
