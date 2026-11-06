# Landing refinement — Milestone 2

6 November 2026. The Annotated Page remains the creative direction. This milestone
preserves the Instrument Sans/book identity, green-black/sage/paper palette, font
preload, fixed navigation, editable lecturer role hint and demo focus corrections.

## What changed

- An asymmetric headline/introduction now leads directly into one working sample.
  The old static preview and separate review section were removed. Desktop display
  tracking is -0.04em rather than -0.065em; phone tracking is -0.035em. Type remains
  readable at all five requested widths, with deliberate two-line hero breaks.
- On desktop and tablet, a restrained paper tilt distinguishes the source from the
  upright question. On phones, the question comes first; an explicit, keyboard
  accessible disclosure contains its supporting excerpt. No duplicate source sheet
  precedes the mobile interaction. The sample remains authored, local and labelled.
- The actual question is the demo heading. Review, editing, source inspection,
  answering and feedback share the same component and state. Review wording edits
  remain temporary; downstream bank/course/challenge specimens are clearly labelled
  illustrative examples, not saved demo output.
- The bank follows the hero, with real anchor links into three uses. Practice shows
  an incorrect sample choice and its explanation; the assessment shows the question
  alongside timing/review policy; the invitation reuses it before the private sample
  leaderboard. Nothing claims automatic source references establish factual truth.
- The closing headline is shorter, Back to top has a 44px target, and responsive
  layouts are authored for 1440, 1024, 768, 390 and 320px. The two-column tablet
  composition becomes a single compact question below 600px.
- Landing CSS now has one base and one coherent section per breakpoint, replacing
  accumulated overrides. Obsolete hero-paper/preview/review styles were removed.
  Styles remain scoped by landing classes; no workspace theme changes were made.
- Motion is short paper/type arrival, state transition and control feedback. Content
  is visible without observers; reduced motion removes animation and smooth travel.

No new dependencies, backend changes, database migration, real quiz persistence or
live Gemini calls were introduced. The unrelated Account.tsx edit was preserved.

## Two visual review passes

### Round 1

Seen in one second: academic notes become a question you can inspect and try.
Idea: the source passage becomes a reviewed question, then branches into real uses.
Live thing: local source disclosure, wording edit and question/feedback sequence.
Layout words: hero=editorial spread / bank=selection with branches /
practice=explanation / assessment=margin notes / challenge=invitation with ranking /
FAQ=native disclosures / footer=compact close.

The first screenshots identified three concrete problems:

1. `round1/390-hero.jpg`: a generic review heading repeated the question below it,
   pushing the actual question to 572px. Make the question itself the heading.
2. `round1/320-footer.jpg`: the closing headline broke across three lines. Replace
   it with "Put your notes / to work."
3. `round1/1440-challenges.jpg`: the invitation left a large empty band and did not
   visibly connect to the recurring question. Show the bank question in the
   invitation and anchor its participation conditions at the foot.

### Round 2

Seen in one second: a question you can trace to a passage, then put to work.
Idea and live thing are retained. The question is now the first substantive text
in the mobile sample; the closing is two lines; the challenge visibly carries the
same question as the course and practice examples.

The source/answer states, all major sections, fixed navigation and footer were
reviewed at the requested widths. The recurring question supplies continuity while
the specimens show different outcomes. No photography or footage was added: the
user explicitly requested the product as the primary visual material.

Remaining visual limits: this is an editorial product page, not a cinematic site;
the long explanatory course/FAQ sections still make a substantial mobile scroll.
Those sections carry real permission/privacy details. Do not remove them merely
to make the page shorter. A commissioning price is not an objective quality metric.

## Mobile performance

Same measurement harness as Milestone 1: production Vite preview, fresh foreground
Chromium profile per trial, cache disabled, 390×844, 4× CPU slowdown, 100ms latency
and 400000 bytes/s upload/download. Three cold trials. No test/build processes ran
during these trials. LCP remained the headline `hero-title`.

| Metric | Milestone 1 | Milestone 2 |
| --- | --- | --- |
| LCP trials, ms | 5144, 5628, 5096 | 2848, 2380, 2460 |
| Median LCP | 5144ms | 2460ms |
| Median layout CPU | 1931ms | 341ms |
| Measured CLS | 0 | 0 |
| Initial JavaScript, gzip | 101.64kB | ~101.31kB |
| CSS, gzip | 11.49kB | ~10.84kB |

The local median LCP improved approximately 52%. Removing the duplicate specimen
and simplifying display/layout work accompanies a large measured reduction in
layout CPU. This does not isolate every change's causal effect. Font preloading is
retained; no speculative offscreen rendering is used. These are local synthetic
results, not deployment field measurements or a guaranteed 2.46s load on phones.

At 390px the sample action starts at approximately 684px down the document, versus
2632px in the original audit (about 74% earlier). At 320px it starts near 694px.
The initial page is approximately 5754px tall at 1440px and 7191px at 390px, versus
the audit's 7332px and 8861px respectively. Heights vary with font/viewport state.

## Evidence locations

Before: `.taste-skill/milestone1/` (initial, full and feedback screenshots).
First visual pass: `.taste-skill/milestone2/round1/`.
Second visual pass: `.taste-skill/milestone2/round2/`.
Each round has hero, source, answer, bank, practice, assessment, challenge and footer
screenshots at all five widths, plus full-page captures and geometry JSON.
Final interaction/accessibility captures: `.taste-skill/milestone2/verification/`.
Cold performance JSON: `.taste-skill/milestone2/perf-after.json`.
Artifacts are ignored local files; no private material appears in the examples.

## Final verification

- 56 API unit tests, 72 frontend tests and all 125 isolated PostgreSQL integration
  tests passed. Tests ran sequentially with one file worker; concurrency assertions
  inside the database tests remain concurrent. The temporary cluster shut down
  cleanly. The existing pg concurrent-query deprecation warning remains.
- Repository TypeScript, lint and both production builds passed. The frontend build
  also passed after the final caption cleanup. No dependencies or lockfiles changed.
- Chromium navigation, editing, answering, submission focus and lecturer signup
  intent checks passed at 1440, 1024, 768, 390 and 320px. No horizontal overflow or
  uncaught browser exceptions appeared. Anchors land 24px below the fixed bar.
- Keyboard-only Space opens the source disclosure; Enter starts editing and focuses
  the textarea; Escape closes a focused mobile menu and returns focus; the skip
  link reaches main content. These checks passed at all five widths. Submission
  focuses feedback and the next Tab reaches Back to question review.
- Axe reported zero WCAG A/AA violations in initial, source-expanded and submitted
  states at all five widths. Contrast in layered specimens still requires manual
  review: the retained dark/light text and accent pairs meet AA for their uses;
  disabled options are explicitly disabled. No NVDA/VoiceOver listening session
  was performed. Reduced motion leaves no running page animations or smooth scroll.
- The final landing-direction inspector at its supported 1440/768/390 viewports
  reports zero failures. Its four warnings are intentional product-only imagery,
  no video, text-edge margin heuristics (actual shell gutters are equal), and
  restrained motion (14 moving elements). The brief takes precedence over adding
  footage or extra motion just to satisfy a heuristic.
- An exploratory five-width inspector run used its default 320px-width fallback
  height of only 200px, causing unrepresentative blank-gap/UI-wrapper warnings.
  Narrow phones were separately checked at 320×900, with no overflow and readable
  interactive states. Final standard inspector sheets are in
  `.taste-skill/landing/milestone2-final/`.
- Two screenshot critiques are recorded in `.taste-skill/milestone2/critique.md`.
  The final subjective assessment is 7.8/10 versus the independent audit's 6.8/10;
  the recurring product specimens remain a familiar software-marketing device.
  This is a judgment of the visible result, not an award or price guarantee.
- Account.tsx has the same SHA-256 before and after this milestone. No unrelated
  account edits were rewritten, and no backend/authentication rules changed.

Remaining verification limits: real deployment LCP/compression/cache behavior,
Safari/Firefox and physical-device testing, and assistive-technology listening
tests. The page remains client-rendered. Measure field behavior before making
public speed claims; static prerendering remains a future investigation.

Nothing was committed or pushed. Stage 7 has not begun.
