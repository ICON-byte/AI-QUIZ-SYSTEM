import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import dotenv from 'dotenv';

// Run against a unique schema. No existing database objects are reset or deleted.
const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: join(root, 'apps/api/.env.test'), quiet: true });
const suffix = randomBytes(8).toString('hex');
const schema = `auth_test_${suffix}`;
const localRoot = resolve(root, '.local');
const cluster = resolve(localRoot, `postgres-${suffix}`);
let started = false;
let url;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error('Test command failed.')));
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  const port = server.address().port;
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

const executable = name => process.env.PG_BIN ? join(process.env.PG_BIN, name + (process.platform === 'win32' ? '.exe' : '')) : name;

try {
  if (process.env.TEST_DATABASE_URL) {
    url = new URL(process.env.TEST_DATABASE_URL);
    if (!/^postgres(ql)?:$/.test(url.protocol) || !/^[a-zA-Z0-9_]+_test$/.test(url.pathname.slice(1))) {
      throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test.');
    }
  } else {
    await mkdir(localRoot, { recursive: true });
    const port = await freePort();
    await run(executable('initdb'), ['-D', cluster, '--username=quiz_test', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--no-locale']);
    await run(executable('pg_ctl'), ['-D', cluster, '-l', join(cluster, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    started = true;
    url = new URL(`postgresql://quiz_test@127.0.0.1:${port}/postgres`);
  }
  url.searchParams.set('schema', schema);
  const env = {
    ...process.env, NODE_ENV: 'test', DATABASE_URL: url.toString(), TEST_SCHEMA: schema,
    JWT_SECRET: randomBytes(48).toString('hex'), BCRYPT_ROUNDS: '10', APP_ORIGIN: 'http://localhost:5173'
  };
  const prisma = join(root, 'node_modules/prisma/build/index.js');
  await run(process.execPath, [prisma, 'generate'], { cwd: join(root, 'apps/api'), env });
  await run(process.execPath, [prisma, 'migrate', 'deploy'], { cwd: join(root, 'apps/api'), env });
  await run(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/auth.integration.test.ts', 'test/practice.integration.test.ts', 'test/academic.integration.test.ts', 'test/banks.integration.test.ts', 'test/ai.integration.test.ts', 'test/challenges.integration.test.ts'], { cwd: join(root, 'apps/api'), env });
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('TEST_DATABASE_URL') ? error.message : 'PostgreSQL integration tests failed. Ensure initdb/pg_ctl are on PATH, set PG_BIN, or configure apps/api/.env.test.');
  process.exitCode = 1;
} finally {
  if (url && process.env.TEST_DATABASE_URL) {
    const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      // The identifier is generated above, never taken from external input.
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch {
      console.error(`Could not remove isolated test schema ${schema}.`);
      process.exitCode = 1;
    } finally { await client.end(); }
  }
  if (started) {
    try {
      await run(executable('pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop']);
      // Recursive removal is restricted to this run's verified workspace directory.
      if (cluster.startsWith(localRoot + sep) && cluster === resolve(localRoot, `postgres-${suffix}`)) {
        await rm(cluster, { recursive: true, force: true });
      }
    } catch {
      console.error('Temporary PostgreSQL shutdown/cleanup failed; inspect .local before removing anything.');
      process.exitCode = 1;
    }
  }
}
