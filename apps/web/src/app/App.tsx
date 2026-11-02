import { Navigate, Route, Routes } from 'react-router';
import { AuthPage } from '../features/auth/AuthPage';
import { Account } from '../features/account/Account';
import { Verification } from '../features/account/Verification';
import { Dashboard } from '../features/dashboard/Dashboard';
import { NotFound, Workspace } from './Workspace';
import { StudentPractice } from '../features/practice/PracticeUi';
import { PracticeList } from '../features/practice/PracticeList';
import { QuizEditor } from '../features/practice/QuizEditor';
import { QuizInstructions } from '../features/practice/QuizInstructions';
import { ActiveQuiz } from '../features/practice/ActiveQuiz';
import { QuizResults } from '../features/practice/QuizResults';
import { PracticeHistory } from '../features/practice/PracticeHistory';

export function App() {
  return <Routes>
    <Route path="/login" element={<AuthPage />} />
    <Route path="/register" element={<AuthPage register />} />
    <Route element={<Workspace />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/account" element={<Account />} />
      <Route path="/verification" element={<Verification />} />
      <Route element={<StudentPractice />}>
        <Route path="/practice" element={<PracticeList />} />
        <Route path="/practice/new" element={<QuizEditor />} />
        <Route path="/practice/history" element={<PracticeHistory />} />
        <Route path="/practice/:quizId/edit" element={<QuizEditor />} />
        <Route path="/practice/:quizId" element={<QuizInstructions />} />
        <Route path="/practice/attempts/:attemptId" element={<ActiveQuiz />} />
        <Route path="/practice/attempts/:attemptId/result" element={<QuizResults />} />
      </Route>
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
