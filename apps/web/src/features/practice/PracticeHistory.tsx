import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from './PracticeUi';
import { duration } from './format';
import type { HistoryEntry } from './types';

export function PracticeHistory() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['practice', 'history', page],
    queryFn: () =>
      api<{ attempts: HistoryEntry[]; total: number }>(
        `/practice/history?page=${page}`,
      ),
    retry: false,
  });
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">Learning / Personal practice</p>
          <h1>Practice history</h1>
          <p className="muted">
            Every attempt is a chance to understand a little more.
          </p>
        </div>
        <Link className="button secondary" to="/practice">
          My quizzes ↗
        </Link>
      </div>
      {query.isPending ? (
        <p role="status">Loading your history…</p>
      ) : query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <p className="list-caption">
            {query.data.total} completed{' '}
            {query.data.total === 1 ? 'attempt' : 'attempts'}
          </p>
          {query.data.attempts.length ? (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Quiz / attempt</th>
                    <th>Finished</th>
                    <th className="num">Score</th>
                    <th className="num">Time taken</th>
                    <th>
                      <span className="sr-only">Review</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td>
                        <Link to={`/practice/attempts/${attempt.id}/result`}>
                          {attempt.title}
                        </Link>
                        <span className="field-hint">
                          Attempt {attempt.attemptNumber}
                          {attempt.status === 'EXPIRED'
                            ? ' · Time expired'
                            : ''}
                        </span>
                      </td>
                      <td>
                        {new Intl.DateTimeFormat('en-GB', {
                          dateStyle: 'medium',
                        }).format(new Date(attempt.finalizedAt))}
                      </td>
                      <td className="num">
                        {attempt.score}/{attempt.totalQuestions}
                      </td>
                      <td className="num">
                        {duration(attempt.durationSeconds)}
                      </td>
                      <td>
                        <Link to={`/practice/attempts/${attempt.id}/result`}>
                          Review ↗
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="panel practice-empty">
              <h2>A fresh page</h2>
              <p className="muted">
                Completed attempts will appear here. Your earlier results stay
                here when you retake a quiz.
              </p>
              <Link className="text-link" to="/practice">
                Find a practice quiz ↗
              </Link>
            </section>
          )}
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
