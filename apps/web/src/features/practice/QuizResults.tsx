import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from './PracticeUi';
import { duration, safeError } from './format';
import type { QuizResult, QuizSummary } from './types';

export function QuizResults({ academic = false }: { academic?: boolean }) {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: ['practice', 'result', attemptId],
    queryFn: () => api<QuizResult>(`/attempts/${attemptId}/result`),
    retry: false,
    refetchInterval: academic ? 15000 : false,
  });
  async function retryIncorrect() {
    setPending(true);
    setError(null);
    try {
      const quiz = await api<QuizSummary>(
        `/attempts/${attemptId}/retry-incorrect`,
        { method: 'POST', body: '{}' },
      );
      await client.invalidateQueries({ queryKey: ['practice', 'list'] });
      navigate(`/practice/${quiz.id}/edit`);
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }
  if (query.isPending) return <p role="status">Preparing your results…</p>;
  if (query.error)
    return (
      <>
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
        <Link
          to={`${academic ? '/attempts' : '/practice/attempts'}/${attemptId}`}
        >
          Return to attempt
        </Link>
      </>
    );
  const result = query.data;
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to={academic ? '/courses' : '/practice/history'}>
              {academic ? 'My courses' : 'Practice history'}
            </Link>{' '}
            / Attempt {result.attemptNumber}
          </p>
          <h1>{result.title}</h1>
          <p className="muted">
            {result.status === 'EXPIRED'
              ? 'Time ended. Your saved answers have been graded.'
              : academic ? 'Assessment submitted. Your score is recorded.' : 'Practice complete. Take a moment to review.'}
          </p>
        </div>
        <span className="status neutral">Results</span>
      </div>
      <dl className="result-summary">
        <div className="result-percentage">
          <dt>Your score</dt>
          <dd>{result.percentage}%</dd>
        </div>
        <div>
          <dt>Correct answers</dt>
          <dd>
            {result.correctAnswers}
            <span> / {result.totalQuestions}</span>
          </dd>
        </div>
        <div>
          <dt>Incorrect or unanswered</dt>
          <dd>{result.incorrectAnswers}</dd>
        </div>
        <div>
          <dt>Time taken</dt>
          <dd>{duration(result.durationSeconds)}</dd>
        </div>
      </dl>
      <div className="result-actions">
        {academic ? (
          <>
            <Link
              className="button secondary"
              to={`/assessments/${result.quizId}`}
            >
              Assessment details
            </Link>
            <Link to={`/courses/${result.courseId}`}>Back to course</Link>
          </>
        ) : (
          <>
            <Link className="button primary" to={`/practice/${result.quizId}`}>
              Retake quiz ↗
            </Link>
            <button
              className="button secondary"
              onClick={() => {
                void retryIncorrect();
              }}
              disabled={pending || result.incorrectAnswers === 0}
            >
              {pending ? 'Creating draft…' : 'Practise incorrect questions'}
            </button>
            <Link to="/practice/history">View history</Link>
          </>
        )}
      </div>
      {error ? <PracticeError error={error} /> : null}
      {result.reviewAvailable === false ? (
        <section className="panel">
          <h2>Answer review opens after closure</h2>
          <p className="muted">
            Your score is final. Correct answers and explanations remain private
            until the assessment closes
            {result.reviewReleaseAt
              ? ` (${new Date(result.reviewReleaseAt).toLocaleString()})`
              : ''}
            .
          </p>
          <button
            className="button secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            Check review availability
          </button>
        </section>
      ) : (
        <>
          <div className="review-heading">
            <h2>Question review</h2>
            <p className="field-hint">
              Correct answers and explanations for this attempt.
            </p>
          </div>
          <div className="question-reviews">
            {result.questions.map((question, index) => (
              <section className="review-question" key={question.id}>
                <div className="section-heading">
                  <h3>Question {index + 1}</h3>
                  <span
                    className={`status ${question.selectedOptionId === question.correctOptionId ? 'positive' : 'neutral'}`}
                  >
                    {question.selectedOptionId === question.correctOptionId
                      ? 'Correct'
                      : question.selectedOptionId
                        ? 'Incorrect'
                        : 'Unanswered'}
                  </span>
                </div>
                <p className="review-prompt preserve-lines">
                  {question.prompt}
                </p>
                <ul className="review-options">
                  {question.options.map((option, at) => (
                    <li
                      key={option.id}
                      className={
                        option.id === question.correctOptionId
                          ? 'review-correct'
                          : ''
                      }
                    >
                      <span className="option-letter">
                        {String.fromCharCode(65 + at)}
                      </span>
                      <span>{option.text}</span>
                      <span className="review-option-label">
                        {[
                          option.id === question.correctOptionId
                            ? 'Correct answer'
                            : null,
                          option.id === question.selectedOptionId
                            ? 'Your answer'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {question.explanation ? (
                  <div className="review-explanation">
                    <h3>Why this answer</h3>
                    <p className="muted preserve-lines">
                      {question.explanation}
                    </p>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
