import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { Brand } from '../components/Brand';
import { Feedback, Loading } from '../components/Feedback';
import { api } from '../lib/api';
import { sessionKey, useSession } from '../features/auth/session';

export function Workspace() {
  const session = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (session.isPending) return <Loading />;
  if (session.error) return <main className="standalone"><Feedback message={session.error.message} retry={() => { void session.refetch(); }} /></main>;
  if (!session.data) return <Navigate to="/login" replace />;
  const user = session.data;

  async function logout() {
    setPending(true);
    setError('');
    try {
      await api<void>('/auth/logout', { method: 'POST', body: '{}' }, false);
      client.clear();
      client.setQueryData(sessionKey, null);
      navigate('/login', { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign out failed. Please try again.');
    } finally { setPending(false); }
  }

  return <div className="workspace">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="mobile-header"><span>AI Quiz</span><button className="button secondary" onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-controls="workspace-navigation">{menuOpen ? 'Close menu' : 'Menu'}</button></header>
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`} id="workspace-navigation">
      <Brand />
      <div className="workspace-label">{user.role === 'LECTURER' ? 'Lecturer workspace' : 'Student workspace'}</div>
      <nav aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
        <NavLink to="/dashboard">Overview <span aria-hidden="true">↗</span></NavLink>
        <NavLink to="/courses">My courses</NavLink>
        <NavLink to="/banks">Question banks</NavLink>
        <NavLink to="/ai">Generate questions</NavLink>
        {user.role === 'STUDENT' ? <><NavLink to="/practice" end>My practice quizzes</NavLink><NavLink to="/practice/history">Practice history</NavLink></> : null}
        {user.role === 'LECTURER' ? <NavLink to="/verification">Lecturer verification</NavLink> : null}
        <NavLink to="/account">My account</NavLink>
      </nav>
      <div className="sidebar-account">
        <div className="identity"><span className="initial" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}</strong><span>{user.role === 'LECTURER' ? 'Lecturer' : 'Student'}</span></div></div>
        <button className="sign-out" onClick={() => { void logout(); }} disabled={pending}>{pending ? 'Signing out…' : 'Sign out'} <span aria-hidden="true">↗</span></button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </aside>
    <main className="workspace-sheet" id="main-content"><div className="canvas"><Outlet context={user} /></div></main>
  </div>;
}

export function NotFound() {
  return <main className="standalone"><Brand /><h1>Page not found</h1><p>This address doesn’t lead to a page.</p><Link className="button secondary" to="/">Return to your workspace</Link></main>;
}
