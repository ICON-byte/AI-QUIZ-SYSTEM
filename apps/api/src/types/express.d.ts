import type { User, LecturerVerification } from '../generated/prisma/client.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { user: User & { verification: LecturerVerification | null }; sessionId: string };
    }
  }
}

export {};
