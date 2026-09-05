import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library registers its own cleanup only when the test globals are
 * injected, and these suites import `describe`/`it`/`expect` explicitly
 * instead. Without an explicit cleanup every render stays in the document, so
 * a later query matches markup left behind by an earlier test.
 *
 * Mirrors `auth-ui/tests/setup.ts`.
 */
afterEach(cleanup);
