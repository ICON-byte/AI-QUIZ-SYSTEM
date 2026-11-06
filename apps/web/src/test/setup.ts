import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// The page loader intentionally displays one 1.3-second animation cycle.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => cleanup());

// Vite transforms the large workspace chunk on its first dynamic import. Do that
// before assertion timers start; the production route still loads through Suspense.
beforeAll(async () => {
  await import('../app/WorkspaceRoutes');
});
