import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import { useLeaveWarning } from '../practice/useLeaveWarning';
import type { Bank } from './types';

export function BankEditor() {
  const { bankId } = useParams();
  const query = useQuery({
    queryKey: ['banks', bankId],
    queryFn: () => api<Bank>(`/question-banks/${bankId}`),
    enabled: !!bankId,
    retry: false,
  });
  if (bankId && query.isPending) return <p role="status">Loading bank…</p>;
  if (query.error) return <PracticeError error={query.error} />;
  if (query.data?.archivedAt)
    return (
      <>
        <h1>Bank archived</h1>
        <p>This bank is read-only.</p>
        <Link to={`/banks/${bankId}`}>Return to bank</Link>
      </>
    );
  return <BankForm key={bankId ?? 'new'} initial={query.data} />;
}
function BankForm({ initial }: { initial?: Bank }) {
  const user = useWorkspaceUser();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [courseId, setCourseId] = useState(initial?.courseId ?? '');
  const [coursePage, setCoursePage] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const courses = useQuery({
    queryKey: ['courses', 'bank-association', coursePage],
    queryFn: () =>
      api<{
        courses: { id: string; title: string; archivedAt: string | null }[];
        total: number;
      }>(`/courses?page=${coursePage}`),
    enabled: user.role === 'LECTURER' && user.verificationStatus === 'APPROVED',
    retry: false,
  });
  useLeaveWarning(dirty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const bank = await api<Bank>(
        initial ? `/question-banks/${initial.id}` : '/question-banks',
        {
          method: initial ? 'PUT' : 'POST',
          body: JSON.stringify({
            title,
            description,
            courseId: courseId || null,
            ...(initial ? { revision: initial.revision } : {}),
          }),
        },
      );
      setDirty(false);
      await client.invalidateQueries({ queryKey: ['banks'] });
      navigate(`/banks/${bank.id}`);
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to="/banks">Question banks</Link>
          </p>
          <h1>{initial ? 'Edit question bank' : 'Create a question bank'}</h1>
          <p className="muted">Only you can view and use this bank.</p>
        </div>
      </div>
      <form
        className="panel bank-form"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <fieldset className="editor-fields" disabled={pending}>
          <label className="field">
            Bank title
            <input
              required
              maxLength={150}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            Description <span className="field-hint">Optional</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {user.role === 'LECTURER' ? (
            <>
              <label className="field">
                Associated course
                <select
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="">No course association</option>
                  {courseId &&
                  !courses.data?.courses.some((c) => c.id === courseId) ? (
                    <option value={courseId}>Current course association</option>
                  ) : null}
                  {courses.data?.courses
                    .filter((c) => !c.archivedAt || c.id === courseId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </select>
              </label>
              {courses.isFetching ? (
                <p role="status">Loading courses…</p>
              ) : null}
              {courses.error ? <PracticeError error={courses.error} /> : null}
              {courses.data && courses.data.total > 20 ? (
                <div className="button-group">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={coursePage === 1}
                    onClick={() => setCoursePage((p) => p - 1)}
                  >
                    Previous courses
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={coursePage * 20 >= courses.data.total}
                    onClick={() => setCoursePage((p) => p + 1)}
                  >
                    More courses
                  </button>
                </div>
              ) : null}
              <p className="field-hint">
                Association is for your organization. It does not share
                questions with enrolled students.
              </p>
            </>
          ) : null}
          <div className="editor-actions">
            <Link to={initial ? `/banks/${initial.id}` : '/banks'}>Cancel</Link>
            <button className="button primary" type="submit">
              {pending ? 'Saving…' : initial ? 'Save bank' : 'Create bank'}
            </button>
          </div>
        </fieldset>
        {error ? <PracticeError error={error} /> : null}
      </form>
    </>
  );
}
