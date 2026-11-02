export interface QuizSummary {
  id: string;
  title: string;
  description: string;
  mode: 'PRACTICE';
  status: 'DRAFT' | 'PUBLISHED';
  revision: number;
  questionCount: number;
  timeLimitSeconds: number | null;
  createdAt: string;
  publishedAt: string | null;
}
export interface DraftQuestion {
  prompt: string;
  options: [string, string, string, string];
  correctOption: number;
  explanation: string;
}
export interface DraftQuiz extends QuizSummary {
  questions: DraftQuestion[];
}
export interface TakingQuestion {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
}
export interface SavedAnswer {
  questionId: string;
  selectedOptionId: string | null;
  revision: number;
}
export interface QuizAttempt {
  id: string;
  quizId: string;
  title: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  attemptNumber: number;
  startedAt: string;
  expiresAt: string | null;
  serverNow: string;
  questions: TakingQuestion[];
  answers: SavedAnswer[];
}
export interface QuizResult {
  id: string;
  quizId: string;
  title: string;
  status: 'SUBMITTED' | 'EXPIRED';
  attemptNumber: number;
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  percentage: number;
  durationSeconds: number;
  finalizedAt: string;
  questions: (TakingQuestion & {
    explanation: string;
    selectedOptionId: string | null;
    correctOptionId: string;
  })[];
}
export interface HistoryEntry {
  id: string;
  quizId: string;
  title: string;
  status: string;
  attemptNumber: number;
  score: number;
  totalQuestions: number;
  durationSeconds: number;
  finalizedAt: string;
}
export interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  quizzes?: T[];
  attempts?: T[];
}
