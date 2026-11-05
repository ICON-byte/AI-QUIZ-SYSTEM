# AI-Powered Online Quiz System

A React and Express application for academic assessments and personal learning.
**Stages 1–6 are implemented:** project foundation, student/lecturer accounts,
secure sessions, role authorization, operator-managed lecturer verification,
manual personal practice, lecturer-owned courses, enrollment, official assessments,
a shared attempt engine, private question banks, and CSV import.
Stage 5 adds AI question generation from topics and reviewed PDF, DOCX and TXT text.
Stage 6 adds private, asynchronous student challenges and leaderboards.
Stage 6.5 adds the public landing page and an interactive, prepared quiz example.

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

No Gemini key is needed for manual features. Stage 5 AI configuration is optional.
Never put backend secrets in `VITE_*` variables.

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

## Personal practice (Stage 2)

After pulling these changes, stop the API, apply the additive migration, and restart:

```powershell
npm run db:generate
npm run db:deploy
npm run dev
```

No new environment variables or dependencies are required. Existing users and
authentication tables are preserved. The migration adds quiz/attempt tables and
PostgreSQL constraints/triggers. Apply it before running the updated API.

Students now have **My practice quizzes** and **Practice history** navigation.
Lecturers retain their existing workspace; Stage 2 practice routes require a student
account on both the frontend and API.

### Manually test the workflow

1. Sign in as a student at `http://localhost:5173` and open **My practice quizzes**.
2. Choose **Create a quiz**. Enter a title, optional description, and optional time
   limit in minutes (1–180; blank is untimed).
3. Add questions with four different options and one correct choice. Explanations
   are optional. You can remove or edit questions before publishing. A quiz supports
   up to 50 questions. Complete added questions before saving; an empty-question
   draft is allowed.
4. Save the draft, return to the library, and reopen it to confirm your work persists.
5. Choose **Save and publish** and confirm. Published questions and settings cannot
   be changed. A published quiz is private to its owner.
6. Read the instructions and select **Start or resume practice**. Choose an answer
   and wait for **Answer saved**. Move between questions or jump using the numbered
   question map. You can clear a saved answer.
7. Leave and reopen the quiz. Starting again resumes the same unfinished attempt
   with saved selections and the original deadline.
8. Submit and confirm. Check the percentage, correct/incorrect counts, time taken,
   correct answers, and explanations. Unanswered questions count as incorrect.
9. Retake the quiz to create a new attempt. Both results remain in **Practice history**.
10. Choose **Practise incorrect questions** to create a separate editable draft
    containing only missed or unanswered questions. Publish it when ready.
11. For timing, create a one-minute quiz and let it expire. Saved answers are graded
    automatically, including if the page is closed. Reopen to see the expired result.
12. To test recovery, temporarily set browser DevTools to offline, select an answer,
    and confirm **Answer not saved** appears. Restore connectivity and retry saving
    before navigating/submitting. Do not close the page while a selection is unsaved.

### API and data rules

All endpoints below are under `/api/v1`, use existing cookie authentication, and
require the student role. Mutations keep the existing origin/CSRF/JSON requirements.

| Endpoint | Behavior |
| --- | --- |
| `GET /quizzes?page=1` | Owner's draft/published quizzes, 20 per page |
| `POST /quizzes` | Create a practice draft with questions |
| `GET /quizzes/:id` | Private quiz instructions/metadata without answer keys |
| `GET /quizzes/:id/draft` | Owner's editable draft, including authoring answers |
| `PUT /quizzes/:id` | Replace draft details/questions with expected `revision` |
| `POST /quizzes/:id/publish` | Publish with expected `revision`; idempotent once published |
| `POST /quizzes/:id/attempts` | Start a new attempt or resume the current active one |
| `GET /attempts/:id` | Resume, check expiry, and return sanitized questions/selections |
| `PUT /attempts/:id/answers/:questionId` | Save `{selectedOptionId, revision}`; `null` clears |
| `POST /attempts/:id/submit` | Finalize stored selections exactly once |
| `GET /attempts/:id/result` | Authorized finalized grade and answer review |
| `POST /attempts/:id/retry-incorrect` | Create a separate missed-question draft |
| `GET /practice/history?page=1` | Owner's finalized practice attempts, 20 per page |

Quiz draft input is `{title, description, timeLimitSeconds, questions}`. Each question
is `{prompt, options: [string,string,string,string], correctOption: 0..3, explanation}`.
Updates add the expected quiz `revision`. Start/submit/retry mutations take `{}`.
Draft authoring necessarily includes the answers the owner enters. Once published,
authoring access is closed; taking/instruction responses never include answer keys.
Review access is granted only after that attempt has finalized.

The schema adds `Quiz`, `QuizQuestion`, `QuizQuestionOption`, `Attempt`, and
`AttemptAnswer`. Stage 4 adds separate bank models described below. PostgreSQL partial unique
indexes prevent multiple active attempts and multiple correct options. Composite
foreign keys prevent selecting another question's option or saving an answer to
another quiz. SQL triggers freeze published content and finalized attempts/answers.
Publication verifies four options and exactly one correct answer per question.

The engine is in `apps/api/src/modules/attempts/engine.ts`; mode eligibility is
centralized for PRACTICE and ASSESSMENT, and rejects CHALLENGE. It shares starting,
resumption, timing, answer persistence, grading, and idempotent finalization.
Practice has no lifetime attempt limit, but only one active attempt per user/quiz.
Concurrent starts return the same active attempt. If an old active attempt has
expired, the first start returns its finalized result; another explicit start begins
a retake. Retrying incorrect questions can be repeated to create additional drafts.

