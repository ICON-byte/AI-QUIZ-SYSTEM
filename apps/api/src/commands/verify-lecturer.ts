import { parseArgs } from 'node:util';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../infrastructure/database.js';
import { verificationSchema, verifyLecturer } from '../modules/users/verification.js';

async function main() {
  const { values } = parseArgs({ options: {
    email: { type: 'string' }, actor: { type: 'string' }, reason: { type: 'string' }, decision: { type: 'string' }
  }, strict: true, allowPositionals: false });
  const input = verificationSchema.safeParse(values);
  if (!input.success) throw new Error('Use --email <lecturer-email> --actor <operator-id> --decision approve|reject --reason <10-500 characters>');
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL);
  try {
    const result = await verifyLecturer(db, input.data);
    console.log(`Lecturer ${result.userId}: ${result.status}. Decision audited.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Database error objects may contain connection details; never print them.
  const known = error instanceof Error && (error.message.startsWith('Use --email') || error.message.startsWith('Invalid environment') || error.message === 'An active lecturer account is required.');
  console.error(known ? error.message : 'Verification failed. Check configuration and database access.');
  process.exitCode = 1;
});
