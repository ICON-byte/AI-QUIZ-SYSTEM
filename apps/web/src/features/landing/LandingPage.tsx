import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';
import { useSession } from '../auth/session';
import { LandingNavigation } from './LandingNavigation';
import { QuizDemo } from './QuizDemo';
import { questions, sample } from './demoContent';
import './landing.css';

export function LandingPage() {
  const session = useSession();
  const page = useRef<HTMLDivElement>(null);
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

  return (
    <div className="landing" ref={page} id="top">
      <a className="lp-skip" href="#landing-main">
        Skip to content
      </a>
      <div className="lp-header-frame">
        <div className="lp-shell">
          <LandingNavigation signedIn={signedIn} />
        </div>
      </div>
      <main id="landing-main" tabIndex={-1}>
        <section className="lp-hero lp-shell" aria-labelledby="hero-title">
          <div className="lp-hero-heading">
            <h1 id="hero-title">
              Turn notes{' '}
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
          <figure
            className="lp-hero-figure"
            aria-label="Prepared example showing a study passage and a related question"
          >
            <div className="lp-hero-stage" data-ui>
              <article className="lp-hero-paper">
                <div className="lp-document-top">
                  <span>Computer science</span>
                  <span>Study note</span>
                </div>
                <h2>{sample.title}</h2>
                <p>
                  Finding one answer doesn’t have to mean reading every
                  possibility.
                </p>
                <p className="lp-hero-passage">
                  <mark>{sample.quote}</mark>
                  <br />
                  Each comparison eliminates half of the remaining search
                  interval.
                </p>
                <div className="lp-paper-foot">
                  <span>Read. Review. Make it yours.</span>
                  <span aria-hidden="true">↳</span>
                </div>
              </article>
              <article className="lp-hero-question">
                <div className="lp-document-top">
                  <span>From your material</span>
                  <span>Practice</span>
                </div>
                <h2>{sample.question}</h2>
                <div className="lp-preview-options">
                  {sample.options.map((option, index) => (
                    <div key={option}>
                      <span className="lp-option-letter" aria-hidden="true">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span>{option}</span>
                    </div>
                  ))}
                </div>
                <div className="lp-hero-citation">
                  <span aria-hidden="true">↳</span>
                  <p>
                    Connected to the passage.
                    <br />
                    <strong>Ready for your review.</strong>
                  </p>
                </div>
              </article>
            </div>
            <figcaption>
              <span>
                A prepared example of the source-to-question workflow.
              </span>
              <span>Topics · PDF · DOCX · TXT</span>
            </figcaption>
          </figure>
        </section>

        <section
          className="lp-review lp-shell lp-section"
          id="review"
          tabIndex={-1}
          aria-labelledby="review-title"
        >
          <div className="lp-section-heading" data-reveal>
            <h2 id="review-title">
              Review before
              <br />
              you use.
            </h2>
            <div>
              <p>
                AI gives you a starting point.
                <br />
                You make the final call.
              </p>
              <p className="lp-secondary">
                Inspect the passage, refine the wording, then answer the
                question. Try the process here.
              </p>
            </div>
          </div>
          <div data-reveal>
            <QuizDemo />
          </div>
          <p className="lp-demo-caption">
            This demonstration uses prepared content. Real AI generation starts
            with your topic or reviewed text and requires your review before
            use.
          </p>
        </section>

        <section
          className="lp-practice lp-light-field"
          id="practice"
          tabIndex={-1}
          aria-labelledby="practice-title"
        >
          <div className="lp-shell lp-practice-layout">
            <div className="lp-practice-copy" data-reveal>
              <h2 id="practice-title">
                Make the next
                <br />
                attempt count.
              </h2>
              <p>
                Find the gap between recognising an answer and understanding it.
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
              <div className="lp-result-sheet" data-ui>
                <div className="lp-document-top">
                  <span>Personal practice</span>
                  <span>Sample result</span>
                </div>
                <div className="lp-result-score">
                  <strong>
                    4<span>/ 5</span>
                  </strong>
                  <p>
                    One question
                    <br />
                    worth another look.
                  </p>
                </div>
                <div className="lp-result-review">
                  <span className="lp-small-label">Question to revisit</span>
                  <h3>Why must the input be sorted?</h3>
                  <p>
                    So each comparison tells you which half of the search
                    interval to keep.
                  </p>
                  <span className="lp-result-action">
                    Practise incorrect questions{' '}
                    <span aria-hidden="true">↗</span>
                  </span>
                </div>
              </div>
              <figcaption>
                Illustrative result. Explanations turn a score into a next step.
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
          <div className="lp-section-heading" data-reveal>
            <h2 id="teaching-title">
              Prepared for
              <br />
              your course.
            </h2>
            <div>
              <p>
                From a considered question
                <br />
                to an official assessment.
              </p>
              <p className="lp-secondary">
                Verified lecturers manage courses, enroll students and publish
                assessments with clear timing and attempt rules.
              </p>
            </div>
          </div>
          <div className="lp-teaching-layout">
            <div className="lp-teaching-notes" data-reveal>
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
              <Link className="lp-text-link" to={destination}>
                {signedIn ? 'Open workspace' : 'Create a lecturer account'}
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <figure className="lp-assessment-example" data-reveal>
              <div className="lp-assessment-sheet" data-ui>
                <div className="lp-document-top">
                  <span>CSC 201 · Sample course</span>
                  <span>Published</span>
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
                  <p>Students enter through their enrolled course.</p>
                </div>
                <div className="lp-assessment-note">
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
            <div className="lp-challenge-heading" data-reveal>
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
              <div className="lp-invitation-example" data-ui>
                <span>Friends challenge · Example</span>
                <h3>Search party</h3>
                <p>
                  A few questions.
                  <br />A few friends.
                  <br />
                  Something to talk about.
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
                    <tr>
                      <td>1</td>
                      <th scope="row">Ada</th>
                      <td>5 / 5</td>
                      <td>1:24</td>
                    </tr>
                    <tr>
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

        <section
          className="lp-bank lp-shell lp-section"
          aria-labelledby="bank-title"
        >
          <div className="lp-bank-layout">
            <div data-reveal>
              <h2 id="bank-title">
                Questions
                <br />
                worth keeping.
              </h2>
              <p>A good question can do more than one job.</p>
              <p className="lp-secondary">
                Save reviewed questions in your private banks. Bring them into
                your next practice quiz, assessment or challenge without
                starting again.
              </p>
            </div>
            <figure data-reveal>
              <div className="lp-bank-sheet" data-ui>
                <div className="lp-document-top">
                  <span>Your question bank</span>
                  <span>Private · Example</span>
                </div>
                <h3>Search &amp; sorting</h3>
                <div className="lp-bank-row">
                  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="1.7" /></svg>
                  <div>
                    <strong>What does binary search require?</strong>
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
                <div className="lp-bank-selection">
                  <span>2 questions selected</span>
                  <span>Ready for a new draft ↗</span>
                </div>
              </div>
              <figcaption>
                Selected questions become independent copies in a draft.
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="lp-faq lp-light-field" aria-labelledby="faq-title">
          <div className="lp-shell lp-faq-layout">
            <div data-reveal>
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
          <div data-reveal>
            <h2 id="closing-title">
              Start with
              <br />
              what you’re studying.
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
