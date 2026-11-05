import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from '../app/App';

const student = {
  id: 'student-id',
  displayName: 'Ada Okoro',
  email: 'ada@example.edu',
  role: 'STUDENT',
  verificationStatus: null,
  createdAt: '2026-11-04T12:00:00Z',
};
const bank = {
  id: 'bank-id',
  title: 'Number theory',
  description: 'Reusable number questions.',
  courseId: null,
  revision: 0,
  archivedAt: null,
  questionCount: 1,
};
const question = {
  id: 'question-id',
  bankId: bank.id,
  prompt: 'Which is prime?',
  options: ['2', '4', '6', '8'],
  correctOption: 0,
  explanation: 'Two factors.',
  topic: 'Numbers',
  difficulty: 'EASY',
  revision: 0,
  archivedAt: null,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function open(
  path: string,
  handler: (path: string, init?: RequestInit) => Response,
  lecturer = false,
) {
  const user = lecturer
    ? { ...student, role: 'LECTURER', verificationStatus: 'APPROVED' }
    : student;
  const fetchMock = vi
    .fn()
    .mockImplementation((path: string, init?: RequestInit) =>
      Promise.resolve(
        path.endsWith('/auth/me') ? json({ user }) : handler(path, init),
      ),
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('question banks interface', () => {
  it('shows private banks and navigation to both roles', async () => {
    open('/banks', () => json({ banks: [bank], total: 1 }), true);
    expect(
      await screen.findByRole('link', { name: bank.title }),
    ).toHaveAttribute('href', '/banks/bank-id');
    expect(screen.getByText(/Private to you/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a bank' })).toHaveAttribute(
      'href',
      '/banks/new',
    );
  });
  it('creates a bank with owner-free payload and opens details', async () => {
    const mock = open('/banks/new', (path, init) =>
      json(
        path.includes('/questions')
          ? { questions: [], total: 0 }
          : init?.method === 'POST'
            ? bank
            : bank,
      ),
    );
    await screen.findByRole('heading', { name: 'Create a question bank' });
    await userEvent.type(screen.getByLabelText('Bank title'), bank.title);
    await userEvent.click(screen.getByRole('button', { name: 'Create bank' }));
    expect(
      await screen.findByRole('heading', { name: bank.title }),
    ).toBeInTheDocument();
    const call = mock.mock.calls.find(
      (call) =>
        call[0] === '/api/v1/question-banks' && call[1]?.method === 'POST',
    );
    expect(JSON.parse(call![1].body)).toEqual({
      title: bank.title,
      description: '',
      courseId: null,
    });
  });
  it('shows archived banks as read-only with their saved answers', async () => {
    open('/banks/bank-id', (path) =>
      json(
        path.includes('/questions')
          ? { questions: [question], total: 1 }
          : { ...bank, archivedAt: '2026-11-04T12:00:00Z' },
      ),
    );
    expect(
      await screen.findByRole('heading', { name: question.prompt }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This bank is read-only/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Add question' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('View answers and explanation'));
    expect(screen.getByText(question.explanation)).toBeInTheDocument();
  });
  it('edits bank questions using revision checks and difficulty metadata', async () => {
    const mock = open(
      '/banks/bank-id/questions/question-id/edit',
      (path, init) =>
        json(
          path.endsWith('/questions')
            ? { questions: [question], total: 1 }
            : path.includes('/questions/')
              ? init?.method === 'PUT'
                ? question
                : question
              : bank,
        ),
    );
    await screen.findByRole('heading', { name: 'Edit question' });
    await userEvent.selectOptions(screen.getByLabelText('Difficulty'), 'HARD');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save question' }),
    );
    expect(
      await screen.findByRole('heading', { name: bank.title }),
    ).toBeInTheDocument();
    const call = mock.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(JSON.parse(call![1].body)).toMatchObject({
      revision: 0,
      difficulty: 'HARD',
      correctOption: 0,
    });
  });
  it('shows ownership failures without displaying private bank content', async () => {
    open('/banks/foreign', () =>
      json(
        { error: { message: 'This question bank or question was not found.' } },
        404,
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('not found');
    expect(
      screen.queryByRole('link', { name: 'Add question' }),
    ).not.toBeInTheDocument();
  });
  for (const academic of [false, true])
    it(`selects question copies in the ${academic ? 'assessment' : 'practice'} editor without saving prematurely`, async () => {
      const mock = open(
        academic ? '/courses/course-id/assessments/new' : '/practice/new',
        (path) =>
          json(
            path.endsWith('/selection')
              ? {
                  questions: [
                    {
                      prompt: question.prompt,
                      options: question.options,
                      correctOption: 0,
                      explanation: question.explanation,
                    },
                  ],
                }
              : path.includes('/questions?')
                ? { questions: [question], total: 1 }
                : { banks: [bank], total: 1 },
          ),
        academic,
      );
      await screen.findByRole('heading', {
        name: academic ? 'Create an assessment' : 'Create a practice quiz',
      });
      await userEvent.click(
        screen.getByRole('button', { name: 'Add from question bank' }),
      );
      await userEvent.selectOptions(
        await screen.findByLabelText('Question bank'),
        bank.id,
      );
      await userEvent.click(
        await screen.findByRole('checkbox', { name: /Which is prime/ }),
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Add 1 selected question' }),
      );
      expect(await screen.findByLabelText('Question 1 text')).toHaveValue(
        question.prompt,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        '1 saved question added',
      );
      expect(
        mock.mock.calls.filter((call) => call[1]?.method === 'POST'),
      ).toHaveLength(1);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await userEvent.click(
        screen.getByRole('button', { name: 'Remove question 1' }),
      );
      expect(
        screen.queryByLabelText('Question 1 text'),
      ).not.toBeInTheDocument();
    });
  it('previews files, shows row errors and requires explicit skip and import confirmation', async () => {
    const preview = {
      token: 'signed-token',
      expiresAt: '2026-11-04T14:00:00Z',
      validCount: 1,
      invalidCount: 1,
      rows: [
        { row: 2, line: 2, prompt: question.prompt, errors: [], question },
        {
          row: 3,
          line: 3,
          prompt: 'Bad row',
          errors: ['options: Use four different options.'],
          question: null,
        },
      ],
    };
    const mock = open('/banks/bank-id/import', (path) =>
      json(
        path.endsWith('/preview')
          ? preview
          : path.endsWith('/confirm')
            ? { importedCount: 1, skippedCount: 1 }
            : path.includes('/questions')
              ? { questions: [question], total: 1 }
              : bank,
      ),
    );
    await screen.findByRole('heading', { name: 'Import questions from CSV' });
    const file = new File(['sample csv'], 'questions.csv', {
      type: 'text/csv',
    });
    // jsdom lacks Blob.arrayBuffer; the browser workflow covers native decoding.
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('sample csv').buffer,
    });
    await userEvent.upload(screen.getByLabelText('CSV file'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Preview CSV' }));
    expect(
      await screen.findByText('options: Use four different options.'),
    ).toBeInTheDocument();
    const confirm = screen.getByRole('button', {
      name: 'Confirm import of 1 question',
    });
    expect(confirm).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Import only valid rows/ }),
    );
    expect(confirm).toBeEnabled();
    expect(mock.mock.calls.some((call) => call[0].endsWith('/confirm'))).toBe(
      false,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(confirm);
    expect(
      await screen.findByText('Imported 1 question. 1 row skipped.'),
    ).toBeInTheDocument();
    const call = mock.mock.calls.find((call) => call[0].endsWith('/confirm'));
    expect(JSON.parse(call![1].body)).toMatchObject({
      token: 'signed-token',
      confirmed: true,
      skipInvalid: true,
    });
  });
});
