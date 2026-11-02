import { Link, Navigate, Outlet } from 'react-router';
import { useWorkspaceUser } from '../../app/useWorkspaceUser';
export function AcademicArea() {
  const user = useWorkspaceUser();
  if (user.role === 'LECTURER' && user.verificationStatus !== 'APPROVED')
    return (
      <>
        <div className="page-heading">
          <h1>Lecturer verification required</h1>
          <p className="muted">
            Your lecturer account must be verified before managing official
            courses or assessments.
          </p>
        </div>
        <Link className="button secondary" to="/verification">
          View verification status
        </Link>
      </>
    );
  return <Outlet context={user} />;
}
export function LecturerAcademic() {
  const user = useWorkspaceUser();
  return user.role === 'LECTURER' ? (
    <Outlet context={user} />
  ) : (
    <Navigate to="/courses" replace />
  );
}
