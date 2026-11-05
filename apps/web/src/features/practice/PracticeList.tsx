import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from './PracticeUi';
import { timerLabel } from './format';
import type { QuizSummary } from './types';
import { DuplicateQuiz } from '../banks/DuplicateQuiz';

export function PracticeList() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['practice', 'list', page],
    queryFn: () =>
      api<{ quizzes: QuizSummary[]; total: number }>('/quizzes?page=' + page),
    retry: false,
  });
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">Learning / Personal practice</p>
          <h1>My practice quizzes</h1>
          <p className="muted">
            Make a little room for what you want to understand.
          </p>
        </div>
        <Link className="button primary" to="/practice/new">
          Create a quiz <span aria-hidden="true">+</span>
        </Link>
      </div>
      {query.isPending ? (
        <p role="status">Loading your practice quizzes…</p>
      ) : query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <div className="list-caption">
            <span>
              {query.data.total} personal{' '}
              {query.data.total === 1 ? 'quiz' : 'quizzes'}
            </span>
            <Link to="/practice/history">Practice history ↗</Link>
          </div>
          {query.data.quizzes.length ? (
            <div className="quiz-list">
              {query.data.quizzes.map((quiz) => (
                <article className="quiz-row" key={quiz.id}>
                  <div>
                    <span
                      className={`status ${quiz.status === 'DRAFT' ? 'neutral' : 'positive'}`}
                    >
                      {quiz.status === 'DRAFT' ? 'Draft' : 'Published'}
                    </span>
                    <h2>
                      <Link
                        to={
                          quiz.status === 'DRAFT'
                            ? `/practice/${quiz.id}/edit`
                            : `/practice/${quiz.id}`
                        }
                      >
                        {quiz.title}
                      </Link>
                    </h2>
                    {quiz.description ? (
                      <p className="muted">{quiz.description}</p>
                    ) : null}
                    <p className="field-hint">
                      {quiz.questionCount}{' '}
                      {quiz.questionCount === 1 ? 'question' : 'questions'} ·{' '}
                      {timerLabel(quiz.timeLimitSeconds)}
                    </p>
                  </div>
                  <div className="button-group">
                    <DuplicateQuiz id={quiz.id} />
                    <Link
                      className="button secondary"
                      to={
                        quiz.status === 'DRAFT'
                          ? `/practice/${quiz.id}/edit`
                          : `/practice/${quiz.id}`
                      }
                    >
                      {quiz.status === 'DRAFT' ? 'Edit draft' : 'Open quiz'} ↗
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="practice-empty panel">
              <h2>Your next question starts here</h2>
              <p className="muted">
                Create a personal quiz, add your questions, and practise at your
                own pace.
              </p>
              <Link className="text-link" to="/practice/new">
                Create your first quiz ↗
              </Link>
            </section>
          )}
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