Server timing uses PostgreSQL `clock_timestamp()`. The frontend uses a monotonic
countdown synchronized on each response and checks attempt status every 15 seconds.
The API checks deadlines under the attempt lock, and a 15-second background sweep
finalizes expired attempts in batches of 100. Request-time checks still work after
server restarts or a delayed sweep. Expired duration/finalization uses the deadline,
not the later time a worker happens to process it. A wrong client clock cannot
extend the attempt or submit a client-supplied grade.

Quiz revision conflicts and conflicting answer saves return 409. Identical answer
retries after a lost success response are safe. The frontend retains failed selections
in memory, blocks navigation/submission controls, and offers retry/reload. Saved
answers survive reload; unsaved choices do not persist after closing/reloading.
The browser warns before reload or link navigation with unsaved changes. No quiz
answers or credentials are written to browser local/session storage.

PostgreSQL integration tests now include practice ownership/validation, question
editing/deletion, publication immutability, concurrent starts, autosave retries and
conflicts, save/submit races, grading, duplicate submissions, expiry, result privacy,
retakes, retry-incorrect drafts, and database constraints. `npm run test:integration`
runs Stage 1–5 suites in the isolated schema. Frontend tests cover
the editor, navigation, offline-save feedback/retry, resume, results, and history.

## Lecturer courses and official assessments (Stage 3)

Stop the development servers before updating, then run from the repository root:

```powershell
npm run db:generate
npm run db:deploy
npm run dev
```

There are no new application dependencies or environment variables. The migration
adds `Course`, `Enrollment` and enrollment states (`ACTIVE`, `LEFT`, `REMOVED`),
plus course/schedule/attempt-limit/early-close fields on `Quiz`. Existing practice
quizzes retain their mode, questions and historical results.

**Clock correction:** a raw PostgreSQL timestamptz decoding issue could shift the
Stage 2 clock under non-UTC database timezones. The clock now reads numeric epoch
milliseconds, tested in Lagos and New York. The migration normalizes existing
unfinished attempt start/expiry timestamps using the database's current timezone,
preserving timer lengths and saved choices. Finalized attempts are unchanged.
Back up a database containing real assessment data before migrations; if its
timezone changed since Stage 2, inspect the active-attempt correction before
applying. The application does not reset or truncate existing data.

### Manually test a lecturer and student workflow

1. Register a lecturer and student in separate browser profiles (or use an incognito
   window for the second account). Approve the lecturer with the existing
   `lecturer:verify` command and their actual registered email.
2. As lecturer, open **My courses → Create course**. Add a title, course code and
   optional description. Copy the generated 24-character enrollment code immediately.
   The course code (for example `BIO 201`) and enrollment code are different.
3. As student, open **My courses → Join a course** and paste the enrollment code.
   The lecturer can view enrollment in **Course roster**.
4. As lecturer, edit course details or generate/revoke its enrollment code.
   Changing the code does not remove existing students. Old codes stop working.
5. From the course, select **Create assessment**. The existing question editor now
   includes optional opening time, closing time and maximum attempts (1–10).
   A future closing time is required before publishing. Blank opening time means
   the assessment opens on publication. Dates use the device's local timezone.
6. Save and reopen a draft; edit/remove questions; then publish. Questions, grading
   settings, schedule and attempt limits become permanent. Students cannot see drafts.
7. As student, open the course's assessment details. Check availability, rules and
   previous attempts. Start/resume, answer, navigate, leave/reopen and submit using
   the shared quiz-taking interface. The server enforces all eligibility/deadline rules.
8. After submitting, confirm the score summary appears while question review is
   withheld. New attempts are possible only while open and within the published limit.
9. As lecturer, open **Results report** for enrollment/participation counts, individual
   attempt scores and timestamps, average/highest/lowest percentages and question
   correctness counts. Statistics use all finalized attempts; active attempts are
   excluded from averages. Historical attempts from removed students remain included.
10. Select **Close assessment** and confirm. Active attempts end at that cutoff,
    new starts stop, and enrolled students can view answers and explanations.
    Scheduled closure applies the same review rule automatically.
11. Test **Leave course** or **Remove student**. These are blocked during active
    attempts; finish/close them first. Removed students cannot reuse a code until
    the lecturer selects **Restore enrollment**. Students who voluntarily leave may
    rejoin with a valid code. Access to assessments/results requires active enrollment.
12. Archive the course when finished. New joins/assessment creation/starts stop,
    active attempts end at archive time, and existing records remain accessible to
    authorized enrolled students and the lecturer. Archives cannot be reopened.

The server's expiry sweep finalizes up to 100 attempts per pass. Closing/reporting
for one assessment drains its expired attempts in batches; request-time deadline
checks remain authoritative even if the sweep is delayed. Archiving acts as a
course-wide assessment cutoff and releases review for already published assessments.

### Academic API

