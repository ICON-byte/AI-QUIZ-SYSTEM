import { useWorkspaceUser } from '../../app/useWorkspaceUser';

export function Account() {
  const user = useWorkspaceUser();
  return <>
    <div className="page-heading"><p className="context-label">Workspace / My account</p><h1>My account</h1><p className="muted">Your identity in the classroom.</p></div>
    <section className="settings-row"><div><h2>Profile</h2><p className="muted">The details associated with your account.</p></div><dl className="panel detail-list"><div><dt>Full name</dt><dd>{user.displayName}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div><div><dt>Role</dt><dd>{user.role === 'LECTURER' ? 'Lecturer' : 'Student'}</dd></div><div><dt>Joined</dt><dd>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(user.createdAt))}</dd></div></dl></section>
    <section className="settings-row"><div><h2>Session security</h2><p className="muted">A little care keeps your academic work private.</p></div><div className="panel"><h3>Using a shared device?</h3><p className="muted">Sign out from the navigation when you’re finished. Signing out ends this session on the server.</p><p className="field-hint">For your security, sessions expire and require you to sign in again.</p></div></section>
  </>;
}
