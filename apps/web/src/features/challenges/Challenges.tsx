import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import { safeError, timerLabel } from '../practice/format';
import type { QuizSummary } from '../practice/types';

type Challenge = QuizSummary & {
  state: 'DRAFT' | 'OPEN' | 'CLOSED';
  isCreator?: boolean;
  statistics?: {
    joined: number;
    started: number;
    finalized: number;
    inProgress: number;
  };
  sharingAvailable?: boolean;
  attempt?: {
    id: string;
    status: string;
    score: number | null;
    totalQuestions: number;
  } | null;
};
export function ChallengeList({ history = false }: { history?: boolean }) {
  const [params, setParams] = useSearchParams(),
    page = Number(params.get('page')) || 1;
  const view = history
    ? 'history'
    : params.get('view') === 'joined'
      ? 'joined'
      : 'created';
  const query = useQuery({
    queryKey: ['challenges', 'list', view, page],
    queryFn: () =>
      api<{ quizzes: Challenge[]; total: number; sharingAvailable: boolean }>(
        `/challenges?view=${view}&page=${page}`,
      ),
    retry: false,
  });
  return (
    <>
      <div className="practice-heading">
        <div>
          <h1>{history ? 'Challenge history' : 'Friends challenges'}</h1>
          <p className="muted">
            {history
              ? 'Revisit your scores and available answer reviews.'
              : 'Share a quiz. Each friend gets one attempt, at their own time.'}
          </p>
        </div>
        <div className="bank-tools">
          <Link className="button secondary" to="/challenges/join">
            Join a challenge
          </Link>
          <Link className="button primary" to="/challenges/new">
            Create challenge
          </Link>
        </div>
      </div>
      {
        <nav className="bank-tools" aria-label="Challenge views">
          <Link
            to="/challenges?view=created"
            aria-current={view === 'created' ? 'page' : undefined}
          >
            Created
          </Link>
          <Link
            to="/challenges?view=joined"
            aria-current={view === 'joined' ? 'page' : undefined}
          >
            Joined
          </Link>
          <Link
            to="/challenges/history"
            aria-current={history ? 'page' : undefined}
          >
            History
          </Link>
        </nav>
      }
      {query.isPending ? (
        <p role="status">Loading challenges...</p>
      ) : query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          {!query.data.sharingAvailable ? (
            <p className="bank-notice">
              Challenge sharing is unavailable until the operator configures the
              invitation encryption key. You can still save drafts.
            </p>
          ) : null}
          {!query.data.quizzes.length ? (
            <p className="panel">
              {history
                ? 'No completed challenge attempts yet.'
                : view === 'created'
                  ? 'You have not created a challenge yet.'
                  : 'Join a challenge using a code or invitation link.'}
            </p>
          ) : (
            <div>
              {query.data.quizzes.map((quiz) => (
                <article className="quiz-row" key={quiz.id}>
                  <div>
                    <h2>
                      <Link
                        to={
                          view === 'created'
                            ? quiz.status === 'DRAFT'
                              ? `/challenges/${quiz.id}/edit`
                              : `/challenges/${quiz.id}/manage`
                            : `/challenges/${quiz.id}`
                        }
                      >
                        {quiz.title}
                      </Link>
                    </h2>
                    <p className="muted">
                      {quiz.questionCount} questions /{' '}
                      {timerLabel(quiz.timeLimitSeconds)} / {quiz.state}
                    </p>
                    {quiz.closesAt ? (
                      <p className="field-hint">
                        Closes {new Date(quiz.closesAt).toLocaleString()}
                      </p>
                    ) : null}
                    {quiz.attempt ? (
                      <p>
                        {quiz.attempt.status === 'IN_PROGRESS'
                          ? 'Attempt in progress'
                          : `Score: ${quiz.attempt.score} / ${quiz.attempt.totalQuestions}`}
                      </p>
                    ) : null}
                  </div>
                  {quiz.attempt ? (
                    <Link
                      className="button secondary"
                      to={`/challenges/attempts/${quiz.attempt.id}${quiz.attempt.status === 'IN_PROGRESS' ? '' : '/result'}`}
                    >
                      {quiz.attempt.status === 'IN_PROGRESS'
                        ? 'Resume'
                        : 'View result'}
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          <Pagination
            page={page}
            total={query.data.total}
            setPage={(next) =>
              setParams({ ...(history ? {} : { view }), page: String(next) })
            }
          />
        </>
      )}
    </>
  );
}
export function ChallengeJoin() {
  const location = useLocation(),
    navigate = useNavigate(),
    client = useQueryClient();
  const [code, setCode] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('code') ?? '',
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null);
  async function join(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ id: string }>('/challenges/join', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      await client.invalidateQueries({ queryKey: ['challenges'] });
      navigate('/challenges/' + result.id, { replace: true });
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="practice-heading">
        <div>
          <h1>Join a challenge</h1>
          <p className="muted">
            Enter the invitation code shared by its creator.
          </p>
        </div>
        <Link to="/challenges">Back to challenges</Link>
      </div>
      <form
        className="panel bank-form"
        onSubmit={(event) => {
          void join(event);
        }}
      >
        <label className="field">
          Invitation code
          <input
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={24}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            disabled={pending}
          />
        </label>
        <p className="field-hint">
          Joining shares your display name, final score and completion time with
          the creator and eligible participants. Your answers remain private.
          Joining does not start your timer.
        </p>
        <button className="button primary" disabled={pending}>
          {pending ? 'Joining...' : 'Join challenge'}
        </button>
        {error ? <PracticeError error={error} /> : null}
      </form>
    </>
  );
}
export function ChallengeManage() {
  const { quizId } = useParams(),
    client = useQueryClient();
  const [invitation, setInvitation] = useState<{
      code: string;
      link: string;
    } | null>(null),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: ['challenges', 'manage', quizId],
    queryFn: () => api<Challenge>(`/challenges/${quizId}/manage`),
    retry: false,
    refetchInterval: 15000,
  });
  async function action(close = false) {
    if (
      close &&
      !window.confirm(
        'Close this challenge permanently? Active attempts end now and their saved answers are graded.',
      )
    )
      return;
    setPending(true);
    setError(null);
    try {
      if (close) {
        await api(`/challenges/${quizId}/close`, {
          method: 'POST',
          body: '{}',
        });
        setInvitation(null);
        await client.invalidateQueries({ queryKey: ['challenges'] });
      } else setInvitation(await api(`/challenges/${quizId}/invitation`));
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied to clipboard.');
    } catch {
      setNotice('Select the displayed invitation text and copy it.');
    }
  }
  if (query.isPending) return <p role="status">Loading your challenge...</p>;
  if (query.error)
    return (
      <PracticeError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const quiz = query.data;
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to="/challenges">Created challenges</Link>
          </p>
          <h1>{quiz.title}</h1>
          <p className="muted">{quiz.description}</p>
        </div>
        <span className="status neutral">{quiz.state}</span>
      </div>
      <section className="panel">
        <h2>Challenge details</h2>
        <p>
          {quiz.questionCount} questions / {timerLabel(quiz.timeLimitSeconds)}
        </p>
        <p>
          {quiz.closesAt
            ? `Scheduled close: ${new Date(quiz.closesAt).toLocaleString()}`
            : quiz.state === 'CLOSED' ? 'No scheduled closing time.' : 'No scheduled close; stays open until you close it.'}
        </p>
        {quiz.closedAt ? <p>Closed at {new Date(quiz.closedAt).toLocaleString()}</p> : null}
        <p className="field-hint">
          You are the creator and cannot participate in this ranked challenge.
        </p>
        {quiz.state === 'DRAFT' ? (
          <Link className="button primary" to={`/challenges/${quizId}/edit`}>
            Edit draft
          </Link>
        ) : (
          <div className="bank-tools">
            <Link
              className="button secondary"
              to={`/challenges/${quizId}/leaderboard`}
            >
              View leaderboard
            </Link>
            {quiz.state === 'OPEN' ? (
              <>
                <button
                  className="button secondary"
                  disabled={pending || !quiz.sharingAvailable}
                  onClick={() => {
                    void action();
                  }}
                >
                  Show invitation
                </button>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() => {
                    void action(true);
                  }}
                >
                  Close challenge
                </button>
              </>
            ) : (
              <p>
                Closed permanently. Answer review is now available to
                participants who attempted it.
              </p>
            )}
          </div>
        )}
        {invitation && quiz.state === 'OPEN' ? (
          <section className="bank-notice">
            <h3>Share with friends</h3>
            <label className="field">
              Invitation code
              <input readOnly value={invitation.code} />
            </label>
            <label className="field">
              Invitation link
              <input readOnly value={invitation.link} />
            </label>
            <div className="bank-tools">
              <button
                className="button secondary"
                onClick={() => {
                  void copy(invitation.code);
                }}
              >
                Copy code
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  void copy(invitation.link);
                }}
              >
                Copy link
              </button>
            </div>
          </section>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {error ? <PracticeError error={error} /> : null}
      </section>
      {quiz.statistics ? (
        <section className="panel">
          <h2>Participation</h2>
          <dl className="result-summary">
            <div>
              <dt>Joined</dt>
              <dd>{quiz.statistics.joined}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{quiz.statistics.started}</dd>
            </div>
            <div>
              <dt>Finalized</dt>
              <dd>{quiz.statistics.finalized}</dd>
            </div>
            <div>
              <dt>{quiz.state === 'CLOSED' ? 'Awaiting finalization' : 'In progress'}</dt>
              <dd>{quiz.statistics.inProgress}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </>
  );
}
export function ChallengeLeaderboard() {
  const { quizId } = useParams();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['challenges', 'leaderboard', quizId, page],
    queryFn: () =>
      api<{
        entries: {
          rank: number;
          displayName: string;
          score: number;
          totalQuestions: number;
          percentage: number;
          durationMilliseconds: number;
          isYou: boolean;
        }[];
        total: number;
        updating: boolean;
        closed: boolean;
      }>(`/challenges/${quizId}/leaderboard?page=${page}`),
    retry: false,
    refetchInterval: 15000,
  });
  return (
    <>
      <div className="practice-heading">
        <div>
          <h1>Challenge leaderboard</h1>
          <p className="muted">
            Highest score, then shortest server-measured time. Exact ties share
            a rank.
          </p>
        </div>
        <Link to={`/challenges/${quizId}`}>Challenge details</Link>
      </div>
      {query.isPending ? (
        <p role="status">Loading leaderboard...</p>
      ) : query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <p className="field-hint">
            {query.data.updating
              ? 'Finalizing saved attempts. Rankings will appear when processing finishes.'
              : query.data.closed
                ? 'Challenge closed. These are the final rankings.'
                : 'Challenge is open. Rankings may change as friends finish.'}
          </p>
          {!query.data.updating && !query.data.entries.length ? (
            <p className="panel">No finalized attempts yet.</p>
          ) : null}
          {query.data.entries.length ? (
            <div className="history-table-wrap challenge-leaderboard">
              <table className="history-table">
                <caption className="sr-only">
                  Private challenge rankings
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Student</th>
                    <th scope="col">Score</th>
                    <th scope="col">Percentage</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.entries.map((entry, index) => (
                    <tr key={index}>
                      <td>{entry.rank}</td>
                      <td>
                        {entry.displayName}
                        {entry.isYou ? ' (you)' : ''}
                      </td>
                      <td>
                        {entry.score} / {entry.totalQuestions}
                      </td>
                      <td>{entry.percentage}%</td>
                      <td>
                        {Math.floor(entry.durationMilliseconds / 60000)}:
                        {((entry.durationMilliseconds % 60000) / 1000)
                          .toFixed(3)
                          .padStart(6, '0')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