All paths below are under `/api/v1`. Existing cookie authentication, role checks,
origin/CSRF validation, rate limits, no-store responses and safe errors apply.
Lecturer operations additionally require current approval and course ownership.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /courses` | List accessible courses / create a lecturer course |
| `GET/PUT /courses/:courseId` | Read / revision-controlled course editing |
| `POST /courses/join` | Student enrollment using `{code}` |
| `POST /courses/:courseId/enrollment-code` | Rotate and return a new code |
| `POST /courses/:courseId/revoke-code` | Disable new joins by code |
| `POST /courses/:courseId/archive` | Permanently archive without deleting records |
| `GET /courses/:courseId/roster?page=1` | Lecturer enrollment roster |
| `POST /courses/:courseId/leave` | Student leaves when no course attempt is active |
| `POST /courses/:courseId/students/:studentId/remove` | Remove an enrolled student |
| `POST /courses/:courseId/students/:studentId/restore` | Restore enrollment |
| `GET/POST /courses/:courseId/assessments` | List / create course assessments |
| `GET /courses/:courseId/assessments/:id/draft` | Lecturer draft editor payload |
| `PUT /courses/:courseId/assessments/:id` | Revision-controlled draft save |
| `POST /courses/:courseId/assessments/:id/publish` | Publish with `{revision}` |
| `POST /courses/:courseId/assessments/:id/close` | One-way early closure |
| `GET /courses/:courseId/assessments/:id/report` | Course-owner performance report |
| `GET /assessments/:id` | Enrolled student's instructions and attempt links |

Assessment start/save/resume/submit/result operations use the same `/quizzes/:id/attempts`
and `/attempts/...` endpoints as practice. Assessment results add `reviewAvailable`
and `reviewReleaseAt`; `questions` is empty until closure. Assessment attempts cannot
be copied through the personal `retry-incorrect` operation.

Course and assessment lists/rosters use 20-row pagination. Reports currently return
all attempts for a single assessment and are intended for ordinary course sizes.
The existing per-IP limits and single-process rate-limit storage remain unchanged;
review capacity before running large classes behind a shared campus IP or scaling
to multiple API instances. The pinned PostgreSQL 8 driver may emit a non-failing
concurrent-query deprecation warning from Prisma relation loading during tests.

## Production boundary and next stage

This is a Stage 5 implementation, not a production launch. Email verification, password
recovery, profile editing, and multi-device session management are not implemented.
Before launch, add the agreed email/recovery flow, retention cleanup for expired
session rows, backup/restore procedures, monitoring, and deployment configuration.
Do not delete session-family root rows while any member of that family is valid.

For a deployment, build both apps, apply migrations, run `npm run start -w @quiz/api`,
serve `apps/web/dist` with SPA history fallback, and reverse-proxy `/api` to Express
on the same origin. Configure TLS, HTTPS `APP_ORIGIN`, production mode, and the exact
proxy hop count. The API deliberately binds to loopback for this topology.

Stage 6 includes asynchronous friends challenges and private leaderboards.
Stage 7 requires separate approval. Live multiplayer, chat, tournaments, payments
and public global rankings remain outside the implementation.

## Reusable question banks and CSV import (Stage 4)

Stop development servers, install the updated lockfile, generate the Prisma client,
and apply the additive migration before restarting:

```powershell
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

There are no new environment variables. `csv-parse` is the only added runtime
dependency; the frontend uses the existing query, router and form components.

Both students and lecturers (including pending lecturers) have **Question banks**
in their navigation. Banks are private. An optional lecturer-owned course association
is organizational only and never exposes the bank to enrolled students. The frontend
course picker is available to approved lecturers with active courses. A bank associated
with an archived course must be detached before changing its metadata.

Create a bank with a title and optional description. Add questions with four distinct,
nonempty options, one correct answer, optional explanation and topic, and difficulty
EASY, MEDIUM or HARD. Question text, explanation and option lengths reuse quiz
validation. Search matches question text or topic; separate difficulty/topic filters
can be combined. Lists use 20 rows per page. Bank capacity is **1,000 questions,
including archived questions**. Create a new bank when it is full.

Questions can be edited, duplicated, archived, or moved/copied between owned active
banks. Banks can be renamed, duplicated or archived. Archiving is permanent and
read-only; it does not delete questions or affect quiz copies. Duplicating a bank
copies only its active questions and clears its course association. Revision checks
reject stale edits with 409. Cross-bank locks use sorted bank IDs.

CSV workflow:

1. Open a bank and choose **Import CSV**, then download the template.
2. Save a UTF-8, comma-separated `.csv` file with these nine headers (order may vary):
   Question, Option A, Option B, Option C, Option D, Correct Answer, Explanation,
   Difficulty, Topic. Correct Answer accepts A/B/C/D; difficulty accepts
   EASY/MEDIUM/HARD. Letter/difficulty case is normalized. Explanation and Topic
   cells may be empty; the other cells are required. Quoted commas, escaped quotes,
   multiline fields, UTF-8 BOM, LF and CRLF are supported.
3. Select the file and click **Preview CSV**. The backend validates all records and
   reports errors by logical row (the header is row 1; blank lines are ignored).
   Malformed quoting/header/size/row-limit errors reject the whole file. A field-count
   error is shown on that row. No questions are written during preview.
4. Fix invalid rows and preview again, or explicitly check **Import only valid rows**.
   Click **Confirm import** and approve the displayed count/destination.
5. The resulting notice reports imported and skipped counts. Refreshing/retrying the
   same confirmation does not duplicate questions. A new preview represents a new
   import and can intentionally import the same content again.

Limits: 1 MiB of CSV text, 200 question records, 12 preview/confirm requests per
minute/IP, a 2 MiB JSON transport body, and a 15-minute signed preview. The token is
bound to the user, destination bank and exact CSV digest; confirmation revalidates
the content and current bank ownership/archive/capacity. Import and receipt writes
share one PostgreSQL transaction. A changed file or expired token needs a new preview.
No CSV files are stored on disk or in the database; only question data and a small
import receipt are retained. The current download is a static, formula-escaped
template; there is no user-data CSV export. Use `csvCell` at any future export boundary.

All bank API paths use the authenticated `/api/v1/question-banks` prefix and the
existing JSON/origin/CSRF contract for writes:

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET / POST | `/` | List/search owned banks, or create one |
| GET / PUT | `/:bankId` | Read/update bank metadata |
| POST | `/:bankId/archive` | Archive using `{revision}` |
| POST | `/:bankId/duplicate` | Copy active questions into a new bank |
| GET / POST | `/:bankId/questions` | Filter/page questions, or add one |
| GET / PUT | `/:bankId/questions/:id` | Read/edit an owned question |
| POST | `/:bankId/questions/:id/archive` | Archive using `{revision}` |
| POST | `/:bankId/questions/:id/transfer` | `{targetBankId, action: COPY or MOVE, revision}` |
| GET | `/csv-template` | Download the static CSV template |
| POST | `/:bankId/import/preview` | Validate `{csv}` and issue a preview token |
| POST | `/:bankId/import/confirm` | `{csv, token, confirmed: true, skipInvalid}` |
| POST | `/selection` | Return copies of owned active questions selected by `{ids}` |

