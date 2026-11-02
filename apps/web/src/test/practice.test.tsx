import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from '../app/App';
import type { QuizAttempt, QuizResult } from '../features/practice/types';

const student = {
  id: 'practice-user',
  email: 'practice@example.edu',
  displayName: 'Ada Okoro',
  role: 'STUDENT',
  verificationStatus: null,
  createdAt: '2026-11-02T12:00:00Z',
};
const quiz = {
  id: 'quiz-id',
  title: 'Cell biology',
  description: 'A focused review',
  status: 'PUBLISHED',
  mode: 'PRACTICE',
  revision: 1,
  timeLimitSeconds: 600,
  questionCount: 2,
};
const attempt: QuizAttempt = {
  id: 'attempt-id',
  quizId: quiz.id,
  title: quiz.title,
  status: 'IN_PROGRESS',
  attemptNumber: 1,
  startedAt: '2026-11-02T12:00:00Z',
  serverNow: '2026-11-02T12:00:00Z',
  expiresAt: '2026-11-02T12:10:00Z',
  questions: [
    {
      id: 'question-one',
      prompt: 'Which structure contains DNA?',
      options: [
        { id: 'option-one', text: 'Nucleus' },
        { id: 'option-two', text: 'Cell wall' },
        { id: 'option-three', text: 'Vacuole' },
        { id: 'option-four', text: 'Membrane' },
      ],
    },
    {
      id: 'question-two',
      prompt: 'Which organelle produces ATP?',
      options: [
        { id: 'option-five', text: 'Mitochondrion' },
        { id: 'option-six', text: 'Ribosome' },
        { id: 'option-seven', text: 'Golgi body' },
        { id: 'option-eight', text: 'Lysosome' },
      ],
    },
  ],
  answers: [],
};
const result: QuizResult = {
  id: attempt.id,
  quizId: quiz.id,
  title: quiz.title,
  attemptNumber: 1,
  status: 'SUBMITTED',
  totalQuestions: 2,
  correctAnswers: 1,
  incorrectAnswers: 1,
  percentage: 50,
  durationSeconds: 75,
  finalizedAt: '2026-11-02T12:01:15Z',
  questions: attempt.questions.map((question, index) => ({
    ...question,
    selectedOptionId: index === 0 ? 'option-one' : null,
    correctOptionId: question.options[0]!.id,
    explanation: 'This explanation appears only after submission.',
  })),
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function open(
  path: string,
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi
    .fn()
    .mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/auth/me')
        ? Promise.resolve(json({ user: student }))
        : Promise.resolve(handler(path, init)),
    );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe('personal practice interface', () => {
  it('shows an honest empty library with an actionable create link', async () => {
    open('/practice', () => json({ quizzes: [], total: 0 }));
    expect(
      await screen.findByText('Your next question starts here'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Create your first quiz/ }),
    ).toHaveAttribute('href', '/practice/new');
    expect(
      screen.queryByRole('navigation', { name: 'Page navigation' }),
    ).not.toBeInTheDocument();
  });

  it('creates draft questions with a selected answer and supports removing questions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = open('/practice/new', (path, init) => {
      if (path === '/api/v1/quizzes' && init?.method === 'POST')
        return json({
          ...quiz,
          ...JSON.parse(String(init.body)),
          status: 'DRAFT',
          revision: 0,
        });
      if (path.endsWith('/draft'))
        return json({ ...quiz, status: 'DRAFT', questions: [] });
      return json({ quizzes: [], total: 0 });
    });
    await screen.findByRole('heading', { name: 'Create a practice quiz' });
    await userEvent.type(screen.getByLabelText('Quiz title'), quiz.title);
    await userEvent.click(
      screen.getByRole('button', { name: 'Add question +' }),
    );
    await userEvent.type(
      screen.getByLabelText('Question 1 text'),
      attempt.questions[0]!.prompt,
    );
    for (const [index, option] of attempt.questions[0]!.options.entries())
      await userEvent.type(
        screen.getByLabelText(
          `Question 1 option ${String.fromCharCode(65 + index)}`,
        ),
        option.text,
      );
    await userEvent.click(screen.getByLabelText('Question 1 correct answer B'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Add question +' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove question 2' }),
    );
    expect(screen.queryByLabelText('Question 2 text')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('heading', { name: 'Edit your quiz' });
    const call = fetchMock.mock.calls.find(
      (call) => call[0] === '/api/v1/quizzes' && call[1]?.method === 'POST',
    );
    expect(JSON.parse(call![1].body).questions[0].correctOption).toBe(1);
    expect(JSON.parse(call![1].body).questions).toHaveLength(1);
  });

  it('starts or resumes a quiz without rendering answer keys', async () => {
    open('/practice/quiz-id', (path, init) =>
      json(
        init?.method === 'POST' || path.includes('/attempts/') ? attempt : quiz,
      ),
    );
    expect(
      await screen.findByRole('heading', { name: quiz.title }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Start or resume practice/ }),
    );
    expect(
      await screen.findByText(attempt.questions[0]!.prompt),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent('10:00');
    expect(
      screen.queryByText('This explanation appears only after submission.'),
    ).not.toBeInTheDocument();
  });

  it('shows unsaved answers on connection failure, blocks submission, and retries safely', async () => {
    let fail = true;
    const fetchMock = open('/practice/attempts/attempt-id', (path) => {
      if (path.includes('/answers/')) {
        if (fail) return Promise.reject(new TypeError('offline'));
        return json({
          questionId: 'question-one',
          selectedOptionId: 'option-one',
          revision: 1,
        });
      }
      return json(attempt);
    });
    await screen.findByText(attempt.questions[0]!.prompt);
    await userEvent.click(screen.getByRole('radio', { name: /Nucleus/ }));
    expect(await screen.findByText('Answer not saved')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Nucleus/ })).toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Submit attempt' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Next question' }),
    ).toBeDisabled();
    fail = false;
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry saving answer' }),
    );
    expect(await screen.findByText('Answer saved')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Submit attempt' }),
    ).toBeEnabled();
    const saves = fetchMock.mock.calls.filter((call) =>
      call[0].includes('/answers/'),
    );
    expect(saves.map((call) => JSON.parse(call[1].body).revision)).toEqual([
      0, 0,
    ]);
  });

  it('restores saved answers and supports question navigation and clearing', async () => {
    open('/practice/attempts/attempt-id', (path) =>
      path.includes('/answers/')
        ? json({
            questionId: 'question-one',
            selectedOptionId: null,
            revision: 2,
          })
        : json({
            ...attempt,
            answers: [
              {
                questionId: 'question-one',
                selectedOptionId: 'option-one',
                revision: 1,
              },
            ],
          }),
    );
    expect(await screen.findByRole('radio', { name: /Nucleus/ })).toBeChecked();
    await userEvent.click(
      screen.getByRole('button', { name: 'Next question' }),
    );
    expect(screen.getByText(attempt.questions[1]!.prompt)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Nucleus/ })).not.toBeChecked(),
    );
  });

  it('submits only saved answers and displays the stored grade and review', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open('/practice/attempts/attempt-id', (path) =>
      json(
        path.endsWith('/result')
          ? result
          : path.endsWith('/submit')
            ? { ...attempt, status: 'SUBMITTED' }
            : attempt,
      ),
    );
    await screen.findByText(attempt.questions[0]!.prompt);
    await userEvent.click(
      screen.getByRole('button', { name: 'Submit attempt' }),
    );
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Question review' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('This explanation appears only after submission.'),
    ).toHaveLength(2);
    expect(screen.getByText('1:15')).toBeInTheDocument();
  });

  it('routes finalized attempts to results and makes incorrect-question drafts editable', async () => {
    open('/practice/attempts/attempt-id', (path) => {
      if (path.endsWith('/retry-incorrect'))
        return json({ ...quiz, id: 'retry-id', status: 'DRAFT' });
      if (path.endsWith('/draft'))
        return json({
          ...quiz,
          id: 'retry-id',
          status: 'DRAFT',
          questions: [],
        });
      return json(
        path.endsWith('/result') ? result : { ...attempt, status: 'EXPIRED' },
      );
    });
    await screen.findByText('50%');
    await userEvent.click(
      screen.getByRole('button', { name: 'Practise incorrect questions' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Edit your quiz' }),
    ).toBeInTheDocument();
  });

  it('shows history results and links to the immutable review', async () => {
    open('/practice/history', () =>
      json({
        total: 1,
        attempts: [
          {
            id: attempt.id,
            quizId: quiz.id,
            title: quiz.title,
            attemptNumber: 1,
            status: 'EXPIRED',
            score: 1,
            totalQuestions: 2,
            durationSeconds: 60,
            finalizedAt: result.finalizedAt,
          },
        ],
      }),
    );
    expect(
      await screen.findByRole('cell', { name: '1/2' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute(
      'href',
      '/practice/attempts/attempt-id/result',
    );
    expect(screen.getByText(/Time expired/)).toBeInTheDocument();
  });
});
