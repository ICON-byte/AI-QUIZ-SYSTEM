import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  createdAt: '2026-11-05T00:00:00Z',
  ageConfirmed: true,
};
const caps = {
  available: true,
  ageConfirmed: true,
  remaining: 5,
  used: 0,
  reserved: 0,
  dailyLimit: 5,
  resetsAt: '2026-11-06T00:00:00Z',
  currentJobId: null,
  limits: { fileBytes: 5242880, characters: 40000, pages: 100 },
};
const questions = Array.from({ length: 5 }, (_, i) => ({
  prompt: `Cell transport question ${i + 1}`,
  options: ['Membrane', 'Nucleus', 'Ribosome', 'Vacuole'],
  correctOption: 0,
  explanation: 'Membranes regulate transport.',
  difficulty: 'MEDIUM',
  topic: 'Cells',
  source: null,
}));
const job = {
  id: 'job-id',
  status: 'READY',
  deadlineAt: '2026-11-05T12:00:00Z',
  expiresAt: '2026-11-06T12:00:00Z',
  result: { questions },
  acceptance: null,
  failure: null,
};
const groundedJob = {
  ...job,
  result: {
    questions: questions.map((q) => ({
      ...q,
      source: {
        label: 'Page 3',
        quote: 'The cell membrane regulates transport.',
      },
    })),
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function open(
  path: string,
  handler: (path: string, init?: RequestInit) => Response,
  lecturer = false,
) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) =>
    Promise.resolve(
      path.endsWith('/auth/me')
        ? json({
            user: lecturer
              ? { ...student, role: 'LECTURER', verificationStatus: 'APPROVED' }
              : student,
          })
        : path.includes('/question-banks?')
          ? json({ banks: [], total: 0 })
          : handler(path, init),
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
describe('AI generation interface', () => {
  it('explains missing configuration and keeps manual navigation available', async () => {
    open('/ai', () => json({ ...caps, available: false }));
    expect(
      await screen.findByRole('heading', {
        name: 'AI generation is unavailable',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Generate questions' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('link', { name: 'My practice quizzes' }),
    ).toHaveAttribute('href', '/practice');
  });
  it('requires explicit non-sensitive consent before generation and sends an idempotency key', async () => {
    const mock = open('/ai', (path, init) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : init?.method === 'POST'
            ? job
            : job,
      ),
    );
    await screen.findByLabelText('Topic or subject');
    await userEvent.type(
      screen.getByLabelText('Topic or subject'),
      'Cell biology',
    );
    expect(
      screen.getByRole('button', { name: 'Generate questions' }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Generate questions' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Review generated questions',
      }),
    ).toBeInTheDocument();
    const sent = JSON.parse(
      mock.mock.calls.find(
        (call) =>
          call[0].endsWith('/generations') && call[1]?.method === 'POST',
      )![1]!.body as string,
    );
    expect(sent).toMatchObject({
      topic: 'Cell biology',
      count: 5,
      nonSensitiveConfirmed: true,
    });
    expect(sent.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('lets existing accounts confirm age eligibility before using AI', async () => {
    let confirmed = false;
    open('/ai', (path) => {
      if (path.endsWith('/eligibility')) {
        confirmed = true;
        return json({ ageConfirmed: true });
      }
      return json({ ...caps, ageConfirmed: confirmed });
    });
    expect(
      await screen.findByRole('heading', { name: 'Confirm age eligibility' }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'I confirm that I am at least 18 years old.',
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm eligibility' }),
    );
    expect(await screen.findByLabelText('Topic or subject')).toBeEnabled();
  });
  it('edits, rejects and saves selected questions into a new bank', async () => {
    const mock = open('/ai?generation=job-id', (path) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : path.endsWith('/accept')
            ? { bankId: 'bank-id', savedCount: 4 }
            : groundedJob,
      ),
    );
    const first = await screen.findByRole('region', {
      name: 'Generated question 1',
    });
    await userEvent.clear(within(first).getByLabelText('Question text'));
    await userEvent.type(
      within(first).getByLabelText('Question text'),
      'Edited cell question',
    );
    await userEvent.click(within(first).getByLabelText('Correct answer B'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove question 5' }),
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Create a new question bank' }),
    );
    await userEvent.type(
      screen.getByLabelText('New bank title'),
      'Reviewed cells',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save selected to bank' }),
    );
    expect(
      await screen.findByRole('link', { name: /Open question bank/ }),
    ).toHaveAttribute('href', '/banks/bank-id');
    const call = mock.mock.calls.find((call) => call[0].endsWith('/accept'));
    const body = JSON.parse(call![1]!.body as string);
    expect(body.questions).toHaveLength(4);
    expect(body.questions[0].explanation).toContain('Source: Page 3');
    expect(body.questions[0].explanation).toContain(
      'The cell membrane regulates transport.',
    );
    expect(body.questions[0]).toMatchObject({
      prompt: 'Edited cell question',
      correctOption: 1,
    });
  });
  it('requires extracted-text review and sends only the edited text to generation', async () => {
    const mock = open('/ai', (path) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : path.endsWith('/extract')
            ? {
                segments: [
                  {
                    label: 'Paragraph 1',
                    text: 'Private name. Educational text about cell transport.',
                  },
                ],
              }
            : job,
      ),
    );
    await screen.findByLabelText('Generate from');
    await userEvent.selectOptions(
      screen.getByLabelText('Generate from'),
      'DOCUMENT',
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
    );
    await userEvent.upload(
      screen.getByLabelText('Lecture document'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Extract text for review' }),
    );
    const text = await screen.findByLabelText('Paragraph 1');
    await userEvent.clear(text);
    await userEvent.type(
      text,
      'Educational text about cell transport, with all private details removed. '.repeat(
        2,
      ),
    );
    expect(
      screen.getByRole('button', { name: 'Generate questions' }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I have reviewed this text/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Generate questions' }),
    );
    await screen.findByRole('heading', { name: 'Review generated questions' });
    const call = mock.mock.calls.find((call) =>
      call[0].endsWith('/generations'),
    );
    expect(JSON.parse(call![1]!.body as string).segments[0].text).not.toContain(
      'Private name',
    );
    const upload = mock.mock.calls.find((call) => call[0].endsWith('/extract'));
    expect(
      (upload![1]!.headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
  });
  for (const academic of [false, true])
    it(`adds accepted copies to the ${academic ? 'assessment' : 'practice'} draft without nested forms`, async () => {
      const mock = open(
        academic ? '/courses/course-id/assessments/new' : '/practice/new',
        (path, init) =>
          json(
            path.endsWith('/capabilities')
              ? caps
              : path.endsWith('/review')
                ? { questions: JSON.parse(init!.body as string).questions }
                : path.includes('/question-banks')
                  ? { banks: [], total: 0 }
                  : groundedJob,
          ),
        academic,
      );
      await screen.findByRole('button', { name: 'Generate with AI' });
      await userEvent.click(
        screen.getByRole('button', { name: 'Generate with AI' }),
      );
      await screen.findByLabelText('Topic or subject');
      await userEvent.type(
        screen.getByLabelText('Topic or subject'),
        'Cell biology',
      );
      await userEvent.click(
        screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Generate questions' }),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'Add 5 to quiz draft' }),
      );
      expect(await screen.findByLabelText('Question 1 text')).toHaveValue(
        'Cell transport question 1',
      );
      expect(document.querySelectorAll('form form')).toHaveLength(0);
      const reviewCall = mock.mock.calls.find((call) =>
        call[0].endsWith('/review'),
      );
      expect(
        JSON.parse(reviewCall![1]!.body as string).questions[0].explanation,
      ).toContain('Source: Page 3');
      expect(
        (screen.getByLabelText(/Question 1 explanation/) as HTMLTextAreaElement)
          .value,
      ).toContain('Source: Page 3');
      expect(mock.mock.calls.some((call) => call[0].endsWith('/review'))).toBe(
        true,
      );
    });
  it('regenerates as a new request after explicit acknowledgement', async () => {
    const mock = open('/ai', (path) =>
      json(path.endsWith('/capabilities') ? caps : job),
    );
    await screen.findByLabelText('Topic or subject');
    await userEvent.type(
      screen.getByLabelText('Topic or subject'),
      'Cell biology',
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Generate questions' }),
    );
    await screen.findByRole('heading', { name: 'Review generated questions' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(
      screen.getByRole('button', { name: 'Regenerate questions' }),
    );
    const calls = mock.mock.calls.filter((call) =>
      call[0].endsWith('/generations'),
    );
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]![1]!.body as string).idempotencyKey).not.toBe(
      JSON.parse(calls[1]![1]!.body as string).idempotencyKey,
    );
  });
  it('shows bounded job status and safe failure feedback', async () => {
    open('/ai?generation=job-id', (path) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : {
              ...job,
              status: 'FAILED',
              result: null,
              failure: {
                code: 'PROVIDER_QUOTA',
                message:
                  'Google’s quota is exhausted. Your allowance was not used.',
              },
            },
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your allowance was not used',
    );
    expect(
      screen.queryByRole('heading', { name: 'Review generated questions' }),
    ).not.toBeInTheDocument();
  });
});

describe('generation recovery and resumption', () => {
  it('restores saved settings and diagnostics without restoring consent', async () => {
    open('/ai?generation=job-id', (path) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : {
              ...job,
              status: 'FAILED',
              result: null,
              summary: {
                kind: 'TOPIC',
                topic: 'Restored biology',
                difficulty: 'HARD',
                count: 10,
              },
              providerAttempts: 2,
              diagnostics: [
                {
                  attempt: 1,
                  category: 'MALFORMED_JSON',
                  inputTokens: 100,
                  outputTokens: 20,
                  totalTokens: 120,
                },
                {
                  attempt: 2,
                  category: 'INVALID_FIELDS',
                  fields: ['questions.0.explanation'],
                },
              ],
              failure: {
                code: 'INVALID_AI_OUTPUT',
                message: 'The AI response could not be validated.',
              },
            },
      ),
    );
    expect(
      await screen.findByDisplayValue('Restored biology'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Difficulty')).toHaveValue('HARD');
    expect(
      screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
    ).not.toBeChecked();
    await userEvent.click(screen.getByText('Generation diagnostics'));
    expect(screen.getByText(/Input tokens: 100/)).toBeInTheDocument();
    expect(screen.getByText(/questions.0.explanation/)).toBeInTheDocument();
  });
  it('offers recent job resumption and requires a fresh document review for regeneration', async () => {
    open('/ai', (path) =>
      json(
        path.endsWith('/capabilities')
          ? { ...caps, recentJobId: 'job-id' }
          : {
              ...job,
              summary: {
                kind: 'DOCUMENT',
                topic: '',
                difficulty: 'EASY',
                count: 5,
              },
            },
      ),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resume recent generation' }),
    );
    expect(
      await screen.findByText(
        /To regenerate from this document, upload it again/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Regenerate questions' }),
    ).toBeDisabled();
  });
  it('shows actual recovery state and elapsed time without a fabricated percentage', async () => {
    open('/ai?generation=job-id', (path) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : {
              ...job,
              status: 'RUNNING',
              phase: 'RECOVERING',
              createdAt: new Date(Date.now() - 8000).toISOString(),
              result: null,
            },
      ),
    );
    expect(
      await screen.findByText('Preparing one recovery attempt…'),
    ).toBeInTheDocument();
    expect(screen.getByText(/\d+s elapsed/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
  it('does not present a replay action for a permanent request rejection', async () => {
    open('/ai', (path, init) =>
      path.endsWith('/capabilities')
        ? json(caps)
        : init?.method === 'POST'
          ? json(
              {
                error: {
                  message: 'The application call allowance is exhausted.',
                },
              },
              429,
            )
          : json(job),
    );
    await userEvent.type(
      await screen.findByLabelText('Topic or subject'),
      'Cell biology',
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Generate questions' }),
    );
    expect(
      await screen.findByText('The application call allowance is exhausted.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Retry the same generation request',
      }),
    ).not.toBeInTheDocument();
  });
});

describe('lost request response', () => {
  it('reuses the same idempotency key when reconnecting after an ambiguous connection loss', async () => {
    let posts = 0;
    const fetchMock = open('/ai', (path, init) => {
      if (path.endsWith('/capabilities')) return json(caps);
      if (init?.method === 'POST' && ++posts === 1)
        throw new TypeError('Connection interrupted');
      return json(job);
    });
    await userEvent.type(
      await screen.findByLabelText('Topic or subject'),
      'Cell biology',
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I confirm that this topic/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Generate questions' }),
    );
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Retry the same generation request',
      }),
    );
    await screen.findByRole('heading', { name: 'Review generated questions' });
    const requests = fetchMock.mock.calls.filter((call) =>
      call[0].endsWith('/generations'),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]![1]!.body).toBe(requests[1]![1]!.body);
  });
});

describe('document diagnostics', () => {
  it('shows source failure paths and safe counts while leaving unavailable counts unknown', async () => {
    open('/ai?generation=job-id', (path) =>
      json(
        path.endsWith('/capabilities')
          ? caps
          : {
              ...job,
              status: 'FAILED',
              result: null,
              diagnostics: [
                {
                  attempt: 1,
                  category: 'PROVIDER_TEMPORARY',
                  requestedCount: 5,
                  sourceCount: 2,
                  sourceCharacters: 300,
                },
                {
                  attempt: 2,
                  category: 'SOURCE_EXCERPT_MISMATCH',
                  fields: ['questions.0.source.quote'],
                  requestedCount: 5,
                  returnedCount: 5,
                  sourceCount: 2,
                  sourceCharacters: 300,
                },
              ],
              failure: {
                code: 'INVALID_AI_OUTPUT',
                message: 'The AI response could not be validated.',
              },
            },
      ),
    );
    await userEvent.click(await screen.findByText('Generation diagnostics'));
    expect(
      screen.getByText(/unavailable returned \/ 5 requested/),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 returned \/ 5 requested/)).toBeInTheDocument();
    expect(screen.getByText(/questions.0.source.quote/)).toBeInTheDocument();
    expect(screen.getAllByText(/Sources: 2 \(300 characters\)/)).toHaveLength(
      2,
    );
  });
});