Question payloads extend the existing quiz question with `difficulty` and `topic`.
Question updates add `revision`; bank updates send title, description, nullable
courseId and revision. Bank/question queries accept `page`, `search`, `archived`;
question queries additionally accept `difficulty` and `topic`. Whole-quiz duplication
uses `POST /api/v1/quizzes/:id/duplicate` or the lecturer-scoped
`POST /api/v1/courses/:courseId/assessments/:id/duplicate`, both with `{}`.

**Add from question bank** is available in both practice and assessment draft editors.
Search/browse banks, select questions across banks/pages, and add up to the remaining
50-question limit. The backend rechecks ownership and active status before returning
copies. Added questions remain unsaved until **Save draft** or **Save and publish**.
They can be edited or removed in the existing editor. No live question-bank reference
is saved in a quiz, so later bank edits, moves and archives cannot affect grading or
historical results. Bank difficulty/topic organize the library; the Stage 1–3 quiz
snapshot contract remains unchanged.

**Duplicate as draft** appears on practice quiz rows and lecturer assessment rows.
It copies questions/options into fresh records and preserves the source quiz/results.
Assessment copies remain in the original owned course and require a new closing
schedule before publication. Copies have no attempts or results.

Database additions are `QuestionBank` (owner, optional course, metadata, archive,
revision), `Question` (bank, four-option PostgreSQL array, correct index, explanation,
topic, difficulty, archive, revision), `Difficulty`, and `CsvImportReceipt`. Foreign
keys, owner/course guards, question constraints and list indexes are included in
`202611040004_question_banks`. Existing quiz, attempt, result and course rows are not
rewritten by this migration. Apply migrations to your configured development database
using `db:deploy`; automated verification uses isolated databases only.

Manual regression check: create and edit a question; import the template alongside
one invalid row and explicitly skip it; duplicate and move/copy a question; select
questions into a practice quiz, publish and submit; change the bank question and
confirm the old result stays unchanged. Repeat selection in an approved lecturer's
assessment draft, publish, enroll a student, submit and verify review remains held
until closure. Check another account cannot open the private bank. Archive the bank
and confirm it disappears from active selection while prior quizzes still work.

## AI question generation (Stage 5)

Initial audience: university students and lecturers aged **18+ in Nigeria**.
Registration now requires an explicit age confirmation and stores only its timestamp,
not a date of birth. Existing accounts keep their current manual features and can
confirm eligibility on the AI page. This is self-attestation, not identity/age
verification. There is no geolocation infrastructure; international expansion
requires reviewing the provider's regional/age/privacy conditions before rollout.

Stop development servers before installing and migrating:

