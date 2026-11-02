import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from './PracticeUi';
import { safeError, timerLabel } from './format';
import type { QuizAttempt, QuizSummary } from './types';

export function QuizInstructions() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: ['practice', 'quiz', quizId],
    queryFn: () => api<QuizSummary>(`/quizzes/${quizId}`),
    retry: false,
  });
  async function start() {
    setPending(true);
    setError(null);
    try {
      const attempt = await api<QuizAttempt>(`/quizzes/${quizId}/attempts`, {
        method: 'POST',
        body: '{}',
      });
      navigate(
        `/practice/attempts/${attempt.id}${attempt.status === 'IN_PROGRESS' ? '' : '/result'}`,
      );
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }
  if (query.isPending) return <p role="status">Loading quiz instructions…</p>;
  if (query.error)
    return (
      <PracticeError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const quiz = query.data;
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to="/practice">Personal practice</Link> / Instructions
          </p>
          <h1>{quiz.title}</h1>
          {quiz.description ? (
            <p className="muted preserve-lines">{quiz.description}</p>
          ) : null}
        </div>
        <span className="status neutral">Personal practice</span>
      </div>
      <div className="instructions-layout">
        <section className="panel">
          <h2>Before you begin</h2>
          <dl className="detail-list instruction-facts">
            <div>
              <dt>Questions</dt>
              <dd>{quiz.questionCount} multiple-choice questions</dd>
            </div>
            <div>
              <dt>Timing</dt>
              <dd>{timerLabel(quiz.timeLimitSeconds)}</dd>
            </div>
            <div>
              <dt>Scoring</dt>
              <dd>
                One mark per correct answer. Unanswered questions receive zero.
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>Answers and explanations appear after you submit.</dd>
            </div>
          </dl>
        </section>
        <div className="instructions-aside">
          <h2>Make it your own pace</h2>
          <p className="muted">
            Answers save as you choose them. You can move between questions and
            return to a saved attempt.
          </p>
          <p className="muted">
            {quiz.timeLimitSeconds
              ? 'Your timer continues during disconnections. When time ends, your saved answers are graded.'
              : 'There is no timer. Resume your attempt whenever you’re ready.'}
          </p>
          <p className="field-hint">
            Starting again resumes an unfinished attempt. After submission you
            can take a new attempt without changing earlier results.
          </p>
          {quiz.status === 'DRAFT' ? (
            <Link className="button secondary" to={`/practice/${quiz.id}/edit`}>
              Continue editing draft
            </Link>
          ) : (
            <button
              className="button primary"
              onClick={() => {
                void start();
              }}
              disabled={pending}
            >
              {pending ? 'Opening attempt…' : 'Start or resume practice'} ↗
            </button>
          )}
          {error ? <PracticeError error={error} /> : null}
        </div>
      </div>
    </>
  );
}
