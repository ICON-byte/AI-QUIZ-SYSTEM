import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import type { CourseInfo, Roster } from './types';
export function CourseRoster() {
  const { courseId } = useParams();
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const client = useQueryClient();
  const course = useQuery({
    queryKey: ['courses', 'detail', courseId],
    queryFn: () => api<CourseInfo>(`/courses/${courseId}`),
    retry: false,
  });
  const roster = useQuery({
    queryKey: ['courses', courseId, 'roster', page],
    queryFn: () => api<Roster>(`/courses/${courseId}/roster?page=${page}`),
    retry: false,
  });
  async function change(id: string, restore: boolean) {
    if (
      !window.confirm(
        restore
          ? 'Restore this student’s course access?'
          : 'Remove this student? Their historical attempts will be preserved.',
      )
    )
      return;
    setPending(true);
    setError(null);
    try {
      await api(
        `/courses/${courseId}/students/${id}/${restore ? 'restore' : 'remove'}`,
        { method: 'POST', body: '{}' },
      );
      await client.invalidateQueries({
        queryKey: ['courses', courseId, 'roster'],
      });
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <p className="context-label">
          <Link to={`/courses/${courseId}`}>Course details</Link> / Roster
        </p>
        <h1>Course roster</h1>
        <p className="muted">
          {course.data?.code} · {roster.data?.active ?? 0} actively enrolled
          students
        </p>
      </div>
      {error ? <PracticeError error={error} /> : null}
      {roster.isPending ? (
        <p role="status">Loading students…</p>
      ) : roster.error ? (
        <PracticeError error={roster.error} />
      ) : (
        <>
          {roster.data.students.length ? (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Enrollment</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.data.students.map((student) => (
                    <tr key={student.id}>
                      <td>
                        {student.displayName}
                        <span className="field-hint">{student.email}</span>
                      </td>
                      <td>
                        {student.status === 'ACTIVE'
                          ? 'Enrolled'
                          : student.status === 'LEFT'
                            ? 'Left course'
                            : 'Removed'}
                      </td>
                      <td>
                        <button
                          className="button secondary"
                          disabled={pending || !!course.data?.archivedAt}
                          onClick={() => {
                            void change(
                              student.id,
                              student.status !== 'ACTIVE',
                            );
                          }}
                        >
                          {student.status === 'ACTIVE'
                            ? 'Remove student'
                            : 'Restore enrollment'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="panel">
              <p className="muted">
                No students have joined yet. Share a new enrollment code from
                the course page.
              </p>
            </section>
          )}
          <Pagination page={page} total={roster.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
