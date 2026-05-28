# SWELL OPERATING INTELLIGENCE
**From marketplace to surf data infrastructure**

*Last updated: 2026-05-21*

---

```
Marketplace (boards + bookings)
         ↓
Trust System (Swell Shield + Caution Hold)
         ↓
Risk Engine (Genome + Event Store + Failure Atlas)
         ↓
Surf Data Network (patterns + predictions + host intelligence)
         ↓
Infrastructure Layer (API moat + network effects)
```

---

## What Changed

Swell started as a listing marketplace. It is now an intelligence infrastructure with five interconnected data systems. Here's what was built and why each layer matters.

---

## System 1 — SWELL_GENOME
**Each board is a data object, not a listing.**

Every board on Swell now has a genome — a structured identity that tracks its physical profile, rental history, damage events, and financial performance. The genome auto-bootstraps on board creation and enriches with every completed rental.

**Key metrics the genome tracks:**
- `survival_score` (0–100): Drops with each damage event. Starts at 100.
- `rental_count`: Increments on each completed rental.
- `roi_class` (A+, A, B, C): Computed from survival + rental volume + revenue per rental.
- `life_expectancy_estimate`: Estimated rentals remaining before board is effectively retired.
- `genome_id` (QG-XXXXXX): Human-readable permanent identifier.

**Where it lives:**
- DB: `board_genomes` table
- API: `GET /api/genome/:boardId` — returns full genome
- API: `GET /api/genome/host/me` — host's full portfolio view
- API: `PATCH /api/genome/:boardId` — host enriches construction, shaper, etc.

**Why it matters:** A board with an A+ genome and 40 rentals at €45/day is provably worth more than a comparable board with no history. This becomes pricing signal, trust signal, and eventually resale value.

---

## System 2 — SWELL_EVENT_STORE
**Each rental is a learning event.**

Every completed booking appends a `RentalEvent` to an immutable event log. The event captures what happened before (conditions, rider profile, board) and after (return state, hidden costs, satisfaction score).

**Event structure captures:**
- Pre-rental: weather, swell height/period/direction, spot, board, rider level
- Post-rental: return condition, micro-impacts, return time delta, satisfaction, hidden costs

**Where it lives:**
- DB: `rental_events` table (append-only by design)
- API: `POST /api/intelligence/events` — append event
- API: `GET /api/intelligence/events` — admin feed with stats
- API: `GET /api/intelligence/events/board/:boardId` — board-specific history
- API: `GET /api/intelligence/events/spot/:spotId` — spot patterns

**Why it matters:** Pattern detection becomes possible. "Beginner + PU board + La Gravière = 47% incident rate" is actionable intelligence. Insurance pricing, dynamic deposits, and host recommendations all flow from this.

---

## System 3 — SWELL_FAILURE_ATLAS
**Surf spots are risk zones, not just pins on a map.**

The Failure Atlas maps every surf spot to a damage risk profile: damage multiplier, dominant damage types, board recommendations, and rider level warnings. It starts with expert-seeded data and auto-updates as real events accumulate.

**Currently seeded (expert data):**
- Hossegor Nord: ×1.8 (intermediate+, PU thin rails at risk)
- La Gravière: ×2.1 (advanced only — most aggressive spot on the coast)
- Parlementia: ×2.3 (advanced only — biggest wave penalty)
- Côte des Basques: ×0.7 (beginner friendly — lowest risk)
- Hendaye Grande Plage: ×0.6 (most forgiving)

**Where it lives:**
- DB: `failure_zones` table
- API: `GET /api/intelligence/failure-atlas` — full atlas
- API: `GET /api/intelligence/failure-atlas/spot/:spotId` — single spot risk
- API: `GET /api/intelligence/failure-atlas/board/:boardId/spot/:spotId` — board×spot effective risk
- API: `POST /api/intelligence/failure-atlas/refresh/:spotId` — recalculate from events

**Why it matters:** Used in three places: booking flow risk warnings, dynamic deposit sizing (high-risk spot = larger caution hold), and host insights ("your PU shortboard earns less near La Gravière — rent it to Côte des Basques renters instead").

---

## System 4 — HOST_EVOLUTION_ENGINE
**Hosts are scored, tiered, and cultivated.**

Every host gets a `trust_score` (0–100) and a tier classification based on behavior signals: board quality, response time, incident rate, repeat renters, identity verification, payout history.

**Five tiers:**

