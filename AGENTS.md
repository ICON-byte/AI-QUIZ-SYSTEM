# Project instructions

## Scope and architecture

- This is the AI-Powered Online Quiz System, an npm workspaces monorepo.
- Stages 1–6 are authorized: authentication, manual practice, lecturer courses,
  enrollment, official assessments, private question banks, CSV import and AI generation
  from topics/reviewed PDF, DOCX and TXT material. Stage 7 requires explicit approval.
  Stage 6 adds asynchronous student challenges and private leaderboards. Do not add live multiplayer, chat, tournaments, payments, public banks, OCR or unrelated features.
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
  require active course enrollment. Challenge attempts require explicit membership, exclude the creator, and allow one lifetime attempt.
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

## AI generation and privacy

- Initial audience is university students/lecturers aged 18+ in Nigeria. Registration
  requires ageConfirmed: true and stores an eligibility timestamp, never a date of
  birth. Existing accounts keep manual functionality but must confirm before AI use.
- AI is backend-only, using the official @google/genai SDK. No implicit model or
  paid fallback. Require GEMINI_API_KEY and a GEMINI_MODEL the operator has verified
  for their project's free-tier access. Missing configuration disables AI only.
- Do not make live Gemini API calls without informing the user first. Inject mock
  providers into tests and browser harnesses; never expose a production mock-mode flag.
- Require explicit non-sensitive-material confirmation. Document generation also
  requires textReviewed: true. Warn that Google's free service may use content for
  product improvement/human review. Never log prompts, source text or raw AI errors.
- Multipart is allowed only on POST /api/v1/ai/documents/extract, with the same
  origin/CSRF checks and authentication before its bounded parser. Original files
  stay in memory, never in public storage or the database. Extract reviewed text in
  a child process with timeout/heap/size/page/ZIP-expansion limits, without secrets.
- Gemini receives only the user's topic or reviewed text, with no tools or access
  to application data. Treat source instructions as untrusted. Validate output with
  Zod, including count/options/duplicates/difficulty/explanations and source-bound
  excerpts. Document provider responses require integer IDs derived from the saved
  segment order and a short quote from that same segment. Resolve IDs to public
  labels on the backend. Compare excerpts using NFC and whitespace normalization
  only; never rewrite reviewed text, punctuation, case, hyphenation or mathematics.
  Structured JSON, valid IDs and matching excerpts do not establish factual truth.
- PostgreSQL AiGeneration holds temporary workflow payloads. AiUsageBucket counts
  actual provider calls per UTC day. AiDispatch is a singleton dispatch lease and
  pacing record. User advisory locks and the partial unique index prevent multiple
  active jobs. Claim/budget calls under ai-dispatch; never hold transactions during
  extraction, provider calls or retry waits. Expired RUNNING jobs are failed, not
  blindly replayed. Respect job deadlines and lease ownership when finishing.
- Five successful generations/user/UTC day by default; pending work reserves a
  slot. Failures release user allowance, but real calls/retries retain their project
  accounting. At most two explicit provider calls/job, SDK retries/continuation off.
  Regenerate uses a new idempotency key; reconnect retries reuse the existing one.
- Purge source input on completion/failure/deletion. Reviews expire after 24 hours;
  metadata/buckets after 30 days. Deleting review data preserves charged history.
  Cleanup runs in the always-on worker, and expired results are denied on reads.
- Acceptance reuses bank validation/ownership/capacity inside one transaction and
  stores an idempotent receipt on the job. Adding reviewed questions to a quiz uses
  its existing draft flow. Never modify published questions or the grading engine.
- Hosting needs an always-on Node process supporting child processes, adequate RAM,
  and PostgreSQL. Start the worker in server lifecycle; graceful shutdown aborts
  active calls. No Redis, microservice, provider lock-in or serverless assumptions.

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

- AI recovery shares the existing two-call budget with transient retries. Never retry
  provider quotas, credentials, unsupported models, blocked content or ambiguous
  connection failures, even if an error is incorrectly marked retryable.
- Keep AI diagnostics to safe categories/contract paths, allowlisted finish reasons
  and numeric token usage. Never persist raw provider errors or invalid values.
  Settings summaries expire after 24h and never contain document text/filenames;
  source input still clears on all terminal transitions. Do not make live Gemini
  requests during tests or debugging without explicit user approval.


## Challenge rules (Stage 6)

- Challenges use Quiz.mode CHALLENGE, immutable QuizQuestion snapshots, Challenge
  metadata, and retained ChallengeParticipant membership. No separate engine or
  leaderboard table. No public global ranks, multiplayer or social graph.
- Students create/join; creators cannot join or start ranked attempts. Joining
  does not start timing. Require membership for every attempt read/write/result.
  Return the same attempt on repeated starts, including a finalized attempt.
- Database guards require challenge attemptNumber=1; the existing unique
  (quizId,userId,attemptNumber) enforces the lifetime limit. Keep identity immutable.
- Use the quiz advisory lock for publication, join, start, save, submit and close;
  preserve course -> quiz -> attempt lock order, including SQL answer guards.
- Challenge.closesAt is optional and freezes at publication. closedAt is permanent.
  Effective deadlines are the earliest timer, schedule and manual cutoff. Grade
  saved answers at that cutoff even when finalization runs later. Closing requires
  no scheduler: request checks and the existing 15-second sweep enforce it.
- Finalization per challenge request is bounded to 100; the sweep handles remaining
  work. Leaderboards report updating and withhold rows while due attempts remain.
- Scores appear at submission; answer review requires a final own attempt and
  challenge closure. Author answer keys remain creator-only. No retake/retry-incorrect
  for challenges. Creator statistics never disclose individual answer selections.
- Rank finalized scores in PostgreSQL before pagination by score DESC and numeric
  timestamp duration in milliseconds ASC. RANK() ties use 1,1,3; deterministic row
  ordering must not become a rank tiebreaker. Never expose account IDs or emails.
- Invitations use 96-bit random codes, SHA-256 lookup hashes, and quiz-bound AES-GCM
  encryption with dedicated CHALLENGE_INVITE_KEY. Never log codes or return them in
  general DTOs. Only creators retrieve invitation plaintext. Keep the key stable.
- Invitation links put codes in URL fragments. Post-auth returns allow only the
  exact internal invitation route; enrollment always requires explicit POST.

## Public landing page (Stage 6.5)

- Stage 6.5 is authorized. `/` is public; `/dashboard` remains authenticated.
  Keep the landing page readable during session loading and API outages. Signed-in
  visitors get an Open workspace action without a forced redirect from `/`.
- Preserve the restricted invitation return path, registration eligibility and role
  checks. Workspace branding links to `/dashboard`; public/auth branding links home.
- Landing styles/tokens are scoped under the landing feature. Retain the existing
  Instrument Sans/book identity; do not retheme authenticated screens.
- Public demonstrations use explicitly labelled, authored sample data only. They
  must never call Gemini, accept private uploads, save attempts or use browser storage.
  Never imply that examples are real users, adoption statistics or verified AI output.
- Load workspace routes in a separate chunk. Keep public rendering independent of
  backend availability and preserve Suspense loading feedback for private routes.
- Verify production screenshots at desktop, tablet and phone sizes, keyboard use,
  reduced motion and all three quiz modes when changing routing. No Stage 7 work
  or automatic commits/pushes are authorized by the landing-page task.
