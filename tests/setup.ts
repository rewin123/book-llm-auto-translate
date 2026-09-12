import { vi } from 'vitest';

/**
 * No test reaches the network.
 *
 * The model catalogue is fetched lazily from models.dev, so any test that priced
 * a model started a real request. happy-dom could not complete it, vitest
 * aborted it at teardown, and the resulting `DOMException [AbortError]` stacks
 * were printed on every run — noise that would hide a genuine failure.
 *
 * A test that needs a specific response stubs `fetch` itself; this default just
 * makes the attempt fail fast and locally, the way an offline browser would.
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () => {
    throw new TypeError('Failed to fetch: the network is disabled in tests');
  }),
);
