// Jest setup/teardown for integration tests.
// Mocks the DB pool so tests run without a real Neon connection.
const { Pool } = require('pg');

jest.mock('../db/index', () => {
  // The module is a jest.fn so test files can call mockClear/mockImplementationOnce
  // on it directly. It ALSO carries a `.query` pointing back to itself, plus
  // `.connect()`, so app code that does `pool.query(...)` / `pool.connect()` works.
  const mockQuery = jest.fn();
  const mockClient = { query: mockQuery, release: jest.fn() };
  mockQuery.query = mockQuery;
  mockQuery.connect = jest.fn(() => Promise.resolve(mockClient));
  mockQuery.on = jest.fn();
  mockQuery.end = jest.fn();
  return mockQuery;
});

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'REDACTED/swell_test';
process.env.SESSION_SECRET = 'test-secret-for-testing-only';
process.env.STRIPE_SECRET_KEY = 'test-api-key';
process.env.APP_URL = 'http://localhost:3000';

// Track mock call history for assertions
global.__mockDB = {
  queries: [],
  reset() { this.queries = []; }
};

const pool = require('../db/index');

// Default query behaviour: record the call and resolve to an empty result set.
// Tests override per-call with mockImplementationOnce / mockResolvedValueOnce.
function applyDefaultQueryImpl() {
  pool.query.mockImplementation((text, params) => {
    global.__mockDB.queries.push({ text, params });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}
applyDefaultQueryImpl();

// CRITICAL: reset before every test. mockClear() (used in some test files) does
// NOT drain the mockImplementationOnce queue, so an under-consumed *Once mock
// from one test leaks into the next and shifts every subsequent response
// (e.g. a 404 test receiving a leaked board row → 410). mockReset() drains the
// queue and wipes the implementation, so we reapply the default afterwards.
beforeEach(() => {
  pool.query.mockReset();
  applyDefaultQueryImpl();
  global.__mockDB.reset();
});

afterAll(async () => {
  // Allow open handles to close
  await new Promise(r => setTimeout(r, 200));
});