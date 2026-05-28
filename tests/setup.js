// Jest setup/teardown for integration tests.
// Mocks the DB pool so tests run without a real Neon connection.
const { Pool } = require('pg');

jest.mock('../db/index', () => {
  const mockQuery = jest.fn();
  const mockPool = { query: mockQuery, on: jest.fn(), end: jest.fn() };
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

const mockQuery = require('../db/index');
mockQuery.mockImplementation((text, params) => {
  global.__mockDB.queries.push({ text, params });
  return Promise.resolve({ rows: [], rowCount: 0 });
});

afterAll(async () => {
  // Allow open handles to close
  await new Promise(r => setTimeout(r, 200));
});