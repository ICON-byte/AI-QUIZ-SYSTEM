# Project instructions

## Scope and architecture

- This is the AI-Powered Online Quiz System, an npm workspaces monorepo.
- Stages 1–4 are authorized: authentication, manual practice, lecturer courses,
  enrollment, official assessments, private question banks and CSV import.
  Stage 5 and later require explicit approval. Do not add AI, lecture-document
  uploads, public banks, or friends challenges yet.
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
- Quiz inputs can use the scoped 256KB JSON parser; authentication remains at 16KB.
- Practice endpoints require an active student and ownership. Assessment attempts
  require active course enrollment. CHALLENGE remains inaccessible.
- Draft aggregate saves require a revision. Publishing freezes questions, options,
  and settings. Preserve the SQL triggers and partial/composite indexes in migrations.
- Keep authoring, taking, and result DTOs separate. Practice review requires a final
  attempt. Assessment review additionally requires scheduled/early/course closure.
  An assessment's summary score may be visible earlier, but no per-question review.
- Quiz advisory transaction locks serialize editing/publication/attempt allocation;
  attempt locks serialize reading, saving, expiry, and submission. Preserve lock order
  (course before quiz before attempt) and use the database clock for deadlines and grading duration.
- Autosaves use per-answer optimistic revisions and allow an identical lost-response
  retry. Never overwrite a conflicting tab's answer silently.
- Finalized attempts/answers are immutable. Retakes create new attempts; retrying
  incorrect answers creates a new draft with independent question/option IDs.
- Expiry is checked on every attempt operation, plus a bounded 15-second server sweep.
  Commit expiry before returning a save rejection; never trust client countdowns.
- Use numeric epoch from PostgreSQL for the database clock. Raw timestamptz decoding
  in the current driver can shift non-UTC session times; retain timezone regression tests.
- Only verified lecturers may manage courses/assessments/rosters/reports they own.
  Enrollment codes are 96-bit random values stored only as SHA-256 hashes; return
  plaintext only at creation/rotation and never log it. Rotation/revocation/join
  must use the same course lock and recheck the digest after locking.
- Enrollment records are retained as ACTIVE/LEFT/REMOVED. Duplicate joins are
  idempotent. Removed students need lecturer restoration. Block leaving/removal
  during active attempts, including direct database updates.
- Assessment questions, schedule and max attempts are immutable after publication.
  Only a one-way early-close timestamp may change; course archive is permanent.
  New starts require an open course/assessment and a verified active owning lecturer.
- Cap assessment deadlines by timer, closing time, early close and course archive.
  Finalize using that cutoff even if the sweep runs later. Reports include all
  finalized attempts, not only each student's best result, and retain removed users'
  historical scores. Student access still requires active enrollment.
- Share the editor, taking and result components between practice and assessments;
  do not fork autosave/grading/timing logic. Dates are accepted as ISO offsets,
  stored as UTC, and shown in the browser's local timezone.
- Banks are private to their owner, including course-associated banks. Both roles
  may author private banks; verification still protects official course operations.
  Course associations must belong to the lecturer and never grant student access.
- Question uses a four-element PostgreSQL text array and a correct-option index;
  reuse questionSchema for bank/CSV validation. QuizQuestion remains an independent
  immutable snapshot. Never link bank edits to quizzes or serialize bank answer
  keys through taking/assessment review endpoints.
- Lock course before bank when changing a course association. Bank writes lock
  bank:<id>; cross-bank operations lock bank IDs in sorted order. Question/bank
  edits use revisions. Archived banks/questions are read-only and cannot be selected.
- CSV uses csv-parse on the server, JSON transport with the existing CSRF contract,
  a 1 MiB UTF-8 content limit, 200 records, and 12 import requests/minute/IP.
  Preview writes no questions or files. Confirmation revalidates exact content and
  requires an owner/bank/content-bound, signed 15-minute token. Receipt insertion
  and valid-row creation share the bank lock/transaction for idempotent retries.
  Require explicit acknowledgement before skipping invalid rows; never silently
  discard invalid records. Escape spreadsheet formulas at any CSV export boundary.
- Bank capacity is 1,000 questions including archived records. Pagination is 20.
  Quiz selections are at most 50 questions, copied into the existing draft aggregate.
  Whole-quiz duplication creates fresh question/option IDs and no attempt history;
  assessment copies require a new schedule before publication.

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
