import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';
import { useSession } from '../auth/session';
import { LandingNavigation } from './LandingNavigation';
import { QuizDemo } from './QuizDemo';
import { questions, sample } from './demoContent';
import './landing.css';

const steps = [
  { title: 'Add your notes', text: 'Your study material goes in.' },
  { title: 'Review the drafts', text: 'AI proposes questions. You edit and approve.' },
  { title: 'Keep the good ones', text: 'Reviewed questions join your private bank.' },
  { title: 'Use them your way', text: 'Practise, assess or challenge friends.' },
];

export function LandingPage() {
  const session = useSession();
  const page = useRef<HTMLDivElement>(null);
  const tilted = useRef<HTMLElement | null>(null);
  const canTilt = useRef(false);
  const [scrolled, setScrolled] = useState(false);
  const signedIn = !!session.data;
  const destination = signedIn ? '/dashboard' : '/register';

  useEffect(() => {
    const previous = document.title;
    document.title = 'AI Quiz — Turn notes into questions';
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries)
                if (entry.isIntersecting) {
                  entry.target.classList.add('lp-arrived');
                  observer?.unobserve(entry.target);
                }
            },
            { threshold: 0.12 },
          );
    page.current
      ?.querySelectorAll('[data-reveal]')
      .forEach((element) => observer?.observe(element));
    return () => {
      observer?.disconnect();
      document.title = previous;
    };
  }, []);

  // Header turns to glass once the page moves.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Paper sheets tilt toward a mouse pointer; off for touch and reduced motion.
  useEffect(() => {
    canTilt.current =
      typeof window.matchMedia === 'function' &&
      window.matchMedia(
        '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
      ).matches;
  }, []);

  const resetTilt = () => {
    const element = tilted.current;
    if (!element) return;
    element.style.removeProperty('--rx');
    element.style.removeProperty('--ry');
    tilted.current = null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canTilt.current || event.pointerType !== 'mouse') return;
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-tilt]');
    if (element !== tilted.current) resetTilt();
    if (!element) return;
    const box = element.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    element.style.setProperty('--ry', `${(x * 6).toFixed(2)}deg`);
    element.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`);
    tilted.current = element;
  };

  return (
    <div
      className="landing"
      ref={page}
      id="top"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
    >
      <a className="lp-skip" href="#landing-main">
        Skip to content
      </a>
      <div className="lp-rules" aria-hidden="true" />
      <div className={`lp-header-frame${scrolled ? ' is-scrolled' : ''}`}>
        <div className="lp-shell">
          <LandingNavigation signedIn={signedIn} />
        </div>
        <span className="lp-progress" aria-hidden="true" />
      </div>
      <main id="landing-main" tabIndex={-1}>
        <section className="lp-hero lp-shell" aria-labelledby="hero-title">
          <div className="lp-hero-heading">
            <h1 id="hero-title">
              Turn <mark className="lp-marker">notes</mark>{' '}
              <br />
              into questions.
            </h1>
            <div className="lp-hero-intro">
              <p>
                Create AI-assisted quizzes from your study material. Review the
                questions. Put your understanding to work.
              </p>
              <Link className="lp-button" to={destination}>
                {signedIn ? 'Open workspace' : 'Create your account'}
                <span aria-hidden="true">↗</span>
              </Link>
              <a className="lp-text-link" href="#review">
                Try a sample question<span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <div
            className="lp-hero-sample"
            id="review"
            tabIndex={-1}
            role="region"
            aria-label="Review and try a prepared question"
          >
            <p className="lp-annotation" aria-hidden="true">
              Highlights show where each question came from.
              <svg viewBox="0 0 56 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path pathLength={1} d="M6 4C30 2 50 14 46 40M38 33l8 9 6-11" />
              </svg>
            </p>
            <QuizDemo />
          </div>
          <div className="lp-demo-caption">
            <p>Authored sample: inspect, edit and answer here. Nothing is saved.</p>
          </div>
        </section>

        <section className="lp-flow-section lp-shell" aria-labelledby="flow-title">
          <h2 className="lp-visually-hidden" id="flow-title">
            How it works
          </h2>
          <ol className="lp-flow" data-reveal>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="lp-flow-index" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="lp-bank lp-shell lp-section"
          id="banks"
          tabIndex={-1}
          aria-labelledby="bank-title"
        >
          <div className="lp-bank-layout">
            <div>
              <h2 id="bank-title">
                Questions
                <br />
                worth keeping.
              </h2>
              <p>Reviewed once. Ready to use again.</p>
              <p className="lp-secondary">
                Keep a reviewed question in a private bank. Select it
                for a new quiz; each draft gets its own independent copy. Your
                bank stays yours.
              </p>
            </div>
            <figure data-reveal>
              <div className="lp-stack" data-tilt>
                <div className="lp-bank-sheet" data-ui>
                  <div className="lp-document-top">
                    <span>Your question bank</span>
                    <span>Private · Example</span>
                  </div>
                  <h3>Search &amp; sorting</h3>
                  <div className="lp-bank-row">
                    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="1.7" /></svg>
                    <div>
                      <strong>{sample.question}</strong>
                      <span>Algorithms · Medium</span>
                    </div>
                  </div>
                  <div className="lp-bank-row">
                    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="1.7" /></svg>
                    <div>
                      <strong>Which half of the interval remains?</strong>
                      <span>Algorithms · Medium</span>
                    </div>
                  </div>
                  <p className="lp-bank-selection">
                    Two reviewed questions. Three ways to use them.
                  </p>
                </div>
              </div>
              <figcaption>
                Illustrative private bank · edits never change published quizzes.
              </figcaption>
            </figure>
          </div>
          <nav className="lp-bank-destinations" aria-label="Ways to use a reviewed question">
            <a href="#practice">
              <span>For your understanding</span>
              <strong>Personal practice <span aria-hidden="true">↓</span></strong>
            </a>
            <a href="#teaching">
              <span>For your course</span>
              <strong>Official assessments <span aria-hidden="true">↓</span></strong>
            </a>
            <a href="#challenges">
              <span>For your friends</span>
              <strong>Private challenges <span aria-hidden="true">↓</span></strong>
            </a>
          </nav>
        </section>

        <section
          className="lp-practice lp-light-field"
          id="practice"
          tabIndex={-1}
          aria-labelledby="practice-title"
        >
          <div className="lp-shell lp-practice-layout">
            <div className="lp-practice-copy">
              <h2 id="practice-title">
                Make the next
                <br />
                attempt count.
              </h2>
              <p>
                Knowing the answer is a start. Understanding why is the point.
              </p>
              <p className="lp-secondary">
                Practise at your own pace, read the explanations, then build a
                new quiz from the questions you missed. Your earlier results
                stay in your history.
              </p>
              <Link className="lp-text-link" to={destination}>
                {signedIn ? 'Go to your workspace' : 'Start practising'}
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <figure className="lp-practice-example" data-reveal>
              <div className="lp-result-sheet" data-ui data-tilt>
                <div className="lp-document-top">
                  <span>Personal practice</span>
                  <span>Sample result</span>
                </div>
                <div className="lp-result-score">
                  <div className="lp-ring">
                    <strong>
                      4<span>/ 5</span>
                    </strong>
                  </div>
                  <p>
                    One question
                    <br />
                    worth another look.
                  </p>
                </div>
                <div className="lp-result-review">
                  <span className="lp-small-label">Question to revisit</span>
                  <h3>{sample.question}</h3>
                  <p className="lp-result-choice">Sample choice: no repeated values</p>
                  <p><strong>Correct answer: sorted input.</strong> Each comparison tells you which half of the search interval to keep.</p>
                  <span className="lp-result-action">
                    Next step: practise incorrect questions
                  </span>
                </div>
              </div>
              <figcaption>
                The same question, with a useful explanation. Illustrative result.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          className="lp-teaching lp-shell lp-section"
          id="teaching"
          tabIndex={-1}
          aria-labelledby="teaching-title"
        >
          <div className="lp-section-heading">
            <h2 id="teaching-title">
              Prepared for
              <br />
              your course.
            </h2>
            <div>
              <p>
                A reviewed question, now part of your course.
              </p>
              <p className="lp-secondary">
                Verified lecturers manage courses, enroll students and publish
                assessments with clear timing and attempt rules.
              </p>
            </div>
          </div>
          <div className="lp-teaching-layout">
            <div className="lp-teaching-notes">
              <div>
                <h3>Set the conditions.</h3>
                <p>
                  Choose the schedule, time limit and allowed attempts before
                  publishing.
                </p>
              </div>
              <div>
                <h3>See the outcome.</h3>
                <p>
                  Automatic grading and performance reports keep each completed
                  attempt in view.
                </p>
              </div>
              <p className="lp-secondary">
                Official assessment access requires lecturer verification.
              </p>
              <Link className="lp-text-link" to={signedIn ? '/dashboard' : '/register?role=LECTURER'}>
                {signedIn ? 'Open workspace' : 'Create a lecturer account'}
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <figure className="lp-assessment-example" data-reveal>
              <div className="lp-assessment-sheet" data-ui data-tilt>
                <div className="lp-document-top">
                  <span>CSC 201 · Sample course</span>
                  <span className="lp-pill">Published</span>
                </div>
                <h3>Search &amp; sorting</h3>
                <p>Course assessment</p>
                <dl className="lp-assessment-settings">
                  <div>
                    <dt>Questions</dt>
                    <dd>10</dd>
                  </div>
                  <div>
                    <dt>Time limit</dt>
                    <dd>20 min</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>1</dd>
                  </div>
                </dl>
                <div className="lp-assessment-schedule">
                  <span>Scheduled window</span>
                  <strong>Monday, 9:00–11:00</strong>
                  <div className="lp-window" aria-hidden="true">
                    <span />
                  </div>
                  <div className="lp-window-scale" aria-hidden="true">
                    <span>8:00</span>
                    <span>12:00</span>
                  </div>
                  <p>Students enter through their enrolled course.</p>
                </div>
                <div className="lp-assessment-note">
                  <span className="lp-small-label">Includes a reviewed question</span>
                  <p>{sample.question}</p>
                  Scores after submission.
                  <br />
                  Answer review after assessment closure.
                </div>
              </div>
              <figcaption>
                A sample assessment with a defined window and one attempt.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          className="lp-challenges"
          id="challenges"
          tabIndex={-1}
          aria-labelledby="challenges-title"
        >
          <div className="lp-shell">
            <div className="lp-challenge-heading">
              <h2 id="challenges-title">
                A challenge
                <br />
                between friends.
              </h2>
              <div>
                <p>
                  The same questions.
                  <br />A challenge on your own time.
                </p>
                <p className="lp-secondary">
                  Share an invitation, let friends take their one attempt, then
                  see how the scores compare. Everyone can review their answers
                  after the challenge closes.
                </p>
              </div>
            </div>
            <figure className="lp-challenge-example" data-reveal>
              <div className="lp-invitation-example" data-ui data-tilt>
                <span>Friends challenge · Example</span>
                <h3>Search party</h3>
                <p>
                  A few questions.
                  <br />A few friends.
                </p>
                <p className="lp-invitation-question">
                  <span>From your question bank</span>
                  {sample.question}
                </p>
                <div>
                  <span>Invitation-only</span>
                  <span>One attempt each</span>
                </div>
              </div>
              <div className="lp-leaderboard-example" data-ui>
                <div className="lp-document-top">
                  <span>Search party</span>
                  <span>Closed</span>
                </div>
                <table>
                  <caption>
                    Sample leaderboard · illustrative names and scores
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Student</th>
                      <th scope="col">Score</th>
                      <th scope="col">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="is-top">
                      <td>1</td>
                      <th scope="row">Ada</th>
                      <td>5 / 5</td>
                      <td>1:24</td>
                    </tr>
                    <tr className="is-top">
                      <td>1</td>
                      <th scope="row">Tunde</th>
                      <td>5 / 5</td>
                      <td>1:24</td>
                    </tr>
                    <tr>
                      <td>3</td>
                      <th scope="row">Zara</th>
                      <td>4 / 5</td>
                      <td>1:32</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  Score first. Completion time next.
                  <br />
                  Exact ties share a rank.
                </p>
              </div>
            </figure>
            <div className="lp-challenge-foot">
              <p>
                Asynchronous. Private to the challenge.
                <br />
                Creators set it up; friends take part.
              </p>
              <Link className="lp-text-link" to={destination}>
                {signedIn ? 'Open workspace' : 'Create your first challenge'}
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="lp-faq lp-light-field" aria-labelledby="faq-title">
          <div className="lp-shell lp-faq-layout">
            <div>
              <h2 id="faq-title">
                Before
                <br />
                you begin.
              </h2>
              <p>A few useful things to know.</p>
            </div>
            <div className="lp-faq-questions">
              {questions.map((item) => (
                <details key={item.question}>
                  <summary>
                    {item.question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section
          className="lp-closing lp-shell"
          aria-labelledby="closing-title"
        >
          <div className="lp-closing-panel" data-reveal>
            <h2 id="closing-title">
              Put your <mark className="lp-marker">notes</mark>
              <br />
              to work.
            </h2>
            <div className="lp-closing-actions">
              <Link className="lp-button" to={destination}>
                {signedIn ? 'Open workspace' : 'Create your account'}
                <span aria-hidden="true">↗</span>
              </Link>
              <p>
                For university students and lecturers, aged 18+.
                <br />
                {signedIn ? (
                  'Your next question is waiting in your workspace.'
                ) : (
                  <>
                    Already have an account? <Link to="/login">Sign in</Link>.
                  </>
                )}
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-shell">
        <Brand />
        <p>Learning starts with a question.</p>
        <a href="#top">
          Back to top <span aria-hidden="true">↑</span>
        </a>
      </footer>
    </div>
  );
}