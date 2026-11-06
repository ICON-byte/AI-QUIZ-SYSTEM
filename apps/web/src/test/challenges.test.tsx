import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from '../app/App';
import { invitationReturn } from '../features/auth/return';
const user = {
  id: 'student-id',
  displayName: 'Ada Okoro',
  email: 'ada@example.edu',
  role: 'STUDENT',
  verificationStatus: null,
  createdAt: '2026-11-05T00:00:00Z',
  ageConfirmed: true,
};
const quiz = {
  id: 'quiz-id',
  title: 'Friends biology',
  description: 'Practice with friends',
  mode: 'CHALLENGE',
  status: 'PUBLISHED',
  state: 'OPEN',
  revision: 1,
  questionCount: 1,
  timeLimitSeconds: null,
  closesAt: null,
  closedAt: null,
  maxAttempts: 1,
  serverNow: new Date().toISOString(),
  isCreator: false,
  attempts: [],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function open(
  path: string,
  handler: (path: string, init?: RequestInit) => Response,
  signedIn = true,
  state?: unknown,
) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) =>
    Promise.resolve(
      path.endsWith('/auth/me')
        ? json({ user: signedIn ? user : null })
        : handler(path, init),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter
        initialEntries={[
          {
            pathname: path.split('#')[0]!,
            hash: path.includes('#') ? '#' + path.split('#')[1] : '',
            state,
          },
        ]}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('student challenge workflow', () => {
  it('lists created, joined and historical challenges without invented participation', async () => {
    open('/challenges', () =>
      json({ quizzes: [], total: 0, sharingAvailable: true }),
    );
    expect(
      await screen.findByText('You have not created a challenge yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Joined' })).toHaveAttribute(
      'href',
      '/challenges?view=joined',
    );
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      '/challenges/history',
    );
  });
  it('requires an explicit join from a prefilled invitation and does not start an attempt', async () => {
    const code = 'A'.repeat(24);
    const mock = open('/challenges/join#code=' + code, (path, init) =>
      json(init?.method === 'POST' ? { id: quiz.id } : quiz),
    );
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(code);
    expect(mock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(
      false,
    );
    expect(
      screen.getByText(/Joining shares your display name/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Join challenge' }),
    );
    await screen.findByRole('heading', { name: quiz.title });
    expect(mock.mock.calls.some((call) => call[0].endsWith('/attempts'))).toBe(
      false,
    );
    expect(
      JSON.parse(
        mock.mock.calls.find((call) => call[0].endsWith('/join'))![1]!
          .body as string,
      ),
    ).toEqual({ code });
  });
  it('preserves invitation return through login and registration without automatic enrollment', async () => {
    const code = 'B'.repeat(24);
    let authenticated = false;
    const mock = open(
      '/challenges/join#code=' + code,
      (path, init) => {
        if (path.endsWith('/auth/register') && init?.method === 'POST') {
          authenticated = true;
          return json({ user });
        }
        return json(authenticated ? quiz : { user: null });
      },
      false,
    );
    await userEvent.click(
      await screen.findByRole('link', { name: 'Create an account' }),
    );
    await userEvent.type(screen.getByLabelText('Full name'), 'Ada Okoro');
    await userEvent.type(
      screen.getByLabelText('Email address'),
      'ada@example.edu',
    );
    await userEvent.type(
      screen.getByLabelText('Password'),
      'secure-test-passphrase',
    );
    await userEvent.type(screen.getByLabelText('Confirm password'), 'secure-test-passphrase');
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I confirm that I am at least 18/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    );
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(code);
    expect(
      mock.mock.calls.some((call) => call[0].endsWith('/challenges/join')),
    ).toBe(false);
  });
  it('rejects external, malformed or unrelated post-login returns', () => {
    for (const path of [
      'https://attacker.invalid',
      '//attacker.invalid',
      '/challenges/join?redirect=bad',
      '/challenges/join#code=bad',
      '/courses',
      '/challenges/join/../account',
    ])
      expect(invitationReturn(path)).toBe('/dashboard');
    expect(
      invitationReturn('/challenges/join#code=' + 'a'.repeat(24)),
    ).toContain('/challenges/join#code=');
  });
  it('uses the shared editor with an optional schedule, question banks and AI review', async () => {
    open('/challenges/new', () => json({}));
    expect(
      await screen.findByRole('heading', { name: 'Create a challenge' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Closing date and time/)).not.toBeRequired();
    expect(
      screen.getByRole('button', { name: 'Generate with AI' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /question bank/i }),
    ).toBeInTheDocument();
  });
  it('retrieves invitations only on creator action and confirms permanent closure', async () => {
    let closed = false;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const mock = open('/challenges/quiz-id/manage', (path, init) => {
      if (path.endsWith('/invitation'))
        return json({
          code: 'C'.repeat(24),
          link: 'http://localhost/challenges/join#code=' + 'C'.repeat(24),
        });
      if (init?.method === 'POST') {
        closed = true;
        return json({ closedAt: new Date().toISOString() });
      }
      return json({
        ...quiz,
        isCreator: true,
        state: closed ? 'CLOSED' : 'OPEN',
        sharingAvailable: true,
        statistics: { joined: 2, started: 1, finalized: 0, inProgress: 1 },
      });
    });
    await screen.findByRole('heading', { name: quiz.title });
    expect(
      mock.mock.calls.some((call) => call[0].endsWith('/invitation')),
    ).toBe(false);
    await userEvent.click(
      screen.getByRole('button', { name: 'Show invitation' }),
    );
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(
      'C'.repeat(24),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Close challenge' }),
    );
    expect(await screen.findByText(/Closed permanently/)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByLabelText('Invitation code')).not.toBeInTheDocument();
  });
  it('shows millisecond competition ties and exposes no participant account identifiers', async () => {
    open('/challenges/quiz-id/leaderboard', () =>
      json({
        total: 3,
        closed: false,
        updating: false,
        entries: [
          {
            rank: 1,
            displayName: 'Ada',
            score: 1,
            totalQuestions: 1,
            percentage: 100,
            durationMilliseconds: 1001,
            isYou: true,
          },
          {
            rank: 1,
            displayName: 'Emeka',
            score: 1,
            totalQuestions: 1,
            percentage: 100,
            durationMilliseconds: 1001,
            isYou: false,
          },
          {
            rank: 3,
            displayName: 'Chika',
            score: 1,
            totalQuestions: 1,
            percentage: 100,
            durationMilliseconds: 1002,
            isYou: false,
          },
        ],
      }),
    );
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('0:01.001')).toHaveLength(2);
    expect(within(table).getByText('Ada (you)')).toBeInTheDocument();
    expect(within(table).getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  });
  it('shows summary scores and leaderboard navigation while withholding challenge review and retakes', async () => {
    open('/challenges/attempts/attempt-id/result', () =>
      json({
        id: 'attempt-id',
        quizId: quiz.id,
        mode: 'CHALLENGE',
        title: quiz.title,
        status: 'SUBMITTED',
        attemptNumber: 1,
        totalQuestions: 1,
        correctAnswers: 1,
        incorrectAnswers: 0,
        percentage: 100,
        durationSeconds: 2,
        reviewAvailable: false,
        reviewReleaseAt: null,
        questions: [],
      }),
    );
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Answer review opens after closure',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View leaderboard' }),
    ).toHaveAttribute('href', '/challenges/quiz-id/leaderboard');
    expect(
      screen.queryByRole('link', { name: /Retake/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Practise incorrect/ }),
    ).not.toBeInTheDocument();
  });
});
