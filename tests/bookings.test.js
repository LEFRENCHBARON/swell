// Integration tests for /api/bookings routes.
// Uses supertest to exercise the full Express middleware stack (session, CSRF, rate-limit).
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const mockQuery = require('../db/index');

// Helper: build a test app with bookings router, in-memory session, and CSRF.
// Returns { app, sessionCookie, csrfToken, mockUserId }.
function buildBookingsApp({ userId = 1, stripeChargesEnabled = true } = {}) {
  const app = express();
  app.use(express.json());

  // In-memory session store (no DB needed for session itself)
  app.use(session({
    store: new (connectPgSimple(express.session))({
      createTableIfMissing: false,
      get: async (_sid, callback) => callback(null, {}),
      set: async (_sid, session, callback) => callback(null),
    }),
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'swell_sid',
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
  }));

  // Inject session for tests
  app.use((req, _res, next) => {
    req.session.userId = userId;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    next();
  });

  // Mock cookies
  app.use((req, _res, next) => {
    req.cookies = req.cookies || {};
    next();
  });

  // CSRF protection for /api/*
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const token = req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ error: 'CSRF token invalide ou manquant.' });
    }
    next();
  });

  app.use('/api/bookings', require('../routes/bookings'));
  return app;
}

// Return a supertest agent pre-populated with a valid CSRF token.
function agentWithAuth(app, userId = 1) {
  const agent = request.agent(app);
  // Set session cookie + inject userId + CSRF token via session
  return agent;
}

beforeEach(() => {
  mockQuery.mockClear();
  global.__mockDB.reset();
});

// ─── Availability ────────────────────────────────────────────────────────────

describe('GET /api/bookings/availability/:boardId', () => {
  it('returns booked dates for a board', async () => {
    const mockDates = [
      { start_date: '2026-06-01', end_date: '2026-06-02' },
      { start_date: '2026-06-05', end_date: '2026-06-06' }
    ];
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: mockDates, rowCount: 2 })
    );

    const app = buildBookingsApp();
    const res = await request(app)
      .get('/api/bookings/availability/1');

    expect(res.status).toBe(200);
    expect(res.body.bookedDates).toHaveLength(2);
    expect(res.body.bookedDates[0].start_date).toBe('2026-06-01');
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockImplementationOnce(() => Promise.reject(new Error('DB down')));
    const app = buildBookingsApp();
    const res = await request(app).get('/api/bookings/availability/1');
    expect(res.status).toBe(500);
  });
});

// ─── Booking check (availability + price calc) ──────────────────────────────

describe('POST /api/bookings/check', () => {
  function mockBoard(id = 1, overrides = {}) {
    return {
      id, host_id: 99,
      title: 'Test Board',
      daily_price_cents: 4000,
      hourly_rate_cents: 600,
      damage_waiver_enabled: true,
      estimated_value_cents: 20000
    };
  }

  it('returns 400 when boardId is missing', async () => {
    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boardId/);
  });

  it('returns 404 when board does not exist', async () => {
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));
    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ boardId: 999, startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(404);
  });

  it('calculates daily rental price correctly', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBoard(1)], rowCount: 1 })
    );
    // checkAvailability → isRangeAvailable
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [], rowCount: 0 }) // isRangeAvailable
    );

    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-03' });
    // 2 days × 40€ = 80€ rental
    expect(res.status).toBe(200);
    expect(res.body.rentalCents).toBe(8000);
    expect(res.body.isHourly).toBe(false);
    expect(res.body.days).toBe(2);
  });

  it('calculates hourly rental price correctly', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBoard(1)], rowCount: 1 })
    );
    // isSlotAvailable → true
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ available: true }], rowCount: 1 })
    );

    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-01', startTime: '09:00', endTime: '14:00' });
    // 5h × 6€/h = 30€
    expect(res.status).toBe(200);
    expect(res.body.isHourly).toBe(true);
    expect(res.body.hours).toBe(5);
    expect(res.body.rentalCents).toBe(3000);
  });

  it('rejects hourly < 2h', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBoard(1)], rowCount: 1 })
    );

    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-01', startTime: '09:00', endTime: '10:00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2h.*16h|2.*16|dur[ée]/i);
  });

  it('rejects hourly > 16h', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBoard(1)], rowCount: 1 })
    );

    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-01', startTime: '06:00', endTime: '23:00' });

    expect(res.status).toBe(400);
  });

  it('returns 409 when hourly slot is unavailable', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBoard(1)], rowCount: 1 })
    );
    // isSlotAvailable → false
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ available: false }], rowCount: 1 })
    );

    const app = buildBookingsApp();
    const res = await request(app)
      .post('/api/bookings/check')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-01', startTime: '09:00', endTime: '14:00' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/disponible|conflict/i);
  });
});

