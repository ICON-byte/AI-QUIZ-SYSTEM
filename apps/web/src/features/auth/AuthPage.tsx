import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router';
import { api, ApiError, type User } from '../../lib/api';
import { sessionKey, useSession } from './session';
import { Brand } from '../../components/Brand';
import { Feedback, Loading } from '../../components/Feedback';

export function AuthPage({ register = false }: { register?: boolean }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [role, setRole] = useState<'STUDENT' | 'LECTURER'>('STUDENT');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  if (session.isPending) return <Loading />;
  if (session.error) return <main className="standalone"><Feedback message={session.error.message} retry={() => { void session.refetch(); }} /></main>;
  if (session.data) return <Navigate to="/dashboard" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password'));
    if (new TextEncoder().encode(password).length > 72) {
      setError(new ApiError(400, 'Use a password of at most 72 UTF-8 bytes.'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api<{ user: User }>(register ? '/auth/register' : '/auth/login', {
        method: 'POST', body: JSON.stringify({
          email: String(data.get('email')).trim(), password,
          ...(register ? { displayName: String(data.get('displayName')).trim(), role } : {})
        })
      }, false);
      queryClient.setQueryData(sessionKey, result.user);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setError(error instanceof ApiError ? error : new ApiError(0, 'Unable to sign in. Please try again.'));
    } finally { setPending(false); }
  }

  return <main className="auth-layout">
    <section className="auth-intro" aria-label="About AI Quiz">
      <Brand />
      <div className="intro-copy">
        <p className="context-label">A space for better learning</p>
        <h2>Make room for<br />what you know.</h2>
        <p>Your academic work, with a clear place to begin. One account for your role in the classroom.</p>
        <div className="academic-note">
          <span className="note-label">Learning starts with a question.</span>
          <p>For students who want to understand.<br />For lecturers who want to see progress.</p>
        </div>
      </div>
      <p className="intro-footer">AI-Powered Online Quiz System</p>
    </section>
    <section className="auth-form-region">
      <div className="auth-form-wrap">
        <p className="context-label">{register ? 'Your first step' : 'Your workspace awaits'}</p>
        <h1>{register ? 'Create your account' : 'Sign in'}</h1>
        <p className="muted auth-description">{register ? 'Choose your role and get settled in.' : 'Continue with your email and password.'}</p>
        <form onSubmit={event => { void submit(event); }} aria-busy={pending}>
          {register ? <fieldset className="role-picker" disabled={pending}>
            <legend>I’m joining as a</legend>
            <div className="role-options">
              {(['STUDENT', 'LECTURER'] as const).map(value => <label key={value} className={role === value ? 'role-option selected' : 'role-option'}>
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
                <span>{value === 'STUDENT' ? 'Student' : 'Lecturer'}</span>
              </label>)}
            </div>
            {role === 'LECTURER' ? <p className="field-hint">Lecturer accounts require verification before creating official assessments.</p> : null}
          </fieldset> : null}
          {register ? <label className="field">Full name
            <input name="displayName" autoComplete="name" required minLength={2} maxLength={80} disabled={pending} />
          </label> : null}
          <label className="field">Email address
            <input name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending} />
          </label>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-input">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'}
                required minLength={register ? 12 : 1} maxLength={72} disabled={pending} aria-describedby={register ? 'password-hint' : undefined} />
              <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
            {register ? <p className="field-hint" id="password-hint">Use at least 12 characters. A longer passphrase works well.</p> : null}
          </div>
          {error ? <div role="alert" className="form-error"><p>{error.message}</p>
            {error.fields.length ? <ul>{error.fields.map((field, index) => <li key={index}>{field.field}: {field.message}</li>)}</ul> : null}
          </div> : null}
          <button className="button primary auth-submit" type="submit" disabled={pending}>
            {pending ? (register ? 'Creating account…' : 'Signing in…') : (register ? 'Create account' : 'Sign in')}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p className="auth-switch">{register ? 'Already have an account?' : 'New to AI Quiz?'} <Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>
      </div>
    </section>
  </main>;
}
