import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
import { Feedback } from '../../components/Feedback';
import { api, ApiError } from '../../lib/api';
import { sessionKey } from '../auth/session';

export function Dashboard() {
  const user = useWorkspaceUser();
  const client = useQueryClient();
  const lecturer = user.role === 'LECTURER';
  const dashboard = useQuery({
    queryKey: ['dashboard', user.id, user.role],
    queryFn: () => api<{ role: string; verificationStatus?: string }>(`/dashboard/${lecturer ? 'lecturer' : 'student'}`),
    retry: false
  });
  if (dashboard.error instanceof ApiError && dashboard.error.status === 401) {
    return <Feedback message="Your session has ended. Please sign in again." retryLabel="Sign in again" retry={() => client.setQueryData(sessionKey, null)} />;
  }
  const verified = user.verificationStatus === 'APPROVED';

  return <>
    <div className="page-heading"><p className="context-label">{lecturer ? 'Teaching' : 'Learning'} / Overview</p><h1>Hello, {user.displayName.split(' ')[0]}.</h1><p className="muted">{lecturer ? 'Your teaching workspace starts here.' : 'A clear place for your academic work.'}</p></div>
    {dashboard.error ? <Feedback message={dashboard.error.message} retry={() => { void dashboard.refetch(); }} /> : null}
    {dashboard.isPending ? <p role="status">Checking workspace access…</p> : null}
    <div className="home-grid">
      <section className="panel welcome-panel">
        <div className="section-heading"><h2>{lecturer ? 'Ready for the classroom' : 'Your learning, in one place'}</h2><span className="status neutral">{lecturer ? 'Lecturer' : 'Student'}</span></div>
        <div className="workspace-note"><span className="note-rule" aria-hidden="true" /><p>{lecturer ? 'Good assessment begins with a clear question.' : 'Understanding begins with a little curiosity.'}</p></div>
        <p className="muted">{lecturer ? 'Your account is set up. Official assessment access depends on lecturer verification.' : 'Your account is set up. Your courses and personal practice will have a home here as they become available.'}</p>
        <Link className="text-link" to={lecturer ? '/verification' : '/account'}>{lecturer ? 'View verification' : 'View your account'} <span aria-hidden="true">↗</span></Link>
      </section>
      <section className="panel access-panel">
        <h2>Workspace access</h2>
        <dl className="access-list"><div><dt>Account</dt><dd><span className="status positive">Active</span></dd></div><div><dt>Role</dt><dd>{lecturer ? 'Lecturer' : 'Student'}</dd></div><div><dt>{lecturer ? 'Lecturer review' : 'Workspace'}</dt><dd>{lecturer ? (verified ? 'Approved' : user.verificationStatus === 'REJECTED' ? 'Not approved' : 'Pending') : 'Personal'}</dd></div></dl>
        <p className="field-hint">{lecturer ? 'Verification is reviewed by an authorized operator.' : 'Official course assessments are created by verified lecturers.'}</p>
      </section>
      <section className="next-step"><div><h2>{lecturer && !verified ? 'One step before official assessments' : 'You’re settled in'}</h2><p className="muted">{lecturer && !verified ? 'Contact your institution’s designated operator to arrange verification of your lecturer account.' : 'Keep your sign-in details private. Sign out when using a shared device.'}</p></div><Link className="button secondary" to="/account">Account details <span aria-hidden="true">↗</span></Link></section>
    </div>
  </>;
}
