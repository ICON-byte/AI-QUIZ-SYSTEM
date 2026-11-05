import { useState } from 'react';
import { DuplicateQuiz } from '../banks/DuplicateQuiz';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import { safeError, timerLabel } from '../practice/format';
import type { QuizSummary } from '../practice/types';
import type { CourseInfo } from './types';
export function CourseDetails() {
  const { courseId } = useParams();
  const user = useWorkspaceUser();
  const lecturer = user.role === 'LECTURER';
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [code, setCode] = useState<string | null>(() =>
    typeof location.state?.enrollmentCode === 'string'
      ? location.state.enrollmentCode
      : null,
  );
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: ['courses', 'detail', courseId],
    queryFn: () => api<CourseInfo>(`/courses/${courseId}`),
    retry: false,
  });
  const assessments = useQuery({
    queryKey: ['courses', courseId, 'assessments', page],
    queryFn: () =>
      api<{ assessments: QuizSummary[]; total: number; serverNow: string }>(
        `/courses/${courseId}/assessments?page=${page}`,
      ),
    retry: false,
    refetchInterval: 15000,
  });
  async function action(path: string, confirm: string) {
    if (!window.confirm(confirm)) return;
    setPending(true);
    setError(null);
    try {
      const response = await api<{ enrollmentCode?: string | null }>(path, {
        method: 'POST',
        body: '{}',
      });
      if ('enrollmentCode' in response)
        setCode(response.enrollmentCode ?? null);
      await client.invalidateQueries({ queryKey: ['courses'] });
      if (path.endsWith('/leave')) navigate('/courses');
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }
  if (query.isPending) return <p role="status">Opening course…</p>;
  if (query.error)
    return (
      <PracticeError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const course = query.data;
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to="/courses">My courses</Link> / {course.code}
          </p>
          <h1>{course.title}</h1>
          <p className="muted preserve-lines">{course.description}</p>
        </div>
        <span className="status neutral">
          {course.archivedAt ? 'Archived course' : course.code}
        </span>
      </div>
      <div className="course-tools">
        {lecturer ? (
          <>
            <Link
              className="button secondary"
              to={`/courses/${courseId}/roster`}
            >
              Course roster
            </Link>
            {!course.archivedAt ? (
              <>
                <Link
                  className="button secondary"
                  to={`/courses/${courseId}/edit`}
                >
                  Edit course
                </Link>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() => {
                    void action(
                      `/courses/${courseId}/enrollment-code`,
                      'Generate a new enrollment code? The previous code will stop working.',
                    );
                  }}
                >
                  Generate enrollment code
                </button>
                <button
                  className="button secondary"
                  disabled={pending || !course.enrollmentEnabled}
                  onClick={() => {
                    void action(
                      `/courses/${courseId}/revoke-code`,
                      'Revoke the enrollment code? Existing enrollments will stay active.',
                    );
                  }}
                >
                  Revoke code
                </button>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() => {
                    void action(
                      `/courses/${courseId}/archive`,
                      'Archive this course? New participation will stop and active assessments will end. Records will be preserved.',
                    );
                  }}
                >
                  Archive course
                </button>
              </>
            ) : null}
          </>
        ) : (
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => {
              void action(
                `/courses/${courseId}/leave`,
                'Leave this course? Assessment access requires active enrollment.',
              );
            }}
          >
            Leave course
          </button>
        )}
      </div>
      {code && lecturer && !course.archivedAt ? (
        <section className="enrollment-code panel">
          <h2>New enrollment code</h2>
          <p className="code-value">{code}</p>
          <p className="field-hint">
            Copy this code now and share it only with your students. It will not
            be displayed again after leaving this page.
          </p>
        </section>
      ) : null}
      {error ? <PracticeError error={error} /> : null}
      <div className="question-editor-title">
        <h2>Course assessments</h2>
        {lecturer && !course.archivedAt ? (
          <Link
            className="button primary"
            to={`/courses/${courseId}/assessments/new`}
          >
            Create assessment +
          </Link>
        ) : null}
      </div>
      {assessments.isPending ? (
        <p role="status">Loading assessments…</p>
      ) : assessments.error ? (
        <PracticeError
          error={assessments.error}
          retry={() => {
            void assessments.refetch();
          }}
        />
      ) : (
        <>
          {assessments.data.assessments.length ? (
            <div className="quiz-list">
              {assessments.data.assessments.map((quiz) => {
                const closed =
                  !!course.archivedAt ||
                  !!quiz.closedAt ||
                  !!(
                    quiz.closesAt &&
                    Date.parse(quiz.closesAt) <=
                      Date.parse(assessments.data.serverNow)
                  );
                const scheduled = !!(
                  quiz.opensAt &&
                  Date.parse(quiz.opensAt) >
                    Date.parse(assessments.data.serverNow)
                );
                return (
                  <article className="quiz-row" key={quiz.id}>
                    <div>
                      <span className="status neutral">
                        {quiz.status === 'DRAFT'
                          ? 'Draft'
                          : closed
                            ? 'Closed'
                            : scheduled
                              ? 'Scheduled'
                              : 'Open'}
                      </span>
                      <h3>{quiz.title}</h3>
                      <p className="field-hint">
                        {quiz.questionCount} questions ·{' '}
                        {timerLabel(quiz.timeLimitSeconds)} · {quiz.maxAttempts}{' '}
                        {quiz.maxAttempts === 1 ? 'attempt' : 'attempts'}
                      </p>
                      <p className="field-hint">
                        Closes:{' '}
                        {quiz.closesAt
                          ? new Date(quiz.closesAt).toLocaleString()
                          : 'Not set'}
                      </p>
                    </div>
                    <div className="button-group">
                      {lecturer ? (
                        <>
                          {!course.archivedAt ? <DuplicateQuiz id={quiz.id} courseId={courseId} /> : null}
                          {quiz.status === 'DRAFT' && !course.archivedAt ? (
                            <Link
                              className="button secondary"
                              to={`/courses/${courseId}/assessments/${quiz.id}/edit`}
                            >
                              Edit draft
                            </Link>
                          ) : null}
                          <Link
                            className="button secondary"
                            to={`/courses/${courseId}/assessments/${quiz.id}/report`}
                          >
                            Results report
                          </Link>
                          {quiz.status === 'PUBLISHED' && !closed ? (
                            <button
                              className="button secondary"
                              disabled={pending}
                              onClick={() => {
                                void action(
                                  `/courses/${courseId}/assessments/${quiz.id}/close`,
                                  'Close this assessment now? Active attempts will end and answer review will become available.',
                                );
                              }}
                            >
                              Close assessment
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <Link
                          className="button secondary"
                          to={`/assessments/${quiz.id}`}
                        >
                          Assessment details ↗
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <section className="panel practice-empty">
              <h3>No assessments yet</h3>
              <p className="muted">
                {lecturer
                  ? 'Create an assessment draft when you are ready.'
                  : 'Published assessments will appear here when your lecturer makes them available.'}
              </p>
            </section>
          )}
          <Pagination
            page={page}
            total={assessments.data.total}
            setPage={setPage}
          />
        </>
      )}
    </>
  );
}