```powershell
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

The migration adds a nullable `User.adultConfirmedAt` and three small AI tables:
`AiGeneration` for jobs/temporary review payloads, `AiUsageBucket` for daily provider
accounting, and `AiDispatch` for a shared dispatch lease/pacing timestamp. The separate
singleton lease prevents multiple worker instances from overlapping normal dispatch
or bypassing call pacing. Existing quiz questions, attempts, grades, banks and course
records are preserved. Accepted AI content uses the existing bank Question model.

### Gemini configuration

1. Open [Google AI Studio's API keys page](https://aistudio.google.com/api-keys),
   choose/create a Google project, and create an API key. Follow any account/project
   verification Google requires. Keep the key private; do not paste it into Git,
   browser code, screenshots, or support logs.
2. In that project's AI Studio console, verify the **exact model ID**, support for
   structured text output, free-tier access, and current request/token limits.
   Google's current model/pricing documentation lists `gemini-3.5-flash-lite` with
   structured output and a free tier, but documentation does not prove access or
   remaining quota for an individual project. Check the actual project before
   choosing it. [Model details](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite),
   [pricing](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite),
   [project limits](https://aistudio.google.com/rate-limit).
3. Set `GEMINI_API_KEY` and your verified `GEMINI_MODEL` in `apps/api/.env`, then
   restart the API. Neither variable has a usable default; AI stays unavailable
   if either is blank. No other feature requires a Gemini key.
4. The application makes no startup probe or automatic paid/model fallback. The
   first deliberate generation contacts Gemini. Unavailable models, unsupported
   requests, invalid credentials and exhausted quotas fail with sanitized messages.
   A configured capability means settings exist; it is not a claim of live provider
   availability or verified billing status. Model choice does not control billing:
   verify the Google project's billing/quota configuration separately.

The implementation uses Google's maintained `@google/genai` SDK, with stateless
structured-JSON generation and local Zod validation. SDK retries and automatic
continuation are disabled; the worker owns the explicit two-call bound. There are
no web-search, code-execution, file-search, function-calling or other model tools.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | blank | Backend-only Google API key |
| `GEMINI_MODEL` | blank | Exact operator-verified model ID |
| `AI_DAILY_USER_LIMIT` | `5` | Successful generations/user/UTC day |
| `AI_DAILY_PROJECT_CALL_LIMIT` | `20` | Actual application provider calls/UTC day, including failures/retries |
| `AI_CALL_INTERVAL_SECONDS` | `30` | Minimum gap between provider-call starts |
| `AI_JOB_TIMEOUT_SECONDS` | `120` | Overall queued/running job deadline, including retry waits |
| `AI_MAX_OUTPUT_TOKENS` | `8192` | Per-call output-token bound |
| `AI_DOCUMENT_MAX_BYTES` | `5242880` | Maximum upload bytes (5 MiB) |
| `AI_DOCUMENT_MAX_CHARACTERS` | `40000` | Maximum reviewed/extracted characters |
| `AI_DOCUMENT_MAX_PAGES` | `100` | Maximum PDF pages |
| `AI_EXTRACTION_TIMEOUT_SECONDS` | `10` | Child-process extraction timeout |

App counters reset at midnight UTC (01:00 in Nigeria); the UI also shows the local
reset timestamp. Google applies its own project/model limits, and its daily reset
need not align with ours. Other applications or keys using the Google project are
outside this app's accounting. These limits bound this application's calls, not a
guaranteed provider quota, paid spending amount, or token budget across other apps.

### Generation and review workflow

- Open **Generate questions** from navigation, an active bank, or either draft quiz
  editor's **Generate with AI** control. Pending lecturers can generate private
  questions; official assessment authoring still requires lecturer verification.
- Read the privacy notice and explicitly confirm that the material is non-sensitive.
  Enter a topic, choose difficulty, and select 5, 10, 15, 20 or 30 questions.
- For documents, select a PDF, DOCX or UTF-8 TXT and choose **Extract text for review**.
  Inspect/edit each page/paragraph, remove unnecessary personal information, and
  confirm text review. Only this reviewed text is submitted to Gemini. Original
  binary files, filenames, account details and other application records are not
  sent to the model. DOCX/TXT references use extracted paragraph numbers; PDF uses
  page numbers. Complex reading order/tables may need manual cleanup.
- Start generation. The API returns a job ID and the browser displays queued/running
  status, with a fixed deadline. The standalone URL includes the ID for reopening
  the review. Active jobs can be resumed from the AI page. No fake percentage is shown.
- Review answers carefully, edit any field, change the correct answer, uncheck or
  remove questions. Save selected questions to an existing bank or create a new bank.
  In a quiz editor, **Add to quiz draft** copies reviewed fields into the existing
  editor; save/publish remains a separate, explicit action.
- Exact supporting quotes are checked against submitted document text. Source labels
  and short quotes are included in the editable explanation so accepted copies can
  retain them. Matching text and valid JSON do not establish factual correctness.
  Lecturers remain responsible for reviewing official assessment content.
- **Regenerate questions** creates a new job/idempotency key and consumes another
  user allowance only if successful. After a page reload, re-enter the topic or
  upload/review the source again; completed jobs intentionally retain no full source.
- On a lost connection, **Retry the same generation request** reuses its original
  identifier/content. Do not create a new generation just to recover a response.
  Bank acceptance is also idempotent; edits after an already-saved acceptance should
  be made in the bank, or copied using existing bank functionality.

### Privacy, failure handling and retention

The free integration is for **non-sensitive educational material only**. Users must
not knowingly submit confidential examination materials, private student data or
other sensitive content. Both frontend and backend require confirmation; document
generation additionally requires confirmation that the extracted text was reviewed.
These are user attestations, not an automatic sensitive-data detector or redactor.

Google's unpaid-service terms allow input/output use for product improvement and
human review; deleting data in this app does not promise deletion from Google.
Read [Google's provider terms](https://aistudio.google.com/docs/terms) before use.

Uploads stay transiently in memory and are never publicly served or stored on disk
or in PostgreSQL. Text extraction runs in a child process with a 256 MiB V8 heap
bound and a hard timeout. DOCX processing checks at most 1,000 ZIP entries and a
20 MiB cumulative expanded-content limit before Mammoth parsing. No external
document resources are requested. The heap bound is not a total OS memory sandbox;
process/native memory still requires sensible deployment RAM limits.

Queued/running jobs retain reviewed text only until completion, failure, deletion,
or deadline cleanup. All terminal transitions clear source input. Generated review
payloads expire after 24 hours; the API denies expired review even before cleanup.
Users can delete job payloads earlier. Minimal ownership/idempotency/accounting
metadata is purged after 30 days. Bank questions/explanations explicitly accepted
by the owner remain normal bank data. Topic/source fields kept in the current
browser tab support regeneration and can be cleared; they are never stored in
localStorage/sessionStorage and are cleared when deleting that generation's data.

Pending jobs reserve one user slot. Successful validated output charges it; extraction
failures, invalid output, refusals, provider failures and timeouts do not charge the
user allowance. Actual provider calls always count against the app project budget.
Eligible response-validation failures, empty/truncated responses and transient HTTP 5xx failures share at most one recovery call with bounded waits. HTTP 429 quotas, invalid credentials, unavailable models, blocked content and other permanent failures are never retried. Ambiguous
connection failures/timeouts and crashed RUNNING jobs are not blindly replayed:
Google may already have processed/charged them. Exactly-once provider execution
cannot be guaranteed over the network. User retries remain idempotent at the job
layer. A short request limiter also bounds creation/extraction attempts.

### Hosting and testing

Use an **always-on Node 24 process** with PostgreSQL, child-process support and
sufficient memory for bounded parsing. The worker runs within the API, polls every
two seconds, and aborts its active call during graceful shutdown. No hosting vendor,
Redis, separate microservice or persistent file volume is required. Sleeping or
serverless runtimes are not supported by this execution model without a future
worker arrangement. Keep proxy body/time limits consistent with uploads and the
extraction timeout. Pending jobs can expire during prolonged downtime; stale work
fails without resending source material. Retention cleanup requires the API worker
to be running; on-read expiry still denies expired data after restart.

Routine tests mock Gemini and make **zero real provider requests**:

```powershell
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
```

Tests cover validation, PDF/DOCX/TXT extraction, invalid/bounded uploads, provider
output/errors, missing configuration, age/privacy eligibility, idempotency, user/project
quota races, worker claims/retries/deadlines, source/result deletion, private review,
bank acceptance and both shared quiz editors. PostgreSQL tests use disposable schemas
or clusters. Real browser validation uses an injected provider in an ignored local
harness, never a production mock-mode switch or a live API key.

Known limits: no OCR, legacy DOC, password-protected documents, automatic PII
redaction, semantic duplicate detection, automatic factual verification, per-question
regeneration, or cross-device persistence of unsaved review edits. If a document
exceeds limits, split it; source is never silently truncated. Thirty questions may
need a narrower topic or more source text. The initial service is university-focused,
18+, Nigeria-only in product scope; regional expansion needs a separate review.

AI endpoints use `/api/v1/ai`, authenticated cookies, explicit DTOs, and the existing
origin/CSRF checks. Only the extraction endpoint accepts multipart; other writes
remain JSON with a scoped 512 KiB parser limit.

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | `/capabilities` | Configuration state, eligibility, allowance, limits and active job |
| POST | `/eligibility` | Existing-account confirmation `{ageConfirmed: true}` |
| POST | `/documents/extract` | One `document` file and `nonSensitiveConfirmed=true` form field |
| POST | `/generations` | Reserve/create a job; returns 202 and its status |
| GET | `/generations/:id` | Read owned status/result, enforcing deadline/review expiry |
| POST | `/generations/:id/review` | Validate edited selected questions before adding to a quiz |
| POST | `/generations/:id/accept` | Atomically save selected questions to an owned/new bank |
| POST | `/generations/:id/discard` | Purge source/review payloads; retain accounting metadata |

Generation input is `{idempotencyKey, kind, topic, segments, difficulty, count,
nonSensitiveConfirmed, textReviewed}`. Topic requests use `kind: TOPIC` and empty
segments. Document requests use `kind: DOCUMENT`, reviewed `{label,text}` segments
and `textReviewed: true`. Acceptance sends edited `questions` plus either `bankId`
or `newBank: {title, description, courseId}`. Each job has one idempotent bank
acceptance; bank capacity/ownership checks and receipt writes share its transaction.


### Generation reliability and live troubleshooting

Apply the additive `202611050006_ai_reliability` migration with `npm run db:deploy`
and restart the backend after updating. No new environment variables are required.
The existing `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_MAX_OUTPUT_TOKENS` and job/call
limits continue to apply. The SDK performs one HTTP attempt per reserved call;
all validation and transient recovery shares the existing **two-call maximum**,
project pacing, deadline and daily call budget. Only a valid final question set
uses the user's successful-generation allowance.

The provider schema requests exactly the selected count. Server validation
still requires four distinct options, a zero-based answer, an explanation, the
requested difficulty, unique prompts and source-bound document references. Only
surrounding whitespace, difficulty letter case and explicit A-D answer labels are
normalized. Numeric strings, missing explanations and unsupported citations are
rejected; questions are never silently dropped or invented to repair a set.

Owned job diagnostics contain call number, safe failure category/field paths,
allowlisted finish reason and available input/output/total token counts **per
call**. Missing token counts mean Google did not supply them; totals may include
provider reasoning tokens. Diagnostics never contain prompts, extracted text,
raw AI responses, provider exception messages, API keys or invalid field values.
No private provider content is logged. Minimal diagnostics follow the existing
30-day job retention and are cleared on explicit deletion.

For resumption, an owner-only summary retains topic (or a generic document label),
source kind, quantity and difficulty for 24 hours from creation. It never retains
lecture text or filenames. Explicit deletion clears it. Full reviewed source input
is still erased at every terminal transition. The page offers active/recent job
resumption, restores settings, and shows actual queued, pacing, calling or recovery
state plus elapsed time. Document regeneration after returning requires re-upload
and review; unsaved edited questions are not persisted across devices.

To perform a **fresh live test yourself** after configuring an API key and a model
available to your Google project:

1. Run `npm run db:generate`, `npm run db:deploy`, then `npm run dev` at the root.
2. Open `http://localhost:5173`, sign in, and open Generate questions. Use a new
   non-sensitive topic such as ?Cell membranes and passive transport?, five
   MEDIUM questions, and explicitly confirm the privacy notice.
