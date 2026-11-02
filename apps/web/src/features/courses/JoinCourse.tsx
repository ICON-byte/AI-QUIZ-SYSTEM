import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import type { CourseInfo } from './types';
export function JoinCourse() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const course = await api<CourseInfo>('/courses/join', {
        method: 'POST',
        body: JSON.stringify({ code: data.get('code') }),
      });
      await client.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/courses/${course.id}`);
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
          <Link to="/courses">My courses</Link> / Enrollment
        </p>
        <h1>Join a course</h1>
        <p className="muted">
          Use the private enrollment code shared by your lecturer.
        </p>
      </div>
      <form
        className="course-form panel"
        onSubmit={(event) => {
          void join(event);
        }}
      >
        <div className="field">
          <label htmlFor="enrollment-code">Enrollment code</label>
          <input
            id="enrollment-code"
            aria-describedby="enrollment-code-hint"
            name="code"
            required
            minLength={24}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
          <span className="field-hint" id="enrollment-code-hint">
            Enter all 24 characters. Your lecturer can generate a new code if it
            has been revoked.
          </span>
        </div>
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? 'Joining…' : 'Join course'}
        </button>
        {error ? <PracticeError error={error} /> : null}
      </form>
    </>
  );
}
