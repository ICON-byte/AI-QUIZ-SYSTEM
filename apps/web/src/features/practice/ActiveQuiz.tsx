import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { PracticeError } from './PracticeUi';
import { duration, safeError } from './format';
import { useLeaveWarning } from './useLeaveWarning';
import type { QuizAttempt, SavedAnswer } from './types';

type PendingAnswer = SavedAnswer & { error: Error | null };
type TimedAttempt = QuizAttempt & { receivedAt: number };

export function ActiveQuiz({ academic = false }: { academic?: boolean }) {
  const { attemptId } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const attemptPath = academic ? '/attempts' : '/practice/attempts';
  const [index, setIndex] = useState(0);
  const [pendingAnswer, setPendingAnswer] = useState<PendingAnswer | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [clock, setClock] = useState(() => performance.now());
  const key = ['practice', 'attempt', attemptId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => ({
      ...(await api<QuizAttempt>(`/attempts/${attemptId}`)),
      receivedAt: performance.now(),
    }),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const attempt = query.data;
  const remaining = attempt?.expiresAt
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(attempt.expiresAt) -
            Date.parse(attempt.serverNow) -
            Math.max(0, clock - attempt.receivedAt)) /
            1000,
        ),
      )
    : null;
  const expired = remaining === 0;
  useLeaveWarning(!!pendingAnswer);
  useEffect(() => {
    const interval = setInterval(() => setClock(performance.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const refetch = query.refetch;
  useEffect(() => {
    if (expired) void refetch();
  }, [expired, refetch]);

  async function saveAnswer(answer: SavedAnswer) {
    setPendingAnswer({ ...answer, error: null });
    setSaving(true);
    setError(null);
    await client.cancelQueries({
      queryKey: ['practice', 'attempt', attemptId],
    });
    try {
      const saved = await api<SavedAnswer>(
        `/attempts/${attemptId}/answers/${answer.questionId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            selectedOptionId: answer.selectedOptionId,
            revision: answer.revision,
          }),
        },
      );
      client.setQueryData<TimedAttempt>(
        ['practice', 'attempt', attemptId],
        (previous) =>
          previous
            ? {
                ...previous,
                answers: [
                  ...previous.answers.filter(
                    (item) => item.questionId !== saved.questionId,
                  ),
                  saved,
                ],
              }
            : previous,
      );
      setPendingAnswer(null);
    } catch (error) {
      setPendingAnswer({ ...answer, error: safeError(error) });
      if (error instanceof ApiError && error.status === 409)
        void query.refetch();
    } finally {
      setSaving(false);
    }
  }
  async function submit() {
    if (!attempt || pendingAnswer || saving) return;
    const answered = attempt.answers.filter(
      (answer) => answer.selectedOptionId !== null,
    ).length;
    if (
      !window.confirm(
        `Submit your attempt? ${attempt.questions.length - answered} question(s) are unanswered. You cannot change answers after submission.`,
      )
    )
      return;
    setSubmitting(true);
    setError(null);
    try {
      await api<QuizAttempt>(`/attempts/${attemptId}/submit`, {
        method: 'POST',
        body: '{}',
      });
      await client.invalidateQueries({ queryKey: ['practice', 'history'] });
      navigate(`${attemptPath}/${attemptId}/result`, { replace: true });
    } catch (error) {
      setError(safeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (query.isPending) return <p role="status">Resuming your practice…</p>;
  if (!attempt)
    return (
      <PracticeError
        error={query.error ?? new Error('Attempt unavailable.')}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (attempt.status !== 'IN_PROGRESS')
    return <Navigate to={`${attemptPath}/${attemptId}/result`} replace />;
  const currentIndex = Math.min(index, attempt.questions.length - 1);
  const question = attempt.questions[currentIndex]!;
  const saved = attempt.answers.find(
    (answer) => answer.questionId === question.id,
  );
  const selected =
    pendingAnswer?.questionId === question.id
      ? pendingAnswer.selectedOptionId
      : (saved?.selectedOptionId ?? null);
  const answeredCount = attempt.answers.filter(
    (answer) => answer.selectedOptionId !== null,
  ).length;
  const blocked = !!pendingAnswer || saving || submitting || expired;

  return (
    <>
      <div className="practice-heading attempt-heading">
        <div>
          <p className="context-label">
            {academic ? 'Official assessment' : 'Personal practice'} / Attempt{' '}
            {attempt.attemptNumber}
          </p>
          <h1>{attempt.title}</h1>
          <p className="muted">
            Question {currentIndex + 1} of {attempt.questions.length}
          </p>
        </div>
        <div
          className={`attempt-timer ${remaining !== null && remaining < 60 ? 'timer-warning' : ''}`}
        >
          <span>
            {remaining === null ? 'At your own pace' : 'Time remaining'}
          </span>
          <strong
            aria-label={remaining === null ? 'No time limit' : 'Time remaining'}
          >
            {remaining === null ? 'Untimed' : duration(remaining)}
          </strong>
        </div>
      </div>
      {query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      <div className="taking-layout">
        <section className="taking-question">
          <div className="taking-question-header">
            <span className="context-label">Question {currentIndex + 1}</span>
            <span className="save-status" role="status">
              {saving
                ? 'Saving answer…'
                : pendingAnswer?.error
                  ? 'Answer not saved'
                  : saved
                    ? 'Answer saved'
                    : 'Choose an answer'}
            </span>
          </div>
          <fieldset
            disabled={saving || submitting || !!pendingAnswer?.error || expired}
            className="taking-options"
          >
            <legend className="taking-prompt preserve-lines">
              {question.prompt}
            </legend>
            {question.options.map((option, at) => (
              <label
                key={option.id}
                className={`taking-option ${selected === option.id ? 'chosen' : ''}`}
              >
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value={option.id}
                  checked={selected === option.id}
                  onChange={() => {
                    void saveAnswer({
                      questionId: question.id,
                      selectedOptionId: option.id,
                      revision: saved?.revision ?? 0,
                    });
                  }}
                />
                <span className="option-letter">
                  {String.fromCharCode(65 + at)}
                </span>
                <span>{option.text}</span>
              </label>
            ))}
          </fieldset>
          <button
            className="clear-answer"
            disabled={blocked || selected === null}
            onClick={() => {
              void saveAnswer({
                questionId: question.id,
                selectedOptionId: null,
                revision: saved?.revision ?? 0,
              });
            }}
          >
            Clear answer
          </button>
          {pendingAnswer?.error ? (
            <div className="save-failure">
              <PracticeError error={pendingAnswer.error} />
              <p className="field-hint">
                Your selection is still here. Save it before moving on.
                Reloading discards this unsaved selection.
              </p>
              <div className="button-group">
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => {
                    void saveAnswer(pendingAnswer);
                  }}
                >
                  Retry saving answer
                </button>
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => {
                    if (
                      !window.confirm(
                        'Discard this unsaved selection and reload saved answers?',
                      )
                    )
                      return;
                    setPendingAnswer(null);
                    void query.refetch();
                  }}
                >
                  Reload saved answers
                </button>
              </div>
            </div>
          ) : null}
          <div className="question-navigation">
            <button
              className="button secondary"
              disabled={blocked || currentIndex === 0}
              onClick={() => setIndex(currentIndex - 1)}
            >
              Previous
            </button>
            <span>
              {currentIndex + 1} / {attempt.questions.length}
            </span>
            <button
              className="button secondary"
              disabled={
                blocked || currentIndex === attempt.questions.length - 1
              }
              onClick={() => setIndex(currentIndex + 1)}
            >
              Next question
            </button>
          </div>
        </section>
        <aside className="attempt-overview panel">
          <h2>Your progress</h2>
          <p className="muted">
            {answeredCount} of {attempt.questions.length} answered
          </p>
          <nav className="question-map" aria-label="Question navigation">
            {attempt.questions.map((item, at) => (
              <button
                key={item.id}
                className={`${at === currentIndex ? 'current' : ''} ${attempt.answers.some((answer) => answer.questionId === item.id && answer.selectedOptionId) ? 'answered' : ''}`}
                aria-label={`Go to question ${at + 1}${attempt.answers.some((answer) => answer.questionId === item.id && answer.selectedOptionId) ? ', answered' : ', unanswered'}`}
                aria-current={at === currentIndex ? 'step' : undefined}
                disabled={blocked}
                onClick={() => setIndex(at)}
              >
                {at + 1}
              </button>
            ))}
          </nav>
          <p className="field-hint">
            Filled numbers are answered. Your saved answers are kept if you
            leave.
          </p>
          {expired ? (
            <div role="status">
              <p>Time has ended. Checking your result…</p>
              <button
                className="button secondary"
                onClick={() => {
                  void query.refetch();
                }}
              >
                Check result
              </button>
            </div>
          ) : (
            <button
              className="button primary"
              disabled={blocked}
              onClick={() => {
                void submit();
              }}
            >
              {submitting ? 'Submitting…' : 'Submit attempt'}
            </button>
          )}
          <Link
            className="text-link"
            to={academic ? `/courses/${attempt.courseId}` : '/practice'}
          >
            Leave and resume later
          </Link>
          {error ? <PracticeError error={error} /> : null}
        </aside>
      </div>
    </>
  );
}
