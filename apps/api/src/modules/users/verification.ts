import { z } from 'zod';
import type { Database } from '../../infrastructure/database.js';
import { HttpError } from '../../middleware/errors.js';
import { emailSchema } from '../auth/validation.js';

export const verificationSchema = z.object({
  email: emailSchema,
  actor: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(10).max(500),
  decision: z.enum(['approve', 'reject'])
}).strict();

export async function verifyLecturer(db: Database, input: z.infer<typeof verificationSchema>) {
  const data = verificationSchema.parse(input);
  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { email: data.email } });
    if (!user || user.role !== 'LECTURER' || user.status !== 'ACTIVE') {
      throw new HttpError(400, 'INVALID_LECTURER', 'An active lecturer account is required.');
    }
    const status = data.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await tx.lecturerVerification.update({ where: { userId: user.id }, data: {
      status, reviewedBy: data.actor, reason: data.reason, reviewedAt: new Date()
    } });
    await tx.auditEvent.create({ data: { actor: data.actor, action: `LECTURER_${status}`, resourceId: user.id, reason: data.reason } });
    return { userId: user.id, status };
  });
}
