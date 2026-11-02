import { Navigate } from 'react-router';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
import { useSession } from '../auth/session';
import { Feedback } from '../../components/Feedback';

export function Verification() {
  const user = useWorkspaceUser();
  const session = useSession();
  if (user.role !== 'LECTURER') return <Navigate to="/dashboard" replace />;
  const approved = user.verificationStatus === 'APPROVED';
  const rejected = user.verificationStatus === 'REJECTED';
  return <>
    <div className="page-heading"><p className="context-label">Teaching / Lecturer verification</p><h1>Lecturer verification</h1><p className="muted">A trusted starting point for official assessments.</p></div>
    <section className="settings-row"><div><h2>Your verification</h2><p className="muted">Only verified lecturers can create official academic assessments.</p></div><div className="panel verification-panel"><span className={`status ${approved ? 'positive' : rejected ? 'negative' : 'warning'}`}>{approved ? 'Approved' : rejected ? 'Not approved' : 'Pending review'}</span><h2>{approved ? 'Your lecturer account is verified' : rejected ? 'Your account needs further review' : 'Your lecturer account awaits review'}</h2><p className="muted">{approved ? 'Your account meets the verification requirement for official assessments.' : 'Contact your institution’s designated operator. They will confirm your lecturer status and review your account.'}</p><p className="field-hint">Account email: {user.email}</p><button className="button secondary" onClick={() => { void session.refetch(); }} disabled={session.isFetching}>{session.isFetching ? 'Checking…' : 'Check verification status'}</button>{session.error ? <Feedback message={session.error.message} /> : null}</div></section>
  </>;
}