// ─── Auth protection ─────────────────────────────────────────────────────────

describe('Auth guards on bookings endpoints', () => {
  it('GET /api/bookings/my → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 86400000 }
    }));
    // No userId injected
    app.use('/api/bookings', require('../routes/bookings'));

    const res = await request(app).get('/api/bookings/my');
    expect(res.status).toBe(401);
  });

  it('GET /api/bookings/host → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/bookings', require('../routes/bookings'));

    const res = await request(app).get('/api/bookings/host');
    expect(res.status).toBe(401);
  });

  it('GET /api/bookings/:id → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/bookings', require('../routes/bookings'));

    const res = await request(app).get('/api/bookings/1');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/bookings/:id/status → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/bookings', require('../routes/bookings'));

    const res = await request(app).patch('/api/bookings/1/status').send({ status: 'confirmed' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/bookings/:id/status → 403 without valid CSRF token', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test', resave: false, saveUninitialized: false,
      cookie: { maxAge: 86400000 }
    }));
    app.use((req, _res, next) => {
      req.session.userId = 1;
      req.session.csrfToken = 'valid-token';
      next();
    });
    app.use('/api', (req, res, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const token = req.headers['x-csrf-token'];
      if (!token || token !== req.session.csrfToken) {
        return res.status(403).json({ error: 'CSRF token invalide ou manquant.' });
      }
      next();
    });
    app.use('/api/bookings', require('../routes/bookings'));

    const res = await request(app)
      .patch('/api/bookings/1/status')
      .set('x-csrf-token', 'wrong-token')
      .send({ status: 'confirmed' });

    expect(res.status).toBe(403);
  });
});

// ─── Create booking POST /api/bookings ──────────────────────────────────────

describe('POST /api/bookings', () => {
  function mockHostBoard(hostId = 99, stripeEnabled = true) {
    return {
      id: 1, host_id: hostId,
      title: 'Pro Board',
      daily_price_cents: 5000,
      hourly_rate_cents: 700,
      damage_waiver_enabled: true,
      estimated_value_cents: 25000,
      stripe_charges_enabled: stripeEnabled
    };
  }

  it('returns 400 when required fields missing', async () => {
    const app = buildBookingsApp({ userId: 5 });
    const res = await request(app)
      .post('/api/bookings')
      .set('x-csrf-token', app.locals?.csrfToken || 'test')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when booking own board', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockHostBoard(1)], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 1 }); // userId matches host_id
    const res = await request(app)
      .post('/api/bookings')
      .set('x-csrf-token', 'test-token')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own board/i);
  });

  it('returns 402 when host has no Stripe configured', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockHostBoard(99, false)], rowCount: 1 })
    );
    // getBoardHostPaymentStatus
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ stripe_charges_enabled: false }], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 5 });
    const res = await request(app)
      .post('/api/bookings')
      .set('x-csrf-token', 'test-token')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/Stripe|paiements/i);
  });

  it('returns 409 when daily slot is already booked', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockHostBoard(99, true)], rowCount: 1 })
    );
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ stripe_charges_enabled: true }], rowCount: 1 })
    );
    // checkAvailability → conflict
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 })); // getBoardById
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [mockHostBoard(99, true)], rowCount: 1 })); // getBoardHostPaymentStatus
    mockQuery.mockImplementationOnce(() => Promise.resolve(false)); // checkAvailability returns false

    const app = buildBookingsApp({ userId: 5 });
    const res = await request(app)
      .post('/api/bookings')
      .set('x-csrf-token', 'test-token')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(409);
  });

  it('creates a pending booking on success', async () => {
    const mockBooking = {
      id: 77, board_id: 1, renter_id: 5,
      start_date: '2026-06-01', end_date: '2026-02',
      status: 'pending', total_cents: 5000
    };

    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockHostBoard(99, true)], rowCount: 1 })
    );
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ stripe_charges_enabled: true }], rowCount: 1 })
    );
    // getBoardById (used inside requireAuth block)
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockHostBoard(99, true)], rowCount: 1 })
    );
    // getBoardHostPaymentStatus
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ stripe_charges_enabled: true }], rowCount: 1 })
    );
    // checkAvailability (daily) → available
    mockQuery.mockImplementationOnce(() => Promise.resolve(true));
    // createBooking
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBooking], rowCount: 1 })
    );
    // updateBookingPayment (when no checkout URL)
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBooking], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 5 });
    const res = await request(app)
      .post('/api/bookings')
      .set('x-csrf-token', 'test-token')
      .send({ boardId: 1, startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(200);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.id).toBe(77);
  });
});

