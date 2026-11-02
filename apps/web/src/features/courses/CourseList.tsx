import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import type { CourseInfo } from './types';
export function CourseList() {
  const user = useWorkspaceUser();
  const lecturer = user.role === 'LECTURER';
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['courses', 'list', page],
    queryFn: () =>
      api<{ courses: CourseInfo[]; total: number }>(`/courses?page=${page}`),
    retry: false,
  });
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            {lecturer ? 'Teaching' : 'Learning'} / Courses
          </p>
          <h1>My courses</h1>
          <p className="muted">
            {lecturer
              ? 'A clear home for your teaching and assessments.'
              : 'Your enrolled courses and official assessments.'}
          </p>
        </div>
        <Link
          className="button primary"
          to={lecturer ? '/courses/new' : '/courses/join'}
        >
          {lecturer ? 'Create course' : 'Join a course'} +
        </Link>
      </div>
      {query.isPending ? (
        <p role="status">Loading courses…</p>
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
            {query.data.total} {query.data.total === 1 ? 'course' : 'courses'}
          </p>
          {query.data.courses.length ? (
            <div className="quiz-list">
              {query.data.courses.map((course) => (
                <article className="quiz-row" key={course.id}>
                  <div>
                    <span className="status neutral">
                      {course.code}
                      {course.archivedAt ? ' · Archived' : ''}
                    </span>
                    <h2>
                      <Link to={`/courses/${course.id}`}>{course.title}</Link>
                    </h2>
                    <p className="muted">{course.description}</p>
                  </div>
                  <Link
                    className="button secondary"
                    to={`/courses/${course.id}`}
                  >
                    Open course ↗
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <section className="panel practice-empty">
              <h2>
                {lecturer
                  ? 'Your next class starts here'
                  : 'A place for your coursework'}
              </h2>
              <p className="muted">
                {lecturer
                  ? 'Create a course and share its enrollment code with your students.'
                  : 'Ask your lecturer for an enrollment code, then join their course.'}
              </p>
            </section>
          )}
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
