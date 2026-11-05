import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from '../app/App';
import { api, ApiError, type User } from '../lib/api';

const student: User = {
  id: 'student-id', displayName: 'Ada Okoro', email: 'ada@example.edu', role: 'STUDENT', verificationStatus: null, createdAt: '2026-11-02T12:00:00Z'
};
const lecturer: User = { ...student, id: 'lecturer-id', role: 'LECTURER', verificationStatus: 'PENDING' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const unauthorized = () => json({ error: { message: 'Please sign in.' } }, 401);

function open(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('account interface', () => {
  it('redirects unauthenticated users to an accessible sign-in form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(unauthorized())));
    open('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('submits the selected lecturer role without storing tokens in browser storage', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/register')) return Promise.resolve(json({ user: lecturer }, 201));
      if (path.includes('/dashboard/')) return Promise.resolve(json({ role: 'LECTURER', verificationStatus: 'PENDING' }));
      return Promise.resolve(unauthorized());
    });
    vi.stubGlobal('fetch', fetchMock);
    open('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await userEvent.click(screen.getByLabelText('Lecturer'));
    expect(screen.getByText(/require verification before/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Full name'), lecturer.displayName);
    await userEvent.type(screen.getByLabelText('Email address'), lecturer.email);
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-test-passphrase');
    await userEvent.click(screen.getByRole('checkbox', { name: 'I confirm that I am at least 18 years old.' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Ada.' })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(call => String(call[0]).endsWith('/auth/register'));
    expect(JSON.parse(call![1].body).role).toBe('LECTURER');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shows server login errors without leaving the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(path.endsWith('/auth/login')
      ? json({ error: { message: 'Email or password is incorrect.' } }, 401) : unauthorized())));
    open('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.type(screen.getByLabelText('Email address'), student.email);
    await userEvent.type(screen.getByLabelText('Password'), 'incorrect-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('renders student navigation and prevents a lecturer-only page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(path.endsWith('/auth/me') ? json({ user: student }) : json({ role: 'STUDENT' }))));
    open('/verification');
    expect(await screen.findByRole('heading', { name: 'Hello, Ada.' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lecturer verification' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My account' })).toBeInTheDocument();
  });

  it('allows pending lecturers to check changed verification status', async () => {
    let approved = false;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json({ user: { ...lecturer, verificationStatus: approved ? 'APPROVED' : 'PENDING' } }))));
    open('/verification');
    expect(await screen.findByText('Your lecturer account awaits review')).toBeInTheDocument();
    approved = true;
    await userEvent.click(screen.getByRole('button', { name: 'Check verification status' }));
    expect(await screen.findByText('Your lecturer account is verified')).toBeInTheDocument();
  });

  it('signs out through the API and clears the authenticated screen', async () => {
    let loggedOut = false;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/logout')) { loggedOut = true; return Promise.resolve(new Response(null, { status: 204 })); }
      if (loggedOut) return Promise.resolve(unauthorized());
      return Promise.resolve(json(path.endsWith('/auth/me') ? { user: student } : { role: 'STUDENT' }));
    }));
    open('/dashboard');
    await screen.findByRole('heading', { name: 'Hello, Ada.' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a retryable connection error instead of a misleading sign-in redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')));
    open('/dashboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('recovers from server revocation without looping between protected and sign-in routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(path.endsWith('/auth/me') ? json({ user: student }) : unauthorized())));
    open('/dashboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended.');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('session expiry client', () => {
  it('coalesces simultaneous refresh requests', async () => {
    let refreshed = false;
    let refreshCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('/auth/refresh')) {
        refreshCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        refreshed = true;
        return json({ user: student });
      }
      return refreshed ? json({ user: student }) : unauthorized();
    }));
    const results = await Promise.all([api('/auth/me'), api('/auth/me')]);
    expect(results).toHaveLength(2);
    expect(refreshCount).toBe(1);
    await waitFor(() => expect(refreshed).toBe(true));
  });

  it('preserves authentication failure after a failed refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(unauthorized())));
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
  });
});
