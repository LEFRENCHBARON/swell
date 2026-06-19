// Integration tests for /api/auth routes.
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

// Mock the db queries
const mockQuery = require('../db/index');

// Build minimal app with just auth router + session middleware
function buildApp() {
  const app = express();
  app.use(express.json());

  // Minimal session middleware for tests. Mirrors the express-session API the
  // auth routes rely on: regenerate/destroy/save invoke their callback (session
  // fixation protection calls req.session.regenerate() on login/register).
  app.use((req, _res, next) => {
    const sess = { userId: null, csrfToken: crypto.randomBytes(32).toString('hex') };
    sess.regenerate = (cb) => cb && cb();
    sess.destroy = (cb) => cb && cb();
    sess.save = (cb) => cb && cb();
    req.session = sess;
    next();
  });

  // Mock cookies
  app.use((req, res, next) => {
    req.cookies = {};
    next();
  });

  app.use('/api/auth', require('../routes/auth'));
  return app;
}

beforeEach(() => {
  mockQuery.mockClear();
  global.__mockDB.reset();
});

describe('POST /api/auth/register', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ name: 'Test', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email.*required/i);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name.*required/i);
  });

  it('returns 400 when password is too short', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'test@example.com', name: 'Test', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/i);
  });

  it('returns 409 when email already exists (unique constraint violation)', async () => {
    // Simulate unique violation from DB
    const err = new Error('unique violation');
    err.code = '23505';
    mockQuery.mockImplementationOnce(() => Promise.reject(err));

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'existing@example.com', name: 'Test', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('creates user and returns it on success', async () => {
    const mockUser = { id: 42, email: 'new@example.com', name: 'New User', is_host: false };
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockUser], rowCount: 1 })
    );
    // Mock referral code assignment (non-fatal, ignore)
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));
    // Mock setReferredBy (non-fatal, ignore)
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'new@example.com', name: 'New User', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(42);
  });
});

describe('POST /api/auth/login', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email.*required/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password.*required/i);
  });

  it('returns 401 when credentials are invalid', async () => {
    // No user found for this email → verifyPassword returns null
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [], rowCount: 0 })
    );

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'notfound@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns user object on successful login', async () => {
    const mockUser = { id: 1, email: 'test@example.com', name: 'Test User', is_host: false };
    // First call: getUserByEmail in verifyPassword
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ id: 1, email: 'test@example.com', password_hash: '$2a$12$invalidhashfortest', is_host: false }], rowCount: 1 })
    );
    // bcrypt.compare returns false for invalid hash → 401 (mocked behavior)
    // But we want to test the success path — use bcrypt hash
    const bcrypt = require('bcryptjs');
    const validHash = await bcrypt.hash('correctpassword', 12);
    mockQuery.mockReset();
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ id: 1, email: 'test@example.com', password_hash: validHash, is_host: false }], rowCount: 1 })
    );

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'correctpassword' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('returns {ok: true} and clears session', async () => {
    const res = await request(buildApp())
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('returns {user: null} when no session', async () => {
    const app = buildApp();
    // No userId in session
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});