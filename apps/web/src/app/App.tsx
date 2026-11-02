import { Navigate, Route, Routes } from 'react-router';
import { AuthPage } from '../features/auth/AuthPage';
import { Account } from '../features/account/Account';
import { Verification } from '../features/account/Verification';
import { Dashboard } from '../features/dashboard/Dashboard';
import { NotFound, Workspace } from './Workspace';

export function App() {
  return <Routes>
    <Route path="/login" element={<AuthPage />} />
    <Route path="/register" element={<AuthPage register />} />
    <Route element={<Workspace />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/account" element={<Account />} />
      <Route path="/verification" element={<Verification />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
