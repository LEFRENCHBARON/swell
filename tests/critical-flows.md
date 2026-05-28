# Critical Flows — Manual Test Checklist

Execute before every deployment. If a step fails, do not ship — fix it first.

---

## Flow Locataire (Renter)

| # | Step | URL / Action | Expected | How to Verify |
|---|------|--------------|----------|---------------|
| 1 | Homepage loads | `/` | Page renders, no 500 | Look for search bar + hero |
| 2 | Search by location | `/` → type "Hossegor" in search | Results filter | Board cards appear with correct location |
| 3 | Open board detail | Click a board card | Board detail page loads (photos, price, description) | Photos visible, price shown in € |
| 4 | Check availability | On board detail, check date picker | Unavailable dates greyed out | No crash, dates render |
| 5 | Register account | `POST /api/auth/register` with `{email, name, password}` | 200 + session cookie set | `swell_sid` cookie present |
| 6 | Receive confirmation | Email arrives at address | Welcome email in inbox | Check inbox |
| 7 | Select time slot | Board detail → select date + start/end time | Price updates with correct hourly rate | Total updates |
| 8 | Book and pay | Confirm booking → redirect to Stripe | Payment page loads | URL contains `checkout.stripe.com` |
| 9 | Payment success | Return to `/payment/success?session_id=...&booking_id=...` | Success page with booking summary | Booking ID visible, not blank |
| 10 | Booking confirmed | `GET /api/bookings/my` → new booking has `status: confirmed` | Booking appears in "Mes réservations" | Card shows status confirmed |
| 11 | View booking detail | Click confirmed booking | Booking details: dates, times, host contact | Host name/avatar visible |

---

## Flow Hôte (Host)

| # | Step | URL / Action | Expected | How to Verify |
|---|------|--------------|----------|---------------|
| 1 | Register / log in | `POST /api/auth/register` then login | Session cookie set | `swell_sid` cookie present |
| 2 | Access host dashboard | `/host` | Host dashboard renders | "Mes annonces" or board count visible |
| 3 | Create listing (wizard) | `POST /api/boards` with ≥3 photos | 200, `board.id` returned | Board appears in `/host` |
| 4 | Photos upload | Send 3+ images to `POST /api/boards` | All URLs are R2-hosted | `pub-...r2.dev` URLs in response |
| 5 | Set price | Set `dailyPrice` and `hourlyRate` | Values stored in DB | `GET /api/boards/:id` returns correct cents |
| 6 | Set availability | `POST /api/availability/block` or date picker in `/host` | Dates blocked | Booked dates no longer selectable by renters |
| 7 | Connect Stripe | Visit Stripe onboarding via `/api/stripe-connect/start` | Redirect to Stripe | Stripe onboarding page loads |
| 8 | Complete onboarding | Return from Stripe → `stripe_onboarding_completed_at` set | Host can receive payments | `GET /api/profiles/me` shows `stripe_onboarding_completed_at` not null |
| 9 | Receive booking request | Simulate renter booking → check `/api/bookings/host` | New pending booking visible | `status: pending` shown |
| 10 | Confirm booking | `PATCH /api/bookings/:id/status` with `{status: confirmed}` | Booking status = confirmed | Renter can see confirmed status |
| 11 | Check-in with photos | `POST /api/inspections` with check-in photos | Inspection record created | Inspection visible on booking detail |
| 12 | Check-out with photos | `POST /api/inspections` with type: check_out | Inspection record created | Both check-in + check-out visible |
| 13 | Payout triggered | After check-out → Stripe payout via Polsia payments | Host receives funds | Stripe dashboard shows payout |

---

## Smoke Tests — Every Deployment

- [ ] `GET /health` → `{status: "healthy"}`
- [ ] `GET /` → homepage loads, no blank screen
- [ ] `POST /api/auth/register` → creates user, returns 200
- [ ] `POST /api/auth/login` → session created, `swell_sid` cookie set
- [ ] `GET /api/boards` → returns board list, no 500
- [ ] `GET /api/boards/:id` → returns board + reviews, no 500
- [ ] `GET /api/spots` → returns surf spots, no 500

---

## Payments Smoke Tests

- [ ] `POST /api/bookings` → creates booking with `status: pending`
- [ ] Stripe checkout URL returned (when Polsia API is up)
- [ ] `POST /api/bookings/payment-verify` → transitions booking to `status: confirmed`
- [ ] Promo code `FIRSTSESSION50` → discount applied to booking total

---

## Failure Mode Checks

- [ ] Book own board → 400 error
- [ ] Book board with host Stripe not configured → 402 error
- [ ] Book already-booked slot → 409 conflict
- [ ] Request with invalid CSRF token → 403 error
- [ ] Request without session → 401 error
- [ ] Register duplicate email → 409 conflict

---

## Environment-Specific Notes

**Staging / Production:** All tests above apply. Payments test with real Stripe (card not charged on test mode).

**Local dev:** Payments mock/stubbed — `POST /api/bookings` may not return a real Stripe URL. Test the booking record creation, not the payment completion.

---

## Who Runs This

The deploying agent runs `npm test` (Jest suite) BEFORE `push_to_remote`. If tests pass, push. If tests fail, fix first.

Manual checklist is run by the human reviewing the PR or by the QA agent.