import { useRef, useState } from 'react';
import { sample } from './demoContent';

export function QuizDemo() {
  const [stage, setStage] = useState<'review' | 'answer'>('review');
  const [question, setQuestion] = useState<string>(sample.question);
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  function move(next: 'review' | 'answer') {
    setStage(next);
    setEditing(false);
    setSubmitted(false);
    setAnswer(null);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <div className="lp-demo" data-ui>
      <div className="lp-demo-toolbar">
        <span>Interactive sample · prepared questions</span>
        <span>Runs in your browser</span>
      </div>
      <div className="lp-demo-columns">
        <article className={`lp-source ${sourceOpen ? 'source-active' : ''}`}>
          <div className="lp-document-top">
            <span>Computer science</span>
            <span>Study note</span>
          </div>
          <h3>{sample.title}</h3>
          <p>
            Imagine looking for a name in an alphabetically ordered list. You
            don’t need to read every entry.
          </p>
          <p>
            <mark>{sample.quote}</mark> Each comparison eliminates half of the
            remaining search interval.
          </p>
          <p>
            Look in the middle. Keep the half that could contain the answer.
            Repeat.
          </p>
          <div className="lp-source-reference">
            <span aria-hidden="true">↳</span>
            <span>One passage. A question you can trace back.</span>
          </div>
        </article>
        <div className="lp-demo-question">
          <div className="lp-demo-state">
            <span>
              {stage === 'review' ? 'Question review' : 'Personal practice'}
            </span>
            <span>1 question</span>
          </div>
          <div className="lp-demo-body" key={stage}>
            <h3 ref={heading} tabIndex={-1}>
              {stage === 'review'
                ? 'Make it your question.'
                : 'What do you think?'}
            </h3>
            {stage === 'review' ? (
              <>
                <p className="lp-demo-help">
                  Check the wording and its source before you try it.
                </p>
                {editing ? (
                  <label className="lp-demo-edit">
                    Question wording
                    <textarea
                      maxLength={200}
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                    />
                    <span>
                      Sample editing changes the wording; the answer key stays
                      the same.
                    </span>
                  </label>
                ) : (
                  <p className="lp-demo-prompt">{question}</p>
                )}
                <button
                  className="lp-text-button"
                  onClick={() => setEditing(!editing)}
                  disabled={editing && !question.trim()}
                >
                  {editing ? 'Keep wording' : 'Edit wording'}
                  <span aria-hidden="true">↗</span>
                </button>
                <button
                  className="lp-source-toggle"
                  aria-expanded={sourceOpen}
                  aria-controls="sample-evidence"
                  onClick={() => setSourceOpen(!sourceOpen)}
                >
                  <span>Inspect supporting source</span>
                  <span aria-hidden="true">{sourceOpen ? '−' : '+'}</span>
                </button>
                <div
                  id="sample-evidence"
                  hidden={!sourceOpen}
                  className="lp-evidence"
                >
                  <blockquote>“{sample.quote}”</blockquote>
                  <p>
                    From the study note shown here. Check the meaning as well as
                    the match.
                  </p>
                </div>
                <button
                  className="lp-button lp-button-dark"
                  disabled={!question.trim()}
                  onClick={() => move('answer')}
                >
                  Try this question<span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (answer !== null) setSubmitted(true);
                }}
              >
                <fieldset disabled={submitted} className="lp-demo-options">
                  <legend>{question}</legend>
                  {sample.options.map((option, index) => (
                    <label
                      key={option}
                      className={`lp-demo-option ${answer === index ? 'selected' : ''} ${submitted && index === sample.correct ? 'correct' : ''}`}
                    >
                      <input
                        type="radio"
                        name="sample-answer"
                        value={index}
                        checked={answer === index}
                        onChange={() => setAnswer(index)}
                      />
                      <span>{option}</span>
                      {submitted && index === sample.correct ? (
                        <span className="lp-correct-label">Correct</span>
                      ) : null}
                    </label>
                  ))}
                </fieldset>
                <div role="status" aria-live="polite">
                  {submitted ? (
                    <div className="lp-demo-feedback">
                      <strong>
                        {answer === sample.correct
                          ? 'Exactly. Order makes it work.'
                          : 'The key is sorted input.'}
                      </strong>
                      <p>{sample.explanation}</p>
                      <p className="lp-demo-help">
                        Sample complete. No attempt was saved.
                      </p>
                    </div>
                  ) : null}
                </div>
                {!submitted ? (
                  <button
                    className="lp-button lp-button-dark"
                    type="submit"
                    disabled={answer === null}
                  >
                    Check answer<span aria-hidden="true">→</span>
                  </button>
                ) : null}
                <button
                  className="lp-text-button"
                  type="button"
                  onClick={() => move('review')}
                >
                  Back to question review<span aria-hidden="true">↗</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
