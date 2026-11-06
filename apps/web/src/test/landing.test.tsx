import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../app/App';
import { QuizDemo } from '../features/landing/QuizDemo';
import { sample } from '../features/landing/demoContent';

function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('public landing page', () => {
  it('renders the public story immediately while the session is pending', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    open();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Turn notes into questions/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /Create your account/ })[0],
    ).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: /Create a lecturer account/ }))
      .toHaveAttribute('href', '/register?role=LECTURER');
    expect(
      screen.queryByText('Opening your workspace…'),
    ).not.toBeInTheDocument();
    const hero = document.querySelector('.lp-hero')!;
    expect(within(hero as HTMLElement).getByRole('button', { name: /Try this question/ })).toBeInTheDocument();
    expect(document.querySelectorAll('.lp-demo')).toHaveLength(1);
    expect(document.getElementById('banks')!.compareDocumentPosition(document.getElementById('practice')!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps the local demo usable when the API is unavailable, without generation or attempt requests', async () => {
    const requests = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', requests);
    open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Try this question/ }));
    expect(screen.getByRole('button', { name: /Check answer/ })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 2, name: 'What do you think?' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Sorted input' }));
    await user.click(screen.getByRole('button', { name: /Check answer/ }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Exactly. Order makes it work.',
    );
    expect(
      screen.getByText('Sample complete. No attempt was saved.'),
    ).toBeInTheDocument();
    expect(
      requests.mock.calls.every((call) =>
        String((call as unknown[])[0]).includes('/auth/'),
      ),
    ).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it.each(['STUDENT', 'LECTURER'])(
    'offers the workspace to a signed-in %s without redirecting the public page',
    async (role) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                user: {
                  id: 'public-test',
                  displayName: 'Ada',
                  role,
                  verificationStatus: null,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          ),
        ),
      );
      open();
      await waitFor(() =>
        expect(
          screen.getAllByRole('link', { name: /Open workspace/ }).length,
        ).toBeGreaterThan(0),
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Turn notes into questions.',
      );
      expect(
        screen.getAllByRole('link', { name: /Open workspace/ })[0],
      ).toHaveAttribute('href', '/dashboard');
      expect(
        screen.queryByRole('link', { name: 'Sign in' }),
      ).not.toBeInTheDocument();
    },
  );

  it('supports menu expansion, Escape focus return and working section links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    open();
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: /Menu/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    for (const link of within(
      screen.getByRole('navigation', { name: 'Public navigation' }),
    ).getAllByRole('link')) {
      const href = link.getAttribute('href')!;
      if (href.startsWith('#'))
        expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
  });

  it('discloses AI privacy and verification requirements in the FAQ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    open();
    await userEvent.click(
      screen.getByText('What happens to material used with AI?'),
    );
    expect(
      screen.getByText(
        /Google may use inputs and responses for product improvement/,
      ),
    ).toBeVisible();
    await userEvent.click(
      screen.getByText('Who can create official assessments?'),
    );
    expect(
      screen.getByText(/an authorized operator must verify it/),
    ).toBeVisible();
  });
});

describe('prepared question demonstration', () => {
  it('connects the source, edits wording and retains it through answering', async () => {
    render(<QuizDemo />);
    const user = userEvent.setup();
    const source = screen.getByRole('button', {
      name: /Inspect supporting source/,
    });
    await user.click(source);
    expect(source).toHaveAttribute('aria-expanded', 'true');
    expect(source).toHaveAttribute('aria-controls', 'sample-evidence');
    expect(screen.getByText(`“${sample.quote}”`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Edit wording/ }));
    const field = screen.getByRole('textbox', { name: /Question wording/ });
    expect(field).toHaveFocus();
    await user.clear(field);
    expect(
      screen.getByRole('button', { name: /Try this question/ }),
    ).toBeDisabled();
    await user.type(field, 'Which condition does binary search need?');
    await user.click(screen.getByRole('button', { name: /Keep wording/ }));
    await user.click(screen.getByRole('button', { name: /Try this question/ }));
    expect(
      screen.getByRole('group', {
        name: 'Which condition does binary search need?',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('explains an incorrect choice and resets answer state when returning to review', async () => {
    render(<QuizDemo />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Try this question/ }));
    await user.click(
      screen.getByRole('radio', { name: 'Only positive numbers' }),
    );
    await user.click(screen.getByRole('button', { name: /Check answer/ }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'The key is sorted input.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(sample.explanation);
    expect(screen.getByLabelText('Sample answer feedback')).toHaveFocus();
    expect(screen.getByRole('radio', { name: /Sorted input/ })).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: /Back to question review/ }),
    );
    await user.click(screen.getByRole('button', { name: /Try this question/ }));
    expect(screen.getByRole('button', { name: /Check answer/ })).toBeDisabled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
