import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';

export function DuplicateQuiz({
  id,
  courseId,
}: {
  id: string;
  courseId?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  async function duplicate() {
    setPending(true);
    setError(null);
    try {
      const copy = await api<{ id: string }>(
        `${courseId ? `/courses/${courseId}/assessments` : '/quizzes'}/${id}/duplicate`,
        { method: 'POST', body: '{}' },
      );
      await client.invalidateQueries({
        queryKey: [courseId ? 'courses' : 'practice'],
      });
      navigate(
        courseId
          ? `/courses/${courseId}/assessments/${copy.id}/edit`
          : `/practice/${copy.id}/edit`,
      );
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className="button secondary"
        disabled={pending}
        onClick={() => {
          void duplicate();
        }}
      >
        {pending ? 'Duplicating…' : 'Duplicate as draft'}
      </button>
      {error ? <PracticeError error={error} /> : null}
    </div>
  );
}
