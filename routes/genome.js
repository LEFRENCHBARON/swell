// What this module owns: HTTP endpoints for SWELL_GENOME (/api/genome).
// Does NOT own board CRUD, bookings, or event store writes.
const express = require('express');
const router = express.Router();
const {
  getGenomeByBoardId,
  getGenomeByGenomeId,
  upsertGenome,
  getGenomesByHost,
  ensureGenomeExists
} = require('../db/genome');
const { getBoardById } = require('../db/boards');

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// GET /api/genome/:boardId — public, used in host dashboard and board detail
router.get('/:boardId', async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId, 10);
    if (isNaN(boardId)) return res.status(400).json({ error: 'Invalid boardId' });

    let genome = await getGenomeByBoardId(boardId);
    if (!genome) {
      // Auto-bootstrap genome for boards that predate the system
      genome = await ensureGenomeExists(boardId);
      genome = await getGenomeByBoardId(boardId);
    }
    if (!genome) return res.status(404).json({ error: 'Board not found' });

    res.json({ genome });
  } catch (err) {
    console.error('GET /api/genome/:boardId error:', err);
    res.status(500).json({ error: 'Failed to fetch genome' });
  }
});

// GET /api/genome/id/:genomeId — lookup by QG-XXXXXX identifier
router.get('/id/:genomeId', async (req, res) => {
  try {
    const genome = await getGenomeByGenomeId(req.params.genomeId);
    if (!genome) return res.status(404).json({ error: 'Genome not found' });
    res.json({ genome });
  } catch (err) {
    console.error('GET /api/genome/id/:genomeId error:', err);
    res.status(500).json({ error: 'Failed to fetch genome' });
  }
});

// GET /api/genome/host/me — host's full genome portfolio (auth required)
router.get('/host/me', requireAuth, async (req, res) => {
  try {
    const genomes = await getGenomesByHost(req.session.userId);
    res.json({ genomes });
  } catch (err) {
    console.error('GET /api/genome/host/me error:', err);
    res.status(500).json({ error: 'Failed to fetch host genomes' });
  }
});

// PATCH /api/genome/:boardId — host updates genome metadata (construction, shaper, etc.)
// Ownership enforced: only the board's host may update its genome.
router.patch('/:boardId', requireAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId, 10);
    if (isNaN(boardId)) return res.status(400).json({ error: 'Invalid boardId' });

    // IDOR guard: confirm the requesting user owns this board.
    const board = await getBoardById(boardId);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    if (board.host_id !== req.session.userId) return res.status(403).json({ error: 'Not your board' });

    const allowed = ['shape', 'construction', 'shaper', 'brand_model', 'value_estimate',
                     'fragility_profile', 'preferred_wave_range'];
    const fields = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    }

    const genome = await upsertGenome(boardId, fields);
    res.json({ genome });
  } catch (err) {
    console.error('PATCH /api/genome/:boardId error:', err);
    res.status(500).json({ error: 'Failed to update genome' });
  }
});

module.exports = router;
