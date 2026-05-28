# Tests

## Running

```bash
npm test
```

Runs all `*.test.js` files via Jest with `--runInBand --detectOpenHandles`.

## Setup

Tests use mocked DB queries (via `tests/setup.js`) so they run **without a real Neon connection**.

## Files

| File | What it tests |
|------|---------------|
| `auth.test.js` | `/api/auth/register`, `/login`, `/logout`, `/me` |
| `bookings.test.js` | `/api/bookings/*` — availability, check, create, payment-verify, status |
| `boards.test.js` | `/api/boards/*` — list, detail, delist, photo sanitization |
| `critical-flows.md` | **Manual** pre-deploy checklist (renter + host flows) |

## CI note

If `npm install` fails in CI (403 blocked packages), tests are still syntactically correct and documented. The manual checklist (`critical-flows.md`) is the fallback until the package restriction is resolved.