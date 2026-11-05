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
- Authenticated application data comes from the current account; test accounts
  exist only in disposable verification data. Stage 6.5 public examples are
  explicitly labelled and remain separate from account data.

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

## Stage 4: reusable questions

The existing Editorial greeting direction (seed 80601035), Instrument Sans and
sage/neutral workspace remain in use. New screens answer these questions:

- Question banks: which collection do I need? Title, description and actual active
  question count lead to an owned collection. Search and archive views stay simple.
- Bank details: which question can I reuse? Question text leads, followed by topic
  and difficulty. Answers/explanations expand on demand; edit/copy/archive actions
  stay attached to the question. A bank's private state is explicit.
- Question editor: what is the question and its one correct answer? The existing
  four-option form pattern is followed by topic and difficulty controls.
- CSV import: which rows are safe to add? The native file chooser and visible
  limits precede a record-by-record preview with readable field errors. Invalid
  rows require an explicit skip choice; confirmation names the destination/count.
- Quiz selection: which saved questions belong in this draft? The shared selector
  browses active owned banks and retains selected IDs across pages/banks. It shows
  remaining capacity and adds independent copies to the same draft editor.

All new screens include loading, empty, validation and connection-error states.
Inputs have labels; file constraints use aria-describedby; native checkboxes,
selects, disclosure controls and focus styles preserve keyboard access. Text
search requests are debounced while input updates immediately. No credentials,
files or question selections are persisted in browser storage.

Real Chrome verification used independent student/lecturer profiles and disposable
biology fixtures. It covered manual creation/editing, question duplicate/archive,
cross-bank copy, CSV upload/preview/errors/explicit import, bank duplicate/archive,
practice selection/publication/graded submission, published snapshot independence,
lecturer course association, assessment selection/publication/submission with held
review, and whole-assessment duplication. Captures at 1440, 768 and 390 pixels had
no page overflow or uncaught exceptions. The bank screen inspector passed at all
three widths. Its single desktop whitespace warning reflects the full-width list
with short question text and collapsed answer details; that space is retained for
long academic questions. Source design lint has no failures; its only warning is
the existing countdown's zero-padding.

The CSV import screen also passed the inspector at all three widths. Its file
guidance was increased to 13px after the initial inspection; the final run has
only a desktop whitespace warning because the file chooser has no preview until
a file is selected. The workspace intentionally keeps its full-height frame.

## Stage 5: AI generation and review

The existing Editorial greeting direction (seed 80601035), Instrument Sans,
sage/neutral palette and responsive workspace are retained. No AI illustrations,
decorative progress animations, fabricated percentages or unrelated dashboard
elements are introduced.

- Generation input answers what material to use: a topic or a bounded document.
  A visible free-tier privacy notice and explicit non-sensitive-material confirmation
  precede submission. Availability, age eligibility and actual allowance are clear.
- Document preview answers what leaves the application: editable page/paragraph text
  with an explicit review confirmation. File/page/character constraints are visible
  beside the chooser and connected with aria-describedby.
- Job status sits above the input panel and reflects backend queue, pacing, provider
  call and bounded recovery states. A quiet activity dot, elapsed time and fixed
  deadline replace invented progress. A disclosure contains sanitized per-call
  categories, field paths, finish reasons and available token counts.
- Active/recent jobs can be resumed with owner settings restored for 24 hours.
  Consent is not restored across page reloads; document regeneration requires a
  fresh upload and text review because terminal jobs do not retain source input.
- Review answers which questions to keep: existing four-option question controls,
  independent radio groups, explanation/source fields, difficulty/topic and selection.
  Review edits remain drafts until the user saves to a bank or the current quiz.
- Registration adds a required 18+ confirmation; existing accounts confirm on the
  AI page without disrupting their manual features. No date of birth is collected.

Chrome validation used an injected mock provider and disposable biology fixtures,
with zero live Gemini requests. It exercised age confirmation, topic generation,
question edits/rejection, new-bank acceptance, whole-set regeneration, actual PDF,
DOCX and TXT upload/extraction, reviewed-only text submission, source references,
both quiz editors, published practice grading, withheld assessment review, private
job ownership, provider failure and payload deletion. Captures at 1440, 768 and 390
pixels had no page overflow or uncaught errors.

The final AI review inspector measured zero failures and zero warnings at all three
widths. Screenshots were visually checked for form labels, readable privacy text,
question controls and phone wrapping. Source design lint has no failures; its only
warning remains the existing countdown's deliberate zero-padding.


## Stage 6: asynchronous friends challenges

The existing Editorial greeting direction, Instrument Sans, sage/neutral surfaces
and form controls are preserved. Created/Joined/History are simple links; challenge
lists show real question counts, availability, timers and personal attempt state.
The shared editor retains manual/bank/AI review controls and adds an optional local
closing time. Publishing and closure explain their permanence before confirmation.

Joining explains display-name/score/time visibility and requires an explicit action.
Invitation fragments survive safe login/registration return. Creator management
shows actual joined/started/finalized/in-progress counts and reveals codes only on
request. No fabricated statistics, trophies or global competition UI is introduced.
The existing taking screen and save states are reused. Results withhold answer
review until closure and offer leaderboard navigation instead of retakes.

Rankings use a semantic table with millisecond times, shared competition ranks and
a viewer marker. Phone tables scroll inside their own frame, not the page. Empty,
locked, connection-error and finalizing states are explicit. New UI remains keyboard
accessible and uses the existing visible focus styles without extra animation.

Mocked Chromium workflows verified challenge authoring, invitations, explicit joining,
resumption, held answer review, manual/scheduled closure and private leaderboards.
Desktop (1440px), tablet (768px) and phone (390px) captures were checked; the
responsive inspection found no page-level horizontal overflow.

## Stage 6.5: The Annotated Page

The public route uses the approved dark editorial direction, with deep green-black
`#101916`, raised green `#1a2722`, light ink `#f4f6f3`, muted ink `#b6c2ba`, sage
`#bed8c5`, light paper field `#e8eee8` and white document surfaces. On light surfaces,
ink is `#1f201d`, secondary text `#4c5951` and the existing accent `#1b6e66`.
Instrument Sans and the existing book symbol connect the introduction to the app.
All new rules are scoped to landing components; authenticated screens stay intact.

The design-taste direction is The printed annual (editorial-report), seed
1718397743. Its photograph-dependent CTA was redrawn to The idea again, inverted:
there are no owned photographs or spokesperson assets, and the approved subject is
its source/question interface. The user-approved compact CTA, native FAQ disclosure
and restrained motion take precedence over the library's oversized scene recipes.

On this page, the reviewed source passage becomes the recurring editorial object:
a paper in the hero, an inspectable excerpt in the demo, a practice explanation and
a question kept in a private bank. Product fragments contain complete, authored
examples rather than decorative charts. Examples are restricted to the public page
and explicitly labelled; authenticated account screens never receive sample data.

The public layout uses oversized two-line type, an asymmetric desktop opening,
layered paper/question surfaces, a full-width review spread, a light practice
chapter, assessment margin notes, a joined invitation/leaderboard example and a
wide bank selection. Mobile stacks content in reading order. Tablet uses adjacent
readable sheets rather than obscuring the source with the desktop overlap.

The local demo permits source inspection, wording edits and a four-option answer.
The correct answer and explanation are prepared public content. Editing changes
wording only, with an explicit notice that the example's answer key remains fixed.
It creates no job or attempt and never sends source data to a provider. Stage changes
move focus to the question heading; answer feedback uses a polite status region.

Motion consists of short paper/type arrivals, one-time section entrances and
immediate control feedback. Content is visible by default; an unavailable observer
cannot hide it. Reduced motion removes animations while preserving the same content
and controls. No scroll hijacking, video, external font requests or motion library
is introduced. Interface examples provide the imagery for this software product.

Visual refinement: the first browser pass identified overlapping tablet text and
an unnecessary low-contrast hero annotation. The second composition separated the
sheets, removed that annotation, shortened the challenge heading and changed the
bank section into a wide selection spread. The final refinement strengthened muted
text on light paper, consolidated the editorial type scale and replaced typographic
checkmarks with the same restrained vector selection marks used by the UI language.

Verification evidence and the final visual critique are recorded under the ignored
`.taste-skill/landing/` folder. Public-page snapshots are captured at 1440, 768 and
390px; interaction/reflow checks also cover 320, 601 and 1024px.
