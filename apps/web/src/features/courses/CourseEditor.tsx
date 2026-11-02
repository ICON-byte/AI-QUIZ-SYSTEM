import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import { useLeaveWarning } from '../practice/useLeaveWarning';
import type { CourseInfo } from './types';
export function CourseEditor() {
  const { courseId } = useParams();
  const query = useQuery({
    queryKey: ['courses', 'detail', courseId],
    queryFn: () => api<CourseInfo>(`/courses/${courseId}`),
    enabled: !!courseId,
    retry: false,
  });
  if (courseId && query.isPending) return <p role="status">Loading course…</p>;
  if (query.error) return <PracticeError error={query.error} />;
  return <CourseForm key={courseId ?? 'new'} initial={query.data} />;
}
function CourseForm({ initial }: { initial?: CourseInfo }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useLeaveWarning(dirty);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const course = await api<CourseInfo>(
        initial ? `/courses/${initial.id}` : '/courses',
        {
          method: initial ? 'PUT' : 'POST',
          body: JSON.stringify({
            title: values.get('title'),
            code: values.get('code'),
            description: values.get('description'),
            ...(initial ? { revision: initial.revision } : {}),
          }),
        },
      );
      setDirty(false);
      await client.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/courses/${course.id}`, {
        state: { enrollmentCode: course.enrollmentCode },
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
          <Link to="/courses">My courses</Link> /{' '}
          {initial ? 'Edit' : 'New course'}
        </p>
        <h1>{initial ? 'Edit course' : 'Create a course'}</h1>
        <p className="muted">One course, one shared place to learn.</p>
      </div>
      <form
        className="course-form panel"
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <fieldset
          disabled={pending || !!initial?.archivedAt}
          className="editor-fields"
        >
          <label className="field">
            Course title
            <input
              name="title"
              required
              maxLength={150}
              defaultValue={initial?.title ?? ''}
            />
          </label>
          <div className="field">
            <label htmlFor="course-code">Course code</label>
            <input
              id="course-code"
              aria-describedby="course-code-hint"
              name="code"
              required
              maxLength={30}
              defaultValue={initial?.code ?? ''}
            />
            <span className="field-hint" id="course-code-hint">
              For example, BIO 201. This is different from the private
              enrollment code.
            </span>
          </div>
          <label className="field">
            Course description <span className="field-hint">Optional</span>
            <textarea
              name="description"
              maxLength={2000}
              rows={4}
              defaultValue={initial?.description ?? ''}
            />
          </label>
          <button className="button primary" type="submit">
            {pending ? 'Saving…' : initial ? 'Save course' : 'Create course'}
          </button>
        </fieldset>
        {error ? <PracticeError error={error} /> : null}
      </form>
    </>
  );
}
