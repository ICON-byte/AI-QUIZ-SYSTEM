# Landing refinement — Milestone 1

6 November 2026. The Annotated Page composition is retained. Milestone 2 remains
subject to approval. No backend, database, quiz-engine or provider changes.

## Changes

- Preload the existing Instrument Sans Latin variable WOFF2 from HTML. Vite emits
  the same hashed asset referenced by the existing font CSS; anonymous CORS lets
  the font request be reused. Keep `font-display: swap` and extended-Latin coverage.
- The lecturer CTA uses `/register?role=LECTURER`. Registration accepts only a
  single exact `LECTURER` hint as an initial choice. Other/duplicate values fall
  back to Student. The visitor can change roles; server validation, eligibility,
  lecturer verification and the restricted invitation return remain unchanged.
- Focus the wording textarea when editing starts and a named feedback region
  after submission. Retain polite status announcements and native radio controls.
- Remove link-like arrows from static practice/bank examples and use descriptive
  status wording. These examples do not simulate saved data or real actions.

## Performance method and results

Production Vite preview, foreground Chromium, fresh temporary browser profile per
trial, cache disabled, 390 × 844 CSS pixels, 4× CPU slowdown, 100ms network latency,
400000 bytes/s upload/download. Three trials per variant, interleaved for the
baseline experiments. Headline `hero-title` was the LCP element throughout.
No builds or test suites ran during the retained performance trials.

| Variant | LCP trials (ms) | Median (ms) | Median layout CPU (ms) |
| --- | --- | --- | --- |
| Baseline | 5296, 5688, 5976 | 5688 | 3444 |
| Runtime font preload experiment | 4448, 3632, 4660 | 4448 | 1556 |
| Preload + offscreen containment experiment | 3228, 3588, 5384 | 3588 | 1588 |
| Shipped production build | 5144, 5628, 5096 | 5144 | 1931 |

The production median improvement is approximately 9.6%, with zero measured CLS
(baseline approximately 0.00005). Font discovery moved from 2347–2959ms to
200–319ms; final font responses ended by 559–700ms. The initial JavaScript remains
approximately 101.64kB gzip, versus 101.53kB before.

An earlier exploratory set included an invalid zero-LCP observation; that set was
excluded and the full comparison repeated with explicit page foregrounding.

Selective `content-visibility: auto` with estimated section heights was evaluated
but **not shipped**. It did not consistently reduce layout CPU relative to preload
alone, and its LCP range overlapped broadly. Estimated heights also introduce anchor
and scrolling risks. Do not infer a reliable additional gain from its lower median.
Preloading removes late-font relayout work without changing section dimensions.

These are noisy local synthetic measurements, not production field results or a
claim that LCP is solved. The remaining client-rendered initial page, script work
and headline/layout cost warrant further measurement after the approved visual
work. Static prerendering is a possible later investigation, not part of this change.

Raw browser reports and screenshots are local, ignored artifacts in
`.taste-skill/milestone1/`. Re-run measurements on the deployment with real content
encoding and caching before making user-facing performance claims.

## Verification

- 56 API unit tests, 72 frontend tests and 125 PostgreSQL integration tests passed.
  The first overlapping verification runs had assertion/transaction timeouts.
  All suites passed when repeated with one test-file worker, without relaxing
  assertions, deadlines or test timeouts. PostgreSQL still emitted its existing
  concurrent-query deprecation warning. The temporary cluster was shut down.
- Repository TypeScript, lint and both production builds passed.
- Production Chromium checks passed at 1440, 768, 390 and 320px: no horizontal
  overflow; all four navigation targets land 24px below the fixed header; mobile
  navigation closes and transfers focus. Long smooth scrolls need to settle before
  geometry assertions; reduced-motion scrolling remains immediate.
- Editing focuses the textarea; submission focuses feedback; the next Tab reaches
  Back to question review. Real radio-keyboard input and the lecturer CTA's editable
  role selection were exercised. Authentication responses were mocked in-browser;
  no Gemini requests were made.
- Axe reported zero WCAG A/AA violations in initial and submitted states at all
  four widths. Its contrast rule leaves layered specimen details for manual review;
  this is not a claim of full screen-reader certification. Reduced motion leaves
  no running page animations.
- The landing-direction inspector reported zero failures and four existing
  warnings: no photos/video (the approved concept uses product specimens), a
  text-edge margin heuristic (the actual shell margins are equal), and mobile type
  size variety (reserved for Milestone 2). Visual quality remains approximately
  the audit's 6.8/10: this milestone corrects loading and interactions, not the
  repetitive narrative, hero tracking or delayed mobile demo.

Screenshots: `.taste-skill/milestone1/{1440,768,390,320}-initial.jpg`, `-full.jpg`
and `-feedback.jpg`, plus `registration-hint.jpg`. Full design-inspector sheets:
`.taste-skill/landing/milestone1-inspection/`. Browser measurements and raw timing
JSON are in `.taste-skill/milestone1/`. These are ignored local review artifacts.

No dependencies were added, no migration is required, and nothing was committed
or pushed. Milestone 2 and Stage 7 have not begun.
