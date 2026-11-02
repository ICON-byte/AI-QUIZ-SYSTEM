import type { QuizSummary } from '../practice/types';
export interface CourseInfo {
  id: string;
  title: string;
  code: string;
  description: string;
  revision: number;
  archivedAt: string | null;
  enrollmentEnabled: boolean;
  enrollmentCode?: string;
}
export interface Roster {
  students: {
    id: string;
    displayName: string;
    email: string;
    status: 'ACTIVE' | 'LEFT' | 'REMOVED';
    joinedAt: string;
  }[];
  total: number;
  active: number;
}
export interface AssessmentReport {
  quiz: QuizSummary;
  totalEnrolled: number;
  studentsAttempted: number;
  finalizedAttempts: number;
  averagePercentage: number | null;
  highestPercentage: number | null;
  lowestPercentage: number | null;
  attempts: {
    id: string;
    student: { id: string; displayName: string; email: string };
    attemptNumber: number;
    status: string;
    score: number | null;
    totalQuestions: number;
    submittedAt: string | null;
  }[];
  questions: {
    id: string;
    prompt: string;
    correctCount: number;
    totalGraded: number;
  }[];
}
