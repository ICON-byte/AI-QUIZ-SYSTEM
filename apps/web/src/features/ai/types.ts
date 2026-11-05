import type { BankQuestion } from '../banks/types';
export interface Segment {
  label: string;
  text: string;
}
export interface AiQuestion
  extends Omit<BankQuestion, 'id' | 'bankId' | 'revision' | 'archivedAt'> {
  source: { label: string; quote: string } | null;
}
export interface AiJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED' | 'DELETED';
  createdAt?: string;
  phase?: 'QUEUED' | 'PACING' | 'CALLING' | 'RECOVERING';
  providerAttempts?: number;
  summary?: {
    kind: 'TOPIC' | 'DOCUMENT';
    topic: string;
    difficulty: string;
    count: number;
  } | null;
  diagnostics?:
    | {
        attempt: number;
        category: string;
        fields?: string[];
        finishReason?: string;
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        requestedCount?: number;
        returnedCount?: number;
        sourceCount?: number;
        sourceCharacters?: number;
      }[]
    | null;
  deadlineAt: string;
  expiresAt: string | null;
  result: { questions: AiQuestion[] } | null;
  acceptance: { bankId: string; savedCount: number } | null;
  failure: { code: string; message: string } | null;
}
export interface AiCapabilities {
  available: boolean;
  ageConfirmed: boolean;
  remaining: number;
  used: number;
  reserved: number;
  dailyLimit: number;
  resetsAt: string;
  currentJobId: string | null;
  recentJobId?: string | null;
  limits: { fileBytes: number; characters: number; pages: number };
}
