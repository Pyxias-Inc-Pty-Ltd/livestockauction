/**
 * Stub for src/index.ts used in integration tests.
 *
 * src/index.ts exports `io` (the Socket.io server) and `firebase`.
 * Several models/services import these to emit socket events.
 * In integration tests the real index.ts cannot be imported because:
 *   1. It calls pre-start which parses CLI args (fails under Jest --config)
 *   2. It immediately starts an HTTP server on a fixed port
 *
 * The stub exports a no-op socket server so imports succeed without
 * side effects.  Actual socket communication in integration tests goes
 * through the test server started in spec/helpers/test-server.ts.
 */

export const io = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
  in: () => ({ emit: () => {}, fetchSockets: async () => [] }),
};

export const firebase = {};
