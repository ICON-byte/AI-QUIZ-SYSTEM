import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from './PracticeUi';
import { safeError, timerLabel } from './format';
import type { QuizAttempt, QuizSummary } from './types';

export function QuizInstructions({ academic = false }: { academic?: boolean }) {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: ['practice', 'quiz', quizId],
    queryFn: () =>
      api<
        QuizSummary & {
          serverNow?: string;
          courseArchived?: boolean;
          attempts?: { id: string; status: string; attemptNumber: number }[];
        }
      >(academic ? `/assessments/${quizId}` : `/quizzes/${quizId}`),
    retry: false,
    refetchInterval: academic ? 15000 : false,
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
        `${academic ? '/attempts' : '/practice/attempts'}/${attempt.id}${attempt.status === 'IN_PROGRESS' ? '' : '/result'}`,
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
  const existingActive = quiz.attempts?.some(
    (attempt) => attempt.status === 'IN_PROGRESS',
  );
  const now = Date.parse(quiz.serverNow ?? '');
  const unavailable =
    !!quiz.closedAt ||
    !!quiz.courseArchived ||
    !!(quiz.opensAt && Date.parse(quiz.opensAt) > now) ||
    !!(quiz.closesAt && Date.parse(quiz.closesAt) <= now) ||
    (quiz.attempts?.length ?? 0) >= (quiz.maxAttempts ?? 1);
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to={academic ? `/courses/${quiz.courseId}` : '/practice'}>
              {academic ? 'Course assessments' : 'Personal practice'}
            </Link>{' '}
            / Instructions
          </p>
          <h1>{quiz.title}</h1>
          {quiz.description ? (
            <p className="muted preserve-lines">{quiz.description}</p>
          ) : null}
        </div>
        <span className="status neutral">
          {academic ? 'Official assessment' : 'Personal practice'}
        </span>
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
              <dd>
                {academic
                  ? 'Scores appear after submission. Answers and explanations appear only after the assessment closes.'
                  : 'Answers and explanations appear after you submit.'}
              </dd>
            </div>
          </dl>
          {academic ? (
            <dl className="detail-list instruction-facts">
              <div>
                <dt>Opens</dt>
                <dd>
                  {quiz.opensAt
                    ? new Date(quiz.opensAt).toLocaleString()
                    : 'On publication'}
                </dd>
              </div>
              <div>
                <dt>Closes</dt>
                <dd>
                  {quiz.closesAt
                    ? new Date(quiz.closesAt).toLocaleString()
                    : 'Not scheduled'}
                </dd>
              </div>
              <div>
                <dt>Attempt limit</dt>
                <dd>
                  {quiz.maxAttempts} total · {quiz.attempts?.length ?? 0} used
                </dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>
                  {quiz.closedAt ||
                  quiz.courseArchived ||
                  (quiz.closesAt &&
                    Date.parse(quiz.closesAt) <=
                      Date.parse(quiz.serverNow ?? ''))
                    ? 'Closed'
                    : quiz.opensAt &&
                        Date.parse(quiz.opensAt) >
                          Date.parse(quiz.serverNow ?? '')
                      ? 'Scheduled'
                      : 'Open'}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
        <div className="instructions-aside">
          <h2>{academic ? 'Before you start' : 'Make it your own pace'}</h2>
          <p className="muted">
            Answers save as you choose them. You can move between questions and
            return to a saved attempt.
          </p>
          <p className="muted">
            {academic
              ? 'The timer and assessment closing time are enforced by the server. Leaving the page does not pause the deadline.'
              : quiz.timeLimitSeconds
                ? 'Your timer continues during disconnections. When time ends, your saved answers are graded.'
                : 'There is no timer. Resume your attempt whenever you’re ready.'}
          </p>
          <p className="field-hint">
            {academic
              ? 'Starting again resumes an unfinished attempt. Each new attempt counts toward the published limit.'
              : 'Starting again resumes an unfinished attempt. After submission you can take a new attempt without changing earlier results.'}
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
              disabled={pending || (academic && !existingActive && unavailable)}
            >
              {pending
                ? 'Opening attempt…'
                : academic
                  ? 'Start or resume assessment'
                  : 'Start or resume practice'}{' '}
              ↗
            </button>
          )}
          {error ? <PracticeError error={error} /> : null}
          {academic && quiz.attempts?.length ? (
            <section className="assessment-attempts">
              <h2>Your attempts</h2>
              {quiz.attempts.map((attempt) => (
                <p key={attempt.id}>
                  <Link
                    to={`/attempts/${attempt.id}${attempt.status === 'IN_PROGRESS' ? '' : '/result'}`}
                  >
                    Attempt {attempt.attemptNumber} ·{' '}
                    {attempt.status === 'IN_PROGRESS'
                      ? 'Resume'
                      : 'View result'}{' '}
                    ↗
                  </Link>
                </p>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
