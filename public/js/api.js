// public/js/api.js
// Source de vérité unique pour tous les endpoints frontend.
// Utiliser API.nomDeRoute() — jamais d'endpoint hardcodé dans le HTML.
// Ne jamais modifier ce fichier sans vérifier tous les callers.

window.API = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  register:         '/api/auth/register',
  login:            '/api/auth/login',
  logout:           '/api/auth/logout',
  me:               '/api/auth/me',

  // ── Boards ───────────────────────────────────────────────────────────────
  boards:           '/api/boards',
  boardsMy:         '/api/boards/my',
  boardsInstant:    '/api/boards/instant',
  board:            (id) => `/api/boards/${id}`,
  boardsHost:       (hostId) => `/api/boards/host/${hostId}`,
  boardCanDelete:   (id) => `/api/boards/${id}/can-delete`,
  boardDelist:      (id) => `/api/boards/${id}/delist`,
  boardRelist:      (id) => `/api/boards/${id}/relist`,

  // ── Bookings ──────────────────────────────────────────────────────────────
  bookings:              '/api/bookings',
  bookingsMy:            '/api/bookings/my',
  bookingsHost:          '/api/bookings/host',
  bookingsAvailability:  (boardId) => `/api/bookings/availability/${boardId}`,
  bookingCheck:          '/api/bookings/check',
  booking:               (id) => `/api/bookings/${id}`,
  bookingStatus:         (id) => `/api/bookings/${id}/status`,
  bookingPaymentVerify:  '/api/bookings/payment-verify',
  bookingExpireStale:    '/api/bookings/expire-stale',

  // ── Stripe Connect ───────────────────────────────────────────────────────
  stripeStatus:     '/api/stripe-connect/status',
  stripeOnboard:    '/api/stripe-connect/onboard',
  stripeBoard:      (boardId) => `/api/stripe-connect/board/${boardId}`,

  // ── Deposits ─────────────────────────────────────────────────────────────
  depositCheckout:  (bookingId) => `/api/deposits/${bookingId}/create`,
  depositRelease:   (bookingId) => `/api/deposits/${bookingId}/release`,
  depositReportDamage: (bookingId) => `/api/deposits/${bookingId}/report-damage`,
  depositVerify:    (bookingId) => `/api/deposits/${bookingId}/verify`,

  // ── Availability ──────────────────────────────────────────────────────────
  availability:           (boardId) => `/api/availability/${boardId}`,
  availabilityToggle:     (boardId) => `/api/availability/${boardId}/toggle`,
  availabilityBlockRange: (boardId) => `/api/availability/${boardId}/block-range`,
  availabilityUnblockRange: (boardId) => `/api/availability/${boardId}/unblock-range`,
  availabilitySlots:      (boardId) => `/api/availability/${boardId}/slots`,
  availabilitySlotsByDate:(boardId) => `/api/availability/${boardId}/slots-by-date`,
  availabilityToggleSlot: (boardId) => `/api/availability/${boardId}/toggle-slot`,

  // ── Genome ───────────────────────────────────────────────────────────────
  genome:           (boardId) => `/api/genome/${boardId}`,
  genomeById:        (genomeId) => `/api/genome/id/${genomeId}`,
  genomeHostMe:      '/api/genome/host/me',

  // ── Intelligence ─────────────────────────────────────────────────────────
  events:                '/api/intelligence/events',
  eventsBoard:          (boardId) => `/api/intelligence/events/board/${boardId}`,
  eventsSpot:           (spotId) => `/api/intelligence/events/spot/${spotId}`,
  failureAtlas:         '/api/intelligence/failure-atlas',
  failureAtlasSpot:     (spotId) => `/api/intelligence/failure-atlas/spot/${spotId}`,
  failureAtlasBoardSpot:(boardId, spotId) => `/api/intelligence/failure-atlas/board/${boardId}/spot/${spotId}`,
  failureAtlasRefresh:   (spotId) => `/api/intelligence/failure-atlas/refresh/${spotId}`,
  hostEvolution:         '/api/intelligence/host-evolution',
  hostEvolutionMe:       '/api/intelligence/host-evolution/me',
  hostEvolutionRefresh:  '/api/intelligence/host-evolution/refresh',
  hostEvolutionById:     (hostId) => `/api/intelligence/host-evolution/${hostId}`,
  hostEvolutionRefreshById: (hostId) => `/api/intelligence/host-evolution/${hostId}/refresh`,

  // ── Host Metrics (legacy shortcut) ────────────────────────────────────────
  hostMetricsMe:     '/api/host-metrics/me',
  hostMetricsRefresh:'/api/host-metrics/me/refresh',

  // ── Referrals ─────────────────────────────────────────────────────────────
  referralsMe:       '/api/referrals/me',
  referralsLookup:   (code) => `/api/referrals/lookup?code=${encodeURIComponent(code)}`,
  referralsTriggerLaunch: '/api/referrals/trigger-launch',

  // ── Promo ─────────────────────────────────────────────────────────────────
  promoValidate:    '/api/promo/validate',

  // ── Profiles ─────────────────────────────────────────────────────────────
  profileMe:         '/api/profiles/me',
  profile:           (id) => `/api/profiles/${id}`,

  // ── Spots ─────────────────────────────────────────────────────────────────
  spots:             '/api/spots',
  spotsSearch:       '/api/spots/search',
  spotsNearest:      '/api/spots/nearest',
  spot:              (slug) => `/api/spots/${slug}`,

  // ── Identity ─────────────────────────────────────────────────────────────
  identityStatus:    '/api/identity/status',
  identitySubmit:    '/api/identity/submit',

  // ── Messages ──────────────────────────────────────────────────────────────
  msgConversations:  '/api/messages/conversations',
  msgBooking:        (bookingId) => `/api/messages/${bookingId}`,
  msgRead:           (bookingId) => `/api/messages/${bookingId}/read`,
  msgUnread:         '/api/messages/unread',

  // ── Reviews ───────────────────────────────────────────────────────────────
  reviewStatus:      (bookingId) => `/api/reviews/status/${bookingId}`,
  reviews:           '/api/reviews',

  // ── Inspections ───────────────────────────────────────────────────────────
  inspection:        (bookingId) => `/api/inspections/${bookingId}`,
  inspectionSummary: (bookingId) => `/api/inspections/${bookingId}/summary`,
  inspectionPhotos:   (bookingId, type) => `/api/inspections/${bookingId}/${type}/photos`,
  inspectionConfirm:  (bookingId, type) => `/api/inspections/${bookingId}/${type}/confirm`,

  // ── Partners ───────────────────────────────────────────────────────────────
  partners:          '/api/partners',
};