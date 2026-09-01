import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library registers its own cleanup only when the test globals are
 * injected, and these suites import `describe`/`it`/`expect` explicitly
 * instead. Without an explicit cleanup every render stays in the document, so
 * a later query matches markup left behind by an earlier test -- surfacing as
 * "found multiple elements" on an assertion that is perfectly correct.
 *
 * The existing tests pass without this only because no two of them render the
 * same text. That is a property of the current suite, not a guarantee.
 */
afterEach(cleanup);
