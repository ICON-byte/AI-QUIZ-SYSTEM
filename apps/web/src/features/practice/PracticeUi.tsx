import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
import { ApiError } from '../../lib/api';
import { sessionKey } from '../auth/session';

export function StudentPractice() {
  const user = useWorkspaceUser();
  return user.role === 'STUDENT' ? (
    <Outlet context={user} />
  ) : (
    <Navigate to="/dashboard" replace />
  );
}

export function PracticeError({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  const client = useQueryClient();
  if (error instanceof ApiError && error.status === 401) {
    return (
      <Feedback
        message="Your session has ended. Sign in again to resume your saved work."
        retryLabel="Sign in again"
        retry={() => client.setQueryData(sessionKey, null)}
      />
    );
  }
  return (
    <>
      <Feedback message={error.message} retry={retry} />
      {error instanceof ApiError && error.fields.length ? (
        <ul className="form-error">
          {error.fields.map((field, index) => (
            <li key={index}>
              {field.field}: {field.message}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function Pagination({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (page: number) => void;
}) {
  if (total <= 20) return null;
  return (
    <nav className="pagination" aria-label="Page navigation">
      <button
        type="button"
        className="button secondary"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        Previous page
      </button>
      <span>
        {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
      </span>
      <button
        type="button"
        className="button secondary"
        disabled={page * 20 >= total}
        onClick={() => setPage(page + 1)}
      >
        Next page
      </button>
    </nav>
  );
}
