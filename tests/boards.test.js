// Integration tests for /api/boards routes.
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const mockQuery = require('../db/index');

// Build app with boards router + mock session.
function buildBoardsApp({ userId = 1, isHost = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 }
  }));
  app.use((req, _res, next) => {
    req.session.userId = userId;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    next();
  });
  app.use('/api/boards', require('../routes/boards'));
  return app;
}

beforeEach(() => {
  mockQuery.mockClear();
  global.__mockDB.reset();
});

// ─── GET /api/boards ─────────────────────────────────────────────────────────

describe('GET /api/boards', () => {
  it('returns boards list with sanitized photos', async () => {
    const mockBoards = [
      { id: 1, title: 'Shortboard', photos: ['/img.jpg', 'https://unsplash.com/photo.jpg'], daily_price_cents: 4000 },
      { id: 2, title: 'Funboard', photos: ['https://picsum.photos/1'], daily_price_cents: 3500 }
    ];
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: mockBoards, rowCount: 2 })
    );

    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards');

    expect(res.status).toBe(200);
    expect(res.body.boards).toHaveLength(2);
    // Unsplash URLs should be stripped
    expect(res.body.boards[0].photos).not.toContain('https://unsplash.com/photo.jpg');
    expect(res.body.boards[0].photos[0]).toBe('/img.jpg');
    // picsum should be stripped
    expect(res.body.boards[1].photos).not.toContain('https://picsum.photos/1');
  });

  it('supports spot_id filter', async () => {
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));
    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards?spotId=3&region=hossegor');

    expect(res.status).toBe(200);
    expect(res.body.boards).toBeDefined();
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockImplementationOnce(() => Promise.reject(new Error('DB error')));
    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards');
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/boards/:id ──────────────────────────────────────────────────────

describe('GET /api/boards/:id', () => {
  it('returns board + reviews', async () => {
    const mockBoard = { id: 5, title: 'Fish', host_id: 2, photos: [], daily_price_cents: 4000, is_listed: true };
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [mockBoard], rowCount: 1 })
    );
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [
        { id: 1, rating: 5, comment: 'Great board!', published_at: new Date() }
      ], rowCount: 1 })
    );

    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards/5');

    expect(res.status).toBe(200);
    expect(res.body.board).toBeDefined();
    expect(res.body.board.id).toBe(5);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].rating).toBe(5);
  });

  it('returns 404 when board not found', async () => {
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));

    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards/9999');
    expect(res.status).toBe(404);
  });

  it('returns 410 (Gone) when board is delisted and user is not the owner', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ id: 7, host_id: 99, is_listed: false }], rowCount: 1 })
    );

    const app = buildBoardsApp({ userId: 1 }); // not owner
    const res = await request(app).get('/api/boards/7');
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/plus disponible/i);
  });

  it('returns board to owner even if delisted', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ id: 7, host_id: 1, is_listed: false }], rowCount: 1 })
    );
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));

    const app = buildBoardsApp({ userId: 1 });
    const res = await request(app).get('/api/boards/7');
    expect(res.status).toBe(200);
  });

  it('sets no-cache headers on board detail', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ id: 1, host_id: 2, photos: [], is_listed: true }], rowCount: 1 })
    );
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));

    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards/1');

    expect(res.headers['cache-control']).toMatch(/no-cache|no-store/i);
  });
});

// ─── Auth guard: requireAuth on POST /api/boards ─────────────────────────────

describe('POST /api/auth required on /api/boards', () => {
  it('POST /api/boards → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/boards', require('../routes/boards'));

    // No userId injected
    const res = await request(app).post('/api/boards');
    expect(res.status).toBe(401);
  });

  it('PUT /api/boards/:id → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/boards', require('../routes/boards'));

    const res = await request(app).put('/api/boards/1');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/boards/:id → 401 without session', async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/boards', require('../routes/boards'));

    const res = await request(app).delete('/api/boards/1');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/boards/my ───────────────────────────────────────────────────────

describe('GET /api/boards/my', () => {
  it('returns boards for authenticated user', async () => {
    const mockBoards = [
      { id: 1, title: 'My Board', photos: [], daily_price_cents: 5000 }
    ];
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: mockBoards, rowCount: 1 })
    );

    const app = buildBoardsApp({ userId: 42 });
    const res = await request(app).get('/api/boards/my');

    expect(res.status).toBe(200);
    expect(res.body.boards).toHaveLength(1);
  });
});

// ─── GET /api/boards/instant ─────────────────────────────────────────────────

describe('GET /api/boards/instant', () => {
  it('returns boards available in next 24h', async () => {
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [], rowCount: 0 })
    );

    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards/instant?limit=6');

    expect(res.status).toBe(200);
    expect(res.body.boards).toBeDefined();
  });

  it('respects limit param', async () => {
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [], rowCount: 0 }));
    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards/instant?limit=3');
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/boards/:id/delist ─────────────────────────────────────────────

describe('POST /api/boards/:id/delist', () => {
  it('returns 409 with activeBookings when host has future bookings', async () => {
    // The delist route calls getFutureBookingsCount directly (no getBoardById
    // pre-fetch) → 2 active bookings blocks the delist with a 409.
    mockQuery.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ count: '2' }], rowCount: 1 })
    );

    const app = buildBoardsApp({ userId: 5 });
    const res = await request(app)
      .post('/api/boards/1/delist')
      .set('x-csrf-token', 'test-token')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.activeBookings).toBe(2);
  });
});

// ─── Photo sanitization ───────────────────────────────────────────────────────

describe('Photo sanitization', () => {
  it('strips hotlinked Unsplash and keeps R2 URLs', async () => {
    const boards = [{
      id: 1, title: 'Test', host_id: 1, is_listed: true,
      photos: [
        'https://images.unsplash.com/photo-abc',
        'https://pub-123.r2.dev/boards/photo.jpg',
        'https://polsia.com/r2/avatar.jpg'
      ],
      daily_price_cents: 4000
    }];
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: boards, rowCount: 1 }));

    const app = buildBoardsApp();
    const res = await request(app).get('/api/boards/1');

    expect(res.status).toBe(200);
    const photos = res.body.board.photos;
    expect(photos).not.toContain('https://images.unsplash.com/photo-abc');
    expect(photos).toContain('https://pub-123.r2.dev/boards/photo.jpg');
    expect(photos).toContain('https://polsia.com/r2/avatar.jpg');
  });
});