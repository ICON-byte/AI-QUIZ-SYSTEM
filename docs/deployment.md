# Free-tier deployment

Stage 7 targets Vercel Hobby, Render Free (one Node web service), a fresh dedicated
Supabase Free PostgreSQL project and the operator's Gemini free-tier quota. No
paid service, Redis, cron service, persistent disk or keep-alive pings are needed.
This document supersedes the earlier always-on hosting recommendation.

## Approval gates and source

Preparation and a local deployment commit are authorized. Creating hosting
resources, applying production migrations and deploying still require explicit
approval. Never reset, seed or copy local database data into production.

The repository root contains `render.yaml` and `vercel.json`. The API name and
rewrite destination `ai-quiz-system-api.onrender.com` are **proposed, unreserved**.
After resource creation, replace the rewrite destination with the actual Render
URL before deploying Vercel. Set APP_ORIGIN to the exact stable Vercel HTTPS origin,
without a path or trailing slash. Preview URLs are not automatically trusted.

Deploy the reviewed commit, not the dirty working tree. The approved landing visual
edits and pending-lecturer CLI work are committed separately from deployment
preparation. The unrelated Account.tsx modification stays uncommitted and is
excluded from deployment.

## Supabase

Create a fresh project on the Free plan only after approval; check free-project
availability first. Do not reuse unrelated projects, delete projects to free a
slot, upgrade a plan or enable billing automatically. Prefer an available European
region near the Render service, and confirm the exact region before creation.

Disable the unused Supabase Data API before exposing application tables. Express
performs authorization; this application does not use Supabase Auth or browser
database access. Check that anon/authenticated roles cannot reach application
tables through REST/GraphQL. Do not put Supabase keys in the frontend.

Use the project's **session pooler, port 5432** (IPv4 compatible), or a verified
direct connection. Do not use transaction pooler port 6543 for migrations. Use TLS
with certificate verification; never set rejectUnauthorized=false or disable TLS
to fix connectivity. URL-encode the password and follow the project's connection
dialog/certificate instructions. Keep credentials in secret environment storage.

After target and SQL review and explicit migration approval, run from a trusted
local checkout with the production DATABASE_URL set in that terminal's environment:

```powershell
npm run db:deploy
```

This applies the seven committed migrations to the empty dedicated database.
Do not use migrate dev, db push, migrate reset, seed or integration tests against
production. Verify `prisma migrate status` from apps/api and a read-only health
query afterward. No new application migration is required for deployment.

## Render Free

Use repository root, Node 24 and the settings in render.yaml:

- Build: `npm ci --include=dev && npm run build -w @quiz/api`
- Start: `npm run start -w @quiz/api`
- Health: `/api/v1/health`
- Plan: **free**; automatic deploys off. Do not apply the Blueprint before approval.
- No build/start migration command: migrations are a separate approval gate.

Configure secrets in Render's environment UI or approved secure integration:

| Variable | Production value |
| --- | --- |
| NODE_ENV | production |
| NODE_VERSION | 24 |
| HOST | 0.0.0.0 |
| PORT | Supplied by Render; do not hardcode a local port |
| DATABASE_URL | Dedicated Supabase session/direct TLS URL |
| APP_ORIGIN | Exact stable frontend HTTPS origin |
| JWT_SECRET | Fresh random secret, at least 32 characters |
| CHALLENGE_INVITE_KEY | Independent 32 random bytes encoded as 64 hex characters |
| TRUST_PROXY_HOPS | Initially 0; see proxy verification below |
| GEMINI_API_KEY | Server-only key for a project with free-tier access |
| GEMINI_MODEL | Exact structured-output model verified for that project's quota |

All optional AI limits in apps/api/.env.example retain their defaults. No implicit
model or paid fallback exists. Missing AI credentials disable AI, not manual quiz
functionality. Obtain the key in Google AI Studio and verify free-tier model
availability there. Do not enable billing or run live generation without approval.
Back up JWT_SECRET and CHALLENGE_INVITE_KEY securely; changing the invitation key
makes existing encrypted codes unreadable. Never commit production .env files.

### Sleep/restart behavior

- Render sleeps after idle periods and may restart at other times. Cold API calls
  can take roughly a minute or fail through the proxy; users may need to retry.
  The static landing page stays available independently of the API.
- AI work is in PostgreSQL. Startup immediately ticks the worker, whose first
  step is cleanup. Expired QUEUED/RUNNING jobs fail and purge their source input.
  A non-expired abandoned RUNNING job waits until its deadline; it is not replayed.
  An expired dispatch lease is replaceable. Actual call accounting is retained,
  including calls whose responses were lost during a restart. Users can submit a
  new generation after the old job fails, subject to the existing quotas.
- An interrupted Gemini call cannot reliably deliver results. Background work is
  not guaranteed while asleep. Do not add automatic replay or extra provider calls.
- Quiz answers, sessions, memberships and deadlines persist in PostgreSQL. Request
  checks enforce the original cutoff after wake, and the existing 15-second sweep
  resumes. A late sweep does not grant extra time or change grading duration.
  Leaderboards with due attempts remain withheld until bounded finalization ends.
- Review access expires at 24 hours even without cleanup. **Physical deletion of
  temporary source/review/metadata can be delayed beyond its target retention
  while Render is asleep or suspended.** It resumes on the first worker tick.
  This free-hosting limitation must not be described as guaranteed timed deletion.
- Supabase Free can pause for inactivity and has storage/connection limits; an
  unavailable database requires restoring it before the backend can recover.
- Limited memory can interrupt large PDF/DOCX extraction. Existing bounds and
  sanitized failures remain; test a small synthetic document first. No disk is
  needed because uploads are memory-only. Rate-limit counters reset on restart.
- Stay inside included instance hours, bandwidth/build and Gemini quotas. Do not
  add payment methods, upgrades or billable overages as a workaround.

See [Render free limitations](https://render.com/docs/free) and
[Supabase Prisma setup](https://supabase.com/docs/guides/database/prisma).

## Vercel Hobby

Create the project from the repository **root**, use Node 24, framework Vite,
and keep the build/output settings in vercel.json. No frontend secrets are needed.
Do not put database, JWT, invitation or Gemini secrets in VITE_* variables.

The external `/api/:path*` rewrite precedes the SPA fallback. The browser continues
using relative same-origin /api calls, with HttpOnly Secure SameSite=Lax host-only
cookies, the existing exact Origin check, and the custom CSRF header. Do not add
wildcard CORS, cross-site cookie relaxation or a browser-to-Render API base URL.
API rewrite caching is disabled. Security headers cover the static frontend.

Keep TRUST_PROXY_HOPS=0 until the real forwarded chain is measured securely.
This prevents trusting spoofed forwarding headers but can group visitors behind
proxy IPs, causing shared rate limits. Live verification must resolve this before
calling multi-user rate limiting reliable. Never enable broad trust proxy=true.
If trusting Vercel-provided identity is needed, first authenticate proxy traffic
at the backend; direct Render requests must not be able to forge the trusted chain.

## Lecturer verification without a Render shell

Render Free has no interactive production shell. Use the existing CLI from a
trusted local checkout of the deployed commit, connected directly to the dedicated
production database through a terminal-scoped DATABASE_URL. Do not replace your
development .env or pass database credentials on the command line. Environment
variables take precedence over the local dotenv file. Only authorized operators
should have this database access.

After a local API build, from the repository root:

```powershell
node apps/api/dist/commands/verify-lecturer.js --email "actual-lecturer@example.edu" --actor "operator-name" --decision approve --reason "Confirmed lecturer identity with institution"
```

Confirm the target account and production target first. The operation remains
transactional and audited; no public administrative endpoint is added. Remove
production environment values from the terminal when finished.

## Live verification after deployment approval

Check frontend and API health; deep-link SPA routing; HTTPS cookies through the
rewrite; refresh rotation/logout; student and pending lecturer registration;
unverified lecturer denial; authorized CLI approval; course/assessment, practice,
banks and challenge flows; a deadline crossing a restart; private leaderboard
visibility; phone layout and cold-start recovery. Inspect sanitized request IDs,
not credentials or private content. Live Gemini topic and small synthetic document
generation need separate approval. Test accounts/data are retained until cleanup
is explicitly approved. Never perform destructive cleanup automatically.