| Tier | Description | Threshold |
|---|---|---|
| ALPHA_SHAPER | Partnership candidate — best boards, community pull | trust > 90, quality > 4.8, community > 1000 |
| LOCAL_ICON | Trusted community anchor, repeat renter magnet | trust > 80, repeats > 30% |
| PREMIUM_HOST | Reliable host, all metrics green | trust > 70 |
| GROWTH_HOST | Rising host, has potential | trust > 50 |
| AT_RISK | Needs intervention or offboarding | trust < 30 OR incidents > 20% OR response > 48h |

**Where it lives:**
- DB: `host_metrics` table
- API: `GET /api/intelligence/host-evolution/me` — host's own tier + requirements
- API: `GET /api/intelligence/host-evolution` — admin: full tier view
- API: `POST /api/intelligence/host-evolution/refresh` — recalculate from live DB

**Why it matters:** ALPHA_SHAPERs are our future exclusive partners. AT_RISK hosts are reputation liabilities. The engine identifies both automatically without manual review.

---

## System 5 — THE_QUIVER_COPY_RISK
**Strategic moat analysis.**

A living document (`THE_QUIVER_COPY_RISK.md`) that grades each Swell component by how hard it is to copy. Classification: IMPOSSIBLE / HARD / MEDIUM / EASY.

**Key findings:**
- Event Store: IMPOSSIBLE — real-world outcomes cannot be synthesized
- Brand Positioning: IMPOSSIBLE (3–5 year horizon) — community trust is non-transferable
- Genome (data): IMPOSSIBLE once populated — 12 months to replicate
- Failure Atlas: HARD — expert data is public, learned multipliers are not
- Caution Hold: EASY in isolation — value comes from Shield bundle

---

## API Map (New Endpoints)

```
GET  /api/genome/:boardId                                — Board genome
GET  /api/genome/id/:genomeId                            — Lookup by QG-XXXXXX
GET  /api/genome/host/me                                 — Host portfolio
PATCH /api/genome/:boardId                               — Enrich genome

POST /api/intelligence/events                            — Append rental event
GET  /api/intelligence/events                            — Admin event feed
GET  /api/intelligence/events/board/:boardId             — Board history
GET  /api/intelligence/events/spot/:spotId               — Spot patterns

GET  /api/intelligence/failure-atlas                     — Full atlas
GET  /api/intelligence/failure-atlas/spot/:spotId        — Spot risk profile
GET  /api/intelligence/failure-atlas/board/:b/spot/:s    — Board×spot risk
POST /api/intelligence/failure-atlas/refresh/:spotId     — Refresh from events

GET  /api/intelligence/host-evolution/me                 — My tier
GET  /api/intelligence/host-evolution                    — Admin tier view
GET  /api/intelligence/host-evolution/:hostId            — Single host
POST /api/intelligence/host-evolution/refresh            — Recalculate
POST /api/intelligence/host-evolution/:hostId/refresh    — Admin recalculate
```

---

## Data Flow Diagram

```
Booking Completed
       ↓
  1. appendRentalEvent()        → rental_events (immutable)
       ↓
  2. recordProfitEvent()        → board_genomes.profit_history
     recordDamageEvent()        → board_genomes.damage_history
       ↓
  3. refreshZoneFromEvents()    → failure_zones.damage_multiplier (blended)
       ↓
  4. refreshHostMetrics()       → host_metrics.trust_score + tier
```

---

## What Comes Next

These systems are live with structure and APIs. They become valuable as data fills in. Three priorities:

1. **Wire booking completion hook** — trigger `appendRentalEvent()` automatically when a booking is marked `completed`. Currently requires manual POST.

2. **Host dashboard — Genome tab** — expose genome cards in the host `/host` page. Host sees their boards' survival scores and ROI class. Creates emotional engagement with the data layer.

3. **Booking flow risk warnings** — when a renter selects a spot, fetch the failure atlas zone and surface a risk badge: "⚠️ Spot technique — planches EPS recommandées". Drives better match-making before deposit stress.

---

## Files Created

```
migrations/
  1779000000000_create_board_genomes.sql
  1779000001000_create_rental_events.sql
  1779000002000_create_failure_atlas.sql
  1779000003000_create_host_metrics.sql

db/
  genome.js          — Genome queries + scoring
  events.js          — Event store queries + pattern detection
  atlas.js           — Failure zone queries + risk calculation
  hostEvolution.js   — Host tier scoring + metrics refresh

routes/
  genome.js          — /api/genome/* endpoints
  intelligence.js    — /api/intelligence/* endpoints (Events + Atlas + Host Evolution)

THE_QUIVER_COPY_RISK.md       — Moat analysis document
SWELL_OPERATING_INTELLIGENCE.md — This document
```
