/**
 * Test environment variables.
 * Loaded via jest.config.ts `setupFiles` before every test suite.
 * Real service values are not needed — external dependencies are mocked in tests.
 */

process.env.NODE_ENV = 'test';
process.env.PORT = '8892';
process.env.HOST = '0.0.0.0';

// Keycloak — mocked in all tests; real values unused
process.env.KEYCLOAK_URL = 'http://localhost:8080';
process.env.KEYCLOAK_REALM = 'auctions';
process.env.KEYCLOAK_CLIENT_ID = 'auction-backend';
process.env.KEYCLOAK_FRONTEND_CLIENT_ID = 'auction-frontend';
process.env.KEYCLOAK_ADMIN_CLIENT_ID = 'auction-admin';
process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = 'test-admin-secret';

// Sealed bid encryption — 64-char hex (32 zero bytes, safe for tests)
process.env.SEALED_BID_ENCRYPTION_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';

// PayGate — now per-seller; global env vars kept for backward compatibility only
process.env.PAYGATE_ID = 'test-paygate-id';
process.env.PAYGATE_ENCRYPTION_KEY = 'test-paygate-key';

// Misc
process.env.EXPRESS_SESSION_SECRET = 'test-session-secret';
process.env.STATE_JWT_SECRET = 'test-state-jwt-secret';
process.env.BAITS_API_TOKEN = 'test-baits-token';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.MONGO_DB_USER = 'test';
process.env.MONGO_DB_PASS = 'test';
process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
process.env.ELASTICSEARCH_USERNAME = 'test';
process.env.ELASTICSEARCH_PASSWORD = 'test';
