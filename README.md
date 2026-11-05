# AI-Powered Online Quiz System

A React and Express application for academic assessments and personal learning.
**Stages 1–4 are implemented:** project foundation, student/lecturer accounts,
secure sessions, role authorization, operator-managed lecturer verification, and
manual personal practice, lecturer-owned courses, enrollment, official assessments,
and a reusable attempt engine, private reusable question banks, and CSV import.
AI, lecture-document uploads, and friends challenges remain deferred.

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
runs Stage 1–4 suites in the isolated schema. Frontend tests cover
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

This is a Stage 4 implementation, not a production launch. Email verification, password
recovery, profile editing, and multi-device session management are not implemented.
Before launch, add the agreed email/recovery flow, retention cleanup for expired
session rows, backup/restore procedures, monitoring, and deployment configuration.
Do not delete session-family root rows while any member of that family is valid.

For a deployment, build both apps, apply migrations, run `npm run start -w @quiz/api`,
serve `apps/web/dist` with SPA history fallback, and reverse-proxy `/api` to Express
on the same origin. Configure TLS, HTTPS `APP_ORIGIN`, production mode, and the exact
proxy hop count. The API deliberately binds to loopback for this topology.

Stage 5 requires separate approval. AI, lecture-document uploads, and challenges
remain outside the current implementation.

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
