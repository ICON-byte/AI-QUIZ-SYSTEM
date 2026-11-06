import { parseArgs } from 'node:util';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../infrastructure/database.js';

async function main() {
  const { values } = parseArgs({
    options: { help: { type: 'boolean', short: 'h' } },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log('npm run lecturer:pending — list active lecturers awaiting verification, one email per line.');
    return;
  }

  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL);
  try {
    const lecturers = await db.user.findMany({
      where: {
        role: 'LECTURER',
        status: 'ACTIVE',
        verification: { is: { status: 'PENDING' } },
      },
      select: { email: true },
      orderBy: { email: 'asc' },
    });
    if (!lecturers.length) {
      console.log('No active lecturers are awaiting verification.');
      return;
    }
    for (const lecturer of lecturers) console.log(lecturer.email);
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  // Never print raw database errors or connection details.
  console.error('Unable to list pending lecturers. Check configuration and database access. Use --help for usage.');
  process.exitCode = 1;
});