3. Choose Generate questions (or Regenerate questions for a new request). This
   makes a real Google request and may make one eligible recovery call. An old
   failed job is historical and will not re-run on refresh.
4. Check the result and expand Generation diagnostics. Record the request ID,
   failure category, finish reason and token counts if it fails. Share only those
   diagnostics, never the API key, private source text or raw provider response.
5. If topic generation succeeds, upload a small public educational TXT/PDF/DOCX,
   review the extracted text, then generate five questions. Save accepted questions
   to a bank and verify they can be added to a draft.

`MAX_TOKENS` indicates truncation: first try fewer questions. Check project model
availability for `MODEL_UNAVAILABLE`, permissions for `PROVIDER_CONFIGURATION`,
and Google project quota for `PROVIDER_QUOTA`. Recovery cannot guarantee a valid
or factually accurate response. No live provider requests are part of automated
or browser verification.

On a busy development machine, run verification suites separately. PowerShell
`$env:VITEST_MAX_WORKERS='1'` reduces test process contention for `npm test` and
`npm run test:integration`; concurrency-sensitive tests still issue simultaneous
requests inside each test. This does not change application settings or budgets.


### Document source-reference reliability

Document generation uses request-scoped integer source IDs: the first reviewed
segment is 1, the second is 2, and so on. IDs are derived from the immutable saved
job input, so recovery calls use the same mapping. The provider receives only
`{id, text}` segments, and must return `source: {id, quote}` for every document
question. Topic responses still require `source: null`. The backend rejects
unknown IDs and checks the excerpt only inside the referenced segment, never by
searching unrelated segments or documents.

Matching uses NFC and collapsed whitespace on comparison copies only. Line breaks,
tabs, repeated spaces and nonbreaking spaces may differ. Reviewed text and valid
returned excerpts remain unchanged. Punctuation, case, mathematical signs,
superscripts, ligatures, soft/hard hyphens and paraphrases are not normalized away.
Quotes remain limited to 300 characters. A matching excerpt proves text membership,
not that the question or correct answer is factually supported; human review is
still required, especially after editing a question.

The public result remains `{label, quote}`: labels come from the reviewed source,
not the model. Existing review controls copy this note into editable explanations
when saving to banks or practice/assessment drafts. Accepted source notes follow
normal bank/quiz retention; no document storage or new source database is added.
All existing source-input deletion and review-expiry rules remain in effect.

New diagnostics distinguish `SOURCE_MISSING`, `SOURCE_ID_UNKNOWN` and
`SOURCE_EXCERPT_MISMATCH`, with safe question field paths. They record requested and
returned question counts (when a response can be parsed), segment count and total
reviewed character count. They never record source contents, returned invalid IDs,
excerpts or complete provider responses. Missing returned counts are shown as
unavailable, not zero. Token metadata, the two-call budget and successful-generation
allowance rules remain unchanged; no extra provider verification call is made.

No migration, new dependency or new environment variable is required. Restart the
API and create a **fresh** generation to test this change. An old failed job will
not rerun or acquire new diagnostics. Upload a small non-sensitive PDF/DOCX/TXT,
review the extracted text, confirm the privacy notice, and request five MEDIUM
questions. For a PDF with wrapped lines, a matching excerpt may use normal spaces.
Review the questions and source notes, then save to a bank or add to a draft. If a
fresh request fails, share only the request ID, diagnostic category/field paths,
counts, finish reason and token metadata. Do not share private text or API keys.


## Friends challenges and leaderboards (Stage 6)

Stage 6 reuses the quiz editor, private bank selector, reviewed AI questions,
autosave, grading and shared attempt engine. Challenges are asynchronous and
student-only. No multiplayer, chat, tournaments, payments, friendship graph or
global rankings are implemented.

Run `npm run db:generate` and `npm run db:deploy` to apply the additive
`202611050007_challenges` migration. It adds Challenge (one-to-one with Quiz) and
ChallengeParticipant (unique quiz/student membership), plus scoped SQL guards.
Existing questions, attempts, grades, sessions and AI data are not rewritten.

### Invitation encryption configuration

Set backend-only `CHALLENGE_INVITE_KEY` in `apps/api/.env` to **64 hexadecimal
characters representing 32 random bytes**. Generate it independently:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never reuse JWT_SECRET, commit this key, or put it in frontend/VITE variables.
Restart the API after configuring it. A missing key disables challenge publishing
and invitation retrieval; drafts and all previous stages continue to work. An
invalid key fails configuration validation. The example intentionally leaves it
blank. No additional dependency, paid service or scheduling infrastructure is used.

Keep this key stable and backed up. Invitations are encrypted using AES-256-GCM,
with a fresh nonce and the quiz ID as authenticated associated data, and separately
hashed with SHA-256 for lookup. Only the creator can retrieve a plaintext code/link.
Changing the key does not re-encrypt old invitations: old codes can still join via
their hashes, but creators cannot retrieve them until the original key is restored
or a controlled re-encryption migration is performed. No key-rotation UI is added.

### Workflow and policies

Students have Created, Joined and History views. Create a draft with manual
questions, owned bank copies, or reviewed AI output. An optional timer is 1?180
minutes; an optional closing date/time is entered in the device timezone, sent as
an ISO offset, and stored as UTC. Publishing requires 1?50 valid questions and a
future closing time if one is selected. Questions, options, timer and schedule
then become immutable. Challenge metadata holds closure separately from Quiz,
so published practice/assessment protections remain intact.

Copy an invitation from the creator management page. The 24-character random code
is in a URL fragment (`/challenges/join#code=...`), not a server query string.
Login/registration preserves only a validated internal invitation return. Friends
explicitly join after a notice that their display name, score and completion time
will appear to eligible members. Joining does not start timing or consume an attempt.
There is no public challenge listing. A forwarded code can admit another student;
invites are not person-bound. New joins stop at closure.

Each joined student gets one lifetime attempt; creators cannot participate. Repeated
starts resume or return that same attempt. All friends receive identical frozen
questions/options. Timers and completion duration include disconnections and time
away. Autosaves retain optimistic revisions and safe lost-response retries. Scores
appear on submission; correct answers, explanations and saved source notes appear
only in a finalized participant's own result after closure. Creators already know
their authoring keys; they never gain access to individual participant selections.

The effective cutoff is the earliest timer deadline, scheduled closing time or
manual close. Closure is permanent and can happen during an attempt. Only saved
answers before the cutoff are graded; unanswered questions get zero. New attempts
and late saves are rejected. Request-time checks and the existing 15-second sweep
enforce closure even after downtime; finalization uses the original cutoff, not
sweep time. An untimed challenge without a schedule stays open until manually closed.
No separate scheduler is required.

Close/detail/leaderboard requests finalize up to 100 due attempts per pass in
separate transactions. The sweep handles remaining work. A leaderboard with due
attempts remaining shows an updating state with no premature final rows. Retry or
polling completes processing. Rankings use PostgreSQL RANK() over all finalized
attempts before pagination (20 rows/page), by score descending then timestamp
completion duration in milliseconds ascending. Exact ties share competition ranks
1,1,3. Milliseconds are displayed so ordering is explainable. Submitted and expired
attempts count; students who never started do not.

Creators can view rankings throughout. Members can view them after finalizing their
own attempt or after closure. Nonmembers cannot. DTOs contain only display names,
score/percentage, duration, rank and a viewer marker: no emails, account IDs, answer
selections, invitation ciphertext or hash. History retains separate participant
scores. Question banks remain private; published challenge questions are snapshots.
AI privacy, document retention, source-reference checks and quotas are unchanged.
The system enforces one attempt per account, not unique human identity or proctoring.

### Challenge API