// ─── Payment verify ─────────────────────────────────────────────────────────

describe('POST /api/bookings/payment-verify', () => {
  it('returns 400 when sessionId is missing', async () => {
    const app = buildBookingsApp({ userId: 1 });
    const res = await request(app)
      .post('/api/bookings/payment-verify')
      .set('x-csrf-token', 'test-token')
      .send({ bookingId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId/);
  });

  it('returns 400 when bookingId is missing', async () => {
    const app = buildBookingsApp({ userId: 1 });
    const res = await request(app)
      .post('/api/bookings/payment-verify')
      .set('x-csrf-token', 'test-token')
      .send({ sessionId: 'cs_test_abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bookingId/);
  });

  it('returns 404 when booking not found', async () => {
    // Mock verifyRes (Polsia payments API)
    const verifyRes = { ok: true, json: () => Promise.resolve({ verified: true, payment: {} }) };
    const origFetch = global.fetch;
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ verified: true }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    // getBookingById → not found
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));

    const app = buildBookingsApp({ userId: 1 });
    const res = await request(app)
      .post('/api/bookings/payment-verify')
      .set('x-csrf-token', 'test-token')
      .send({ sessionId: 'cs_test_abc', bookingId: 999 });

    expect(res.status).toBe(404);
    global.fetch = origFetch;
  });

  it('returns 403 when sessionId does not match booking', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ verified: true }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const mockBooking = {
      id: 5, renter_id: 1, board_id: 1,
      stripe_session_id: 'cs_real_session',
      payment_status: 'pending', status: 'pending'
    };
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBooking], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 1 });
    const res = await request(app)
      .post('/api/bookings/payment-verify')
      .set('x-csrf-token', 'test-token')
      .send({ sessionId: 'cs_wrong_session', bookingId: 5 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session.*match/i);
    global.fetch = undefined;
  });
});

// ─── Booking status update ────────────────────────────────────────────────────

describe('PATCH /api/bookings/:id/status', () => {
  it('returns 400 for invalid status value', async () => {
    const app = buildBookingsApp({ userId: 1 });
    const res = await request(app)
      .patch('/api/bookings/1/status')
      .set('x-csrf-token', 'test-token')
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmed.*cancelled|status/i);
  });

  it('returns 404 when booking not found or not authorized', async () => {
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));

    const app = buildBookingsApp({ userId: 99 }); // not host or renter
    const res = await request(app)
      .patch('/api/bookings/1/status')
      .set('x-csrf-token', 'test-token')
      .send({ status: 'confirmed' });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/bookings/:id ────────────────────────────────────────────────────

describe('GET /api/bookings/:id', () => {
  it('returns booking to renter', async () => {
    const mockBooking = {
      id: 1, renter_id: 5, host_id: 99,
      status: 'confirmed', total_cents: 4000
    };
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBooking], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 5 });
    const res = await request(app).get('/api/bookings/1');

    expect(res.status).toBe(200);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.status).toBe('confirmed');
  });

  it('returns booking to host', async () => {
    const mockBooking = {
      id: 1, renter_id: 5, host_id: 99,
      status: 'confirmed', total_cents: 4000
    };
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBooking], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 99 }); // host
    const res = await request(app).get('/api/bookings/1');

    expect(res.status).toBe(200);
  });

  it('returns 403 to third party', async () => {
    const mockBooking = {
      id: 1, renter_id: 5, host_id: 99,
      status: 'confirmed', total_cents: 4000
    };
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBooking], rowCount: 1 })
    );

    const app = buildBookingsApp({ userId: 88 }); // neither host nor renter
    const res = await request(app).get('/api/bookings/1');

    expect(res.status).toBe(403);
  });
});