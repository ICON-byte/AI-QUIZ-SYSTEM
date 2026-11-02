# Academic workspace interface

The interface is an academic workspace for students and lecturers. Stage 1 lets
people create an account, sign in, inspect their role and verification status,
and sign out. Unimplemented academic features are described honestly without
dead navigation, invented courses, or fabricated activity statistics.

## Direction

The frontend design skill dealt the **Editorial greeting** direction, seed
`80601035`, without redraws. Its neutral frame, white sheet, tonal panels, and
personal greeting suit an account workspace. The product's face comes from
sage-tinted academic paper surfaces, locally bundled Instrument Sans, a book and
question-lines mark, and an account-access summary specific to the user's role.

The primary questions are:

- Sign in/register: how do I enter the workspace with the correct role?
- Student overview: is my account ready, and where are my account details?
- Lecturer overview/verification: am I approved for official assessment access?
- Account: which identity and role am I signed in with?

## Implementation

- Tokens and responsive behavior live in `apps/web/src/styles.css`.
- Primary text `#1f201d`, muted text `#626963`, white sheets, sage-neutral surfaces,
  and restrained semantic status colors. No gradients, glows, or decorative metrics.
- Instrument Sans is self-hosted through its npm font package.
- Forms have explicit labels, autocomplete, visible focus, safe error feedback,
  native validation, pending states, and an optional password visibility control.
- Navigation folds into an accessible menu below 900px; the authentication layout
  stacks at the same width. Content and account identifiers wrap on small screens.
- The desktop canvas supports a maximum 1100px content grid with 16px gutters.
- Application data comes from the current authenticated account. No sample data
  ships in the product; test accounts exist only in disposable verification data.

## Verification notes

Browser inspection at 1440px, 768px, and 390px found no failing design checks for
sign-in, registration, or the authenticated dashboard. Source design lint passed.
The authentication inspector reports whitespace warnings because it treats the
two intentionally separated full-height authentication regions as content cards.
The dashboard retains empty space below its actual Stage 1 account content; filling
it with invented activity or unapproved features would misrepresent the product.
Screenshots were visually reviewed, including the phone form and dashboard,
tablet navigation, and approved lecturer verification state.

Real-browser checks also exercised registration for both roles, account navigation,
mobile menu expansion, logout, operator CLI approval, verification refresh within
the existing session, and access-cookie renewal. There was no horizontal overflow
at the checked widths and no uncaught browser exception in the exercised flow.

## Stage 2 practice surfaces

The existing Editorial greeting direction, Instrument Sans, neutral/sage palette,
and responsive workspace shell are preserved. No redraw or new visual world is
introduced. The signature element is a numbered question map: answered questions
use a muted fill, the current question has an outline, and all states have text or
accessible labels. Actual server data supplies counts, grades, and timing.

- Library: which private quiz should I write or practise next? A ruled list names
  each quiz, its draft/publication state, question count, and timer.
- Editor: what will this question ask, and which answer is correct? A single-column
  question sequence makes four labeled options and one radio choice explicit.
- Instructions: what am I about to attempt? Timing, question count, scoring, and
  resume/review rules appear before the start action.
- Taking: which question am I answering, and is my answer saved? The question leads,
  with save status beside it, a countdown above, and a numbered progress rail.
- Results: how did I do, and what should I revisit? A divided numeric summary leads
  into question review, correct-answer labels, and optional explanations.
- History: what happened on each attempt? A semantic table preserves separate
  attempts with aligned score/duration columns and direct review links.

All screens include pending/error/empty states. Autosave failure keeps the selected
choice visible, explains it is unsaved, and offers retry/reload. The taking controls
block submission while a selection is unresolved. Phone layouts stack the progress
rail and editor columns; history has contained table scrolling. There are no
fabricated quizzes or metrics in the product.

Stage 2 verification used the real API and an isolated PostgreSQL database. The
browser flow covered draft editing/removal, publication, offline autosave recovery,
resumption, grading/review, missed-question drafts, retakes, expiry, and historical
result preservation. Library, editor, instructions, taking, results, and history
were captured at 1440px, 768px, and 390px without page overflow or uncaught browser
exceptions. Final editor and taking inspections reported zero failures/warnings;
save/progress labels were increased to 13px after the first inspection. Source
design lint's only warning is the deliberate minutes:seconds clock zero-padding.
Biology quiz examples exist only in disposable verification fixtures, not the app.

## Stage 3 academic surfaces

The existing Editorial greeting direction, sage/neutral palette, Instrument Sans,
and responsive shell are retained. Course codes identify the academic context;
enrollment codes appear only when a lecturer creates or rotates them. There are
no invented enrollments, scores, performance charts or decorative metrics.

- My courses: which class do I need? Course code/title, archive state and one
  create/join action lead to the course's actual assessments.
- Course details: what is available for this class? Assessment rows explicitly
  distinguish draft, scheduled, open and closed states. Lecturer tools expose
  enrollment, roster and lifecycle controls with confirmations.
- Roster: who has access? Student name/email, enrollment state and remove/restore
  actions form a semantic table with contained phone scrolling.
- Assessment editor: when and how may students participate? Schedule and attempt
  fields extend the existing question editor; dates use the browser timezone.
- Student instructions/taking/results: the same Stage 2 components use assessment
  context, effective deadlines and prior-attempt links. A submitted score precedes
  the clearly stated review-release notice. Answer review appears only after closure.
- Lecturer report: how did this assessment go? Plain labeled statistics and
  aligned score/timestamp rows explain results without unnecessary charts.

The screenshot fixtures use two independent browser profiles for lecturer and
student. Sample biology content belongs only to disposable verification data.

Stage 3 browser verification covered lecturer approval, course creation/editing,
student enrollment, official publication, shared answer saving/resumption,
submission with withheld review, roster/report views, early closure and released
review, enrollment-code rotation, removal/restoration and archive. All captured
screens were checked at 1440px, 768px and 390px without page overflow or uncaught
exceptions. Course and report browser inspections had no failures. The short
course's full-height workspace frame intentionally retains empty space rather
than inventing assessments; this accounts for the inspector's whitespace warnings.
Report labels were increased to 13px after its first inspection.
The final report inspection passed with zero failures and zero warnings at all
three widths; report/roster tables keep horizontal scrolling inside their frame.
