import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// Vite transforms the large workspace chunk on its first dynamic import. Do that
// before assertion timers start; the production route still loads through Suspense.
beforeAll(async () => {
  await import('../app/WorkspaceRoutes');
});
