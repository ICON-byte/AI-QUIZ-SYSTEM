import type { DraftQuestion } from '../practice/types';

export interface Bank {
  id: string;
  title: string;
  description: string;
  courseId: string | null;
  revision: number;
  archivedAt: string | null;
  questionCount: number;
}
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export interface BankQuestion extends DraftQuestion {
  id: string;
  bankId: string;
  difficulty: Difficulty;
  topic: string;
  revision: number;
  archivedAt: string | null;
}
export interface CsvPreview {
  token: string;
  expiresAt: string;
  validCount: number;
  invalidCount: number;
  rows: {
    row: number;
    prompt: string;
    errors: string[];
    question:
      | (DraftQuestion & { difficulty: Difficulty; topic: string })
      | null;
  }[];
}
