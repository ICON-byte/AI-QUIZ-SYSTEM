import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AuthPage } from '../features/auth/AuthPage';
import { LandingPage } from '../features/landing/LandingPage';
import { Loading } from '../components/Feedback';
import { withMinimumPageLoading } from '../lib/pageLoading';

const WorkspaceRoutes = lazy(() => withMinimumPageLoading(import('./WorkspaceRoutes')));

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route
        path="/*"
        element={
          <Suspense fallback={<Loading />}>
            <WorkspaceRoutes />
          </Suspense>
        }
      />
    </Routes>
  );
}
