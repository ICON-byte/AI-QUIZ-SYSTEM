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
import { AcademicArea, LecturerAcademic } from '../features/courses/AcademicArea';
import { CourseList } from '../features/courses/CourseList';
import { CourseEditor } from '../features/courses/CourseEditor';
import { CourseDetails } from '../features/courses/CourseDetails';
import { CourseRoster } from '../features/courses/CourseRoster';
import { JoinCourse } from '../features/courses/JoinCourse';
import { AssessmentReport } from '../features/courses/AssessmentReport';
import { BankList } from '../features/banks/BankList';
import { BankEditor } from '../features/banks/BankEditor';
import { BankDetails } from '../features/banks/BankDetails';
import { QuestionEditor } from '../features/banks/QuestionEditor';
import { CsvImport } from '../features/banks/CsvImport';

export function App() {
  return <Routes>
    <Route path="/login" element={<AuthPage />} />
    <Route path="/register" element={<AuthPage register />} />
    <Route element={<Workspace />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/account" element={<Account />} />
      <Route path="/verification" element={<Verification />} />
      <Route path="/banks" element={<BankList />} />
      <Route path="/banks/new" element={<BankEditor />} />
      <Route path="/banks/:bankId" element={<BankDetails />} />
      <Route path="/banks/:bankId/edit" element={<BankEditor />} />
      <Route path="/banks/:bankId/questions/new" element={<QuestionEditor />} />
      <Route path="/banks/:bankId/questions/:questionId/edit" element={<QuestionEditor />} />
      <Route path="/banks/:bankId/import" element={<CsvImport />} />
      <Route element={<AcademicArea />}>
        <Route path="/courses" element={<CourseList />} />
        <Route path="/courses/:courseId" element={<CourseDetails />} />
        <Route element={<LecturerAcademic />}>
          <Route path="/courses/new" element={<CourseEditor />} />
          <Route path="/courses/:courseId/edit" element={<CourseEditor />} />
          <Route path="/courses/:courseId/roster" element={<CourseRoster />} />
          <Route path="/courses/:courseId/assessments/new" element={<QuizEditor academic />} />
          <Route path="/courses/:courseId/assessments/:quizId/edit" element={<QuizEditor academic />} />
          <Route path="/courses/:courseId/assessments/:quizId/report" element={<AssessmentReport />} />
        </Route>
      </Route>
      <Route element={<StudentPractice />}>
        <Route path="/courses/join" element={<JoinCourse />} />
        <Route path="/assessments/:quizId" element={<QuizInstructions academic />} />
        <Route path="/attempts/:attemptId" element={<ActiveQuiz academic />} />
        <Route path="/attempts/:attemptId/result" element={<QuizResults academic />} />
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