All endpoints are authenticated, active-student-only under `/api/v1/challenges`.
Mutations retain exact-origin, JSON and CSRF checks. Creation/update use the existing
256 KiB quiz limit. Join requests have an additional 10/minute/IP limit.

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | `?view=created&page=1` | Paginated Created, Joined or History views |
| POST | `/` | Create a draft |
| GET | `/history?page=1` | Finalized participation history |
| POST | `/join` | Explicit idempotent join with `{code}` |
| GET | `/:id` | Authorized instructions and own attempt status |
| GET | `/:id/manage` | Creator statistics and management |
| GET | `/:id/draft` | Creator's editable draft |
| PUT | `/:id` | Revision-controlled draft update |
| POST | `/:id/publish` | Publish with `{revision}` |
| GET | `/:id/invitation` | Creator-only decrypted code/link |
| POST | `/:id/close` | Permanent manual close |
| GET | `/:id/leaderboard?page=1` | Authorized ranks or updating state |

Start/resume/save/submit/result use the existing `/quizzes/:id/attempts` and
`/attempts/...` APIs. Permissions and deadlines are enforced in shared services,
transactions, database constraints and scoped triggers. Locks retain the ordering
course -> quiz -> attempt. Challenge attempts always use attemptNumber=1, together
with the existing quiz/student/attempt-number uniqueness constraint.

### Manual verification

1. Configure the key, apply migrations, restart with `npm run dev`, and sign in as
   a student at `http://localhost:5173`.
2. Create a challenge from manual/bank questions or reviewed AI output. Save a
   draft, set an optional future close, and publish. Copy its invitation link.
3. Open another browser profile, follow the link, register/sign in as a student,
   explicitly join, and confirm the timer starts only after Start.
4. Answer, leave and resume; submit and check the score with answer review hidden.
   Verify that starting again returns the same result and that another student's
   attempt URL and private leaderboard cannot be accessed without authorization.
5. Join with another student and leave an attempt active. Close as creator: the
   active attempt is graded at that cutoff and late saves cannot change it.
6. Confirm final rankings, ties and review release. Revisit Joined and History.
   Repeat with a short scheduled close and no manual closure.

All routine tests and browser workflows inject mocked AI responses. Do not make
live Gemini calls during development verification without explicit approval.
Stage 7 requires separate approval.

## Public landing page (Stage 6.5)

Open `/` for The Annotated Page: a dark editorial introduction with light academic
surfaces, the existing AI Quiz mark and locally hosted Instrument Sans. `/dashboard`
remains the authenticated application. The home page stays available to signed-in
users and offers Open workspace. Login/registration, lecturer verification, age
eligibility and challenge invitation return paths retain their existing rules.

The source-to-question demonstration is entirely local and clearly labelled as
prepared content. Visitors inspect a sample passage, edit question wording, select
an answer and read an explanation. It accepts no documents, sends no AI requests,
stores no attempt and uses no localStorage/sessionStorage. Other product fragments
have explicit example labels; sample names and scores do not represent real users.
Actual AI generation still requires authentication, review and privacy consent.

Implementation lives in `apps/web/src/features/landing`. Workspace routes are loaded
in a separate JavaScript chunk from `app/WorkspaceRoutes.tsx`. Session errors do not
replace the public content with an error screen. CSS is scoped to the landing
feature; authenticated screens retain their existing design system. No backend,
database, dependency or environment-variable changes are required.

### Manual verification

1. Run `npm run dev`, then open `http://localhost:5173/` while signed out.
2. Use Try a sample question, inspect its source, edit its wording, choose an answer
   and check the explanation. Return to review and try the other answer outcome.
3. Test the mobile menu using a keyboard, including Escape and section navigation.
   Enable the operating system's reduced-motion setting and repeat the interaction.
4. Sign in as a student or lecturer. Visit `/` again and use Open workspace. The
   workspace logo should lead to `/dashboard`; the authentication logo leads home.
5. Verify a challenge invitation through login/registration and an explicit join.
6. Stop the API while keeping Vite running: the public page and sample should remain
   usable. Login and real application operations still require a functioning API.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and the existing
PostgreSQL integration suite for regression verification. Frontend test setup warms
Vite's lazy workspace module before assertion timers, without replacing route guards.
Landing tests cover pending/unavailable sessions, both signed-in roles, source
inspection, editing, correct/incorrect feedback, menu focus and privacy disclosure.

The public page remains a client-rendered Vite application. Metadata is provided,
but initial HTML prerendering, a deployment-specific canonical URL and a social
preview image remain deployment considerations. No analytics or third-party media
are loaded. Screenshots and local browser audit reports live under the ignored
`.taste-skill/landing/` directory. Stage 7 requires separate approval.

Verification on 5 November 2026: 56 API unit tests, 66 frontend tests and 125
PostgreSQL integration tests passed. TypeScript, lint and both production builds
passed. The landing browser checks covered local question review/answer feedback,
API unavailability, keyboard navigation, reduced motion and reflow from 320 to
1440px. An axe-core audit found no WCAG A/AA violations across seven desktop/mobile
states; layered surfaces and decorative arrows required manual contrast review.
This does not replace assistive-technology testing or a full accessibility audit.

The initial JavaScript bundle is approximately 101.53kB gzip; workspace routes add
26.98kB gzip only when visited. A single cold foreground Chromium run at 390px,
4x CPU slowdown, 100ms latency and 400000 bytes/s measured LCP 4.1s and negligible
layout shift. This is a local synthetic observation, not a production guarantee;
loading performance remains a deployment measurement and optimization concern.

Mocked Chromium regressions also passed for practice and assessment authoring,
grading, held answer review, PDF/DOCX/TXT generation recovery, bank acceptance,
challenge invitations, resumption, manual/scheduled closure and private rankings.
All three quiz modes were exercised against a disposable PostgreSQL cluster;
no live Gemini requests or developer-database resets were used.
