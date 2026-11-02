import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import type { AssessmentReport as Report } from './types';
export function AssessmentReport() {
  const { courseId, quizId } = useParams();
  const query = useQuery({
    queryKey: ['courses', courseId, 'report', quizId],
    queryFn: () =>
      api<Report>(`/courses/${courseId}/assessments/${quizId}/report`),
    retry: false,
    refetchInterval: 15000,
  });
  if (query.isPending) return <p role="status">Preparing assessment report…</p>;
  if (query.error)
    return (
      <PracticeError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const report = query.data;
  const percent = (value: number | null) =>
    value === null ? '—' : `${value}%`;
  return (
    <div className="assessment-report">
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to={`/courses/${courseId}`}>Course details</Link> / Results
          </p>
          <h1>{report.quiz.title}</h1>
          <p className="muted">
            Assessment performance · {report.finalizedAttempts} graded attempts
          </p>
        </div>
        <button
          className="button secondary"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          Refresh report
        </button>
      </div>
      <dl className="result-summary course-report-summary">
        <div>
          <dt>Currently enrolled</dt>
          <dd>{report.totalEnrolled}</dd>
        </div>
        <div>
          <dt>Students attempted</dt>
          <dd>{report.studentsAttempted}</dd>
        </div>
        <div>
          <dt>Average score</dt>
          <dd>{percent(report.averagePercentage)}</dd>
        </div>
        <div>
          <dt>Highest / lowest</dt>
          <dd>
            {percent(report.highestPercentage)} /{' '}
            {percent(report.lowestPercentage)}
          </dd>
        </div>
      </dl>
      <p className="field-hint report-note">
        Statistics include all finalized attempts, including repeat attempts and
        historical enrollments. In-progress attempts are excluded from score
        averages.
      </p>
      <div className="question-editor-title">
        <h2>Student attempts</h2>
      </div>
      {report.attempts.length ? (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Student / attempt</th>
                <th>Status</th>
                <th className="num">Score</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {report.attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>
                    {attempt.student.displayName}
                    <span className="field-hint">
                      {attempt.student.email} · Attempt {attempt.attemptNumber}
                    </span>
                  </td>
                  <td>
                    {attempt.status === 'IN_PROGRESS'
                      ? 'In progress'
                      : attempt.status === 'EXPIRED'
                        ? 'Expired'
                        : 'Submitted'}
                  </td>
                  <td className="num">
                    {attempt.score === null
                      ? '—'
                      : `${attempt.score}/${attempt.totalQuestions}`}
                  </td>
                  <td>
                    {attempt.submittedAt
                      ? new Date(attempt.submittedAt).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="panel">
          <p className="muted">No students have started this assessment.</p>
        </section>
      )}
      <div className="question-editor-title">
        <h2>Question correctness</h2>
      </div>
      <div className="question-statistics">
        {report.questions.map((question, index) => (
          <div key={question.id}>
            <p>
              Question {index + 1} · {question.prompt}
            </p>
            <span className="num">
              {question.correctCount} / {question.totalGraded} correct
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
