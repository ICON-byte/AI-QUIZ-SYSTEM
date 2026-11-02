import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function createDatabase(url: string) {
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });
}

export type Database = ReturnType<typeof createDatabase>;
