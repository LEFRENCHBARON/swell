    // ==================== CSRF ====================
    // Override global fetch to inject X-CSRF-Token header on mutating requests.
    // Reads the XSRF-TOKEN cookie set by the server's CSRF middleware.
    (function() {
      const _origFetch = window.fetch;
      function getCsrfToken() {
        const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
      }
      window.fetch = function(url, opts) {
        opts = opts || {};
        const method = (opts.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
          const token = getCsrfToken();
          if (token) {
            // Preserve existing headers (Headers, object, or array)
            if (opts.headers instanceof Headers) {
              if (!opts.headers.has('X-CSRF-Token')) opts.headers.set('X-CSRF-Token', token);
            } else {
              opts.headers = Object.assign({ 'X-CSRF-Token': token }, opts.headers || {});
            }
          }
        }
        return _origFetch.call(this, url, opts);
      };
    })();

    // ==================== STATE ====================
    let currentUser = null;
    let userIdentityStatus = null; // null | 'pending_review' | 'verified' | 'rejected'
    let allBoards = [];
    let allSpots = [];
    let currentBoardId = null;
    let pendingBoardId = null;
    let pendingAction = null; // 'book' | 'list' — action pending KYC completion
    let currentConversationBookingId = null;
    let msgPollInterval = null;
    let leafletMap = null;
    let leafletSpotMarkers = [];
    let leafletBoardMarkers = [];
    let spotAcTimeout = null;
    let listSpotAcTimeout = null;

    // ==================== INIT ====================
    document.addEventListener('DOMContentLoaded', async () => {
      try {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const checkout = new Date(); checkout.setDate(checkout.getDate() + 4);
      document.getElementById('search-start').value = tomorrow.toISOString().split('T')[0];
      document.getElementById('search-end').value = checkout.toISOString().split('T')[0];

      // Close autocomplete dropdowns on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#spot-search-input') && !e.target.closest('#spot-autocomplete')) {
          document.getElementById('spot-autocomplete').style.display = 'none';
        }
        if (!e.target.closest('#list-spot-input') && !e.target.closest('#list-spot-autocomplete')) {
          const lac = document.getElementById('list-spot-autocomplete');
          if (lac) lac.style.display = 'none';
        }
      });

      await checkAuth();
      // Load spots into memory for map seeding and autocomplete
      try {
        const r = await fetch('/api/spots');
        const d = await r.json();
        allSpots = d.spots || [];
      } catch(_) {}
      await loadBoards();
      setupPhotoPreview();

      const urlParams = new URLSearchParams(window.location.search);

      // ?spot=slug — deep-link to a specific spot (from footer links)
      const spotParam = urlParams.get('spot');
      if (spotParam) {
        const spot = allSpots.find(s => s.slug === spotParam || s.region === spotParam);
        if (spot) selectSpot(spot, false);
      }

      // ?source=host — remember that this session came from a host CTA
      // Used after auth to redirect into listing wizard instead of marketplace
      if (urlParams.get('source') === 'host') {
        sessionStorage.setItem('swell_host_source', '1');
      }

      // ?signup=1 — open auth modal on the register tab (from landing page CTA)
      if (urlParams.get('signup') === '1' && !currentUser) {
        openModal('auth-modal');
        switchAuthTab('register');
        // Host-mode: personalise the auth modal title
        if (urlParams.get('source') === 'host') {
          const titleEl = document.getElementById('auth-modal-title');
          if (titleEl) titleEl.textContent = 'Créer ton compte host 🏄';
        }
        // If source=host and already logged in, open wizard directly
      } else if (urlParams.get('source') === 'host' && currentUser) {
        openListModal();
      }

      // ?board=ID — deep-link directly to a board detail (social sharing)
      const boardParam = urlParams.get('board');
      if (boardParam) openBoardDetail(parseInt(boardParam, 10));

      // ?ref=CODE — referral attribution: store code in cookie + show welcome banner
      const refCode = urlParams.get('ref');
      if (refCode) {
        // Store in cookie (30 days) for signup attribution
        document.cookie = `swell_ref=${encodeURIComponent(refCode)};max-age=${30*24*3600};path=/;SameSite=Lax`;
        localStorage.setItem('swell_ref', refCode);
        // Resolve name and show banner
        try {
          const refRes = await fetch(`/api/referrals/lookup?code=${encodeURIComponent(refCode)}`);
          if (refRes.ok) {
            const refData = await refRes.json();
            if (refData.valid && refData.inviterName) {
              const banner = document.getElementById('ref-banner');
              const nameEl = document.getElementById('ref-banner-name');
              if (banner && nameEl) {
                nameEl.textContent = refData.inviterName.split(' ')[0];
                banner.style.display = 'block';
                // Shift body down so banner doesn't overlap content
                document.body.style.paddingTop = '42px';
              }
            }
          }
        } catch(_) {}
      }
      } catch(e) { console.error('init error:', e); }
    });

    // ==================== AUTH ====================
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        currentUser = data.user;
        updateNavAuth();
        if (currentUser) {
          startMsgBadgePoll();
          fetchIdentityStatus();
        }
      } catch(e) { currentUser = null; }
    }

    async function fetchIdentityStatus() {
      try {
        const res = await fetch('/api/identity/status');
        if (res.ok) {
          const data = await res.json();
          userIdentityStatus = data.identity?.identity_status || null;
        }
      } catch(_) {}
    }

    function updateNavAuth() {
      const area = document.getElementById('nav-auth-area');
      if (currentUser) {
        area.innerHTML = `
          <a href="/host" class="nav-link" style="color:var(--primary);font-weight:600;font-size:0.82rem;display:none;" id="nav-host-link">🏄 Mes planches</a>
          <span class="nav-link" data-action="open-messages" style="cursor:pointer; display:flex; align-items:center; gap:0.2rem;" title="Messages">
            💬<span id="nav-msg-badge" style="display:none;" class="msg-badge"></span>
          </span>
          <span class="nav-link" data-action="open-profile-bookings" style="cursor:pointer; display:flex; align-items:center; gap:0.4rem;">
            ${currentUser.avatar_url
              ? `<img src="${currentUser.avatar_url}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:2px solid var(--primary);" alt="${currentUser.name[0].toUpperCase()}">`
              : `<span style="width:26px;height:26px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:var(--bg);">${currentUser.name[0].toUpperCase()}</span>`}
            ${currentUser.name.split(' ')[0]}
          </span>
        `;
        // Show /host link only if user has boards (async check)
        checkHostNavLink();
      } else {
        area.innerHTML = `
          <button class="btn btn-outline" data-action="open-auth-register" style="border-color:rgba(0,194,224,0.4);color:var(--primary);">S'inscrire</button>
          <button class="btn btn-primary" data-action="open-auth-login">Connexion</button>
        `;
      }
    }

    // Show /host nav link if user has at least one board
    async function checkHostNavLink() {
      try {
        const res = await fetch('/api/boards/my');
        if (!res.ok) return;
        const data = await res.json();
        const boards = data.boards || [];
        const linkEl = document.getElementById('nav-host-link');
        if (linkEl && boards.length > 0) linkEl.style.display = 'inline-flex';
      } catch(_) {}
    }

    async function doLogin() {
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; errEl.style.display='block'; return; }
        currentUser = data.user;
        updateNavAuth();
        startMsgBadgePoll();
        fetchIdentityStatus();
        closeModal('auth-modal');
        toast('Bienvenue, ' + currentUser.name.split(' ')[0] + ' !', 'success');

        // If user arrived via host CTA, redirect straight to listing wizard
        if (sessionStorage.getItem('swell_host_source') === '1') {
          sessionStorage.removeItem('swell_host_source');
          setTimeout(() => openListModal(), 300);
          return;
        }

        if (pendingBoardId) {
          const bid = pendingBoardId; pendingBoardId = null;
          openBoardDetail(bid);
        }
      } catch(e) { errEl.textContent = 'Une erreur est survenue'; errEl.style.display='block'; }
    }

    async function doRegister() {
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const pass = document.getElementById('reg-password').value;
      const errEl = document.getElementById('reg-error');
      errEl.style.display = 'none';

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password: pass })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; errEl.style.display='block'; return; }
        currentUser = data.user;
        updateNavAuth();
        if (data.lead && localStorage.getItem('swell_analytics') === 'accepted') { fbq('track', 'Lead'); }
        startMsgBadgePoll();
        fetchIdentityStatus();
        closeModal('auth-modal');
        toast('Bienvenue sur Swell, ' + name.split(' ')[0] + ' !', 'success');

        // If user arrived via host CTA, redirect straight to listing wizard
        if (sessionStorage.getItem('swell_host_source') === '1') {
          sessionStorage.removeItem('swell_host_source');
          setTimeout(() => openListModal(), 300);
          return;
        }

        if (pendingBoardId) {
          const bid = pendingBoardId; pendingBoardId = null;
          openBoardDetail(bid);
        }
      } catch(e) { errEl.textContent = 'Une erreur est survenue'; errEl.style.display='block'; }
    }

    function switchAuthTab(tab) {
      document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
      document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
      document.getElementById('tab-login').classList.toggle('active', tab === 'login');
      document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    }

    // ==================== BOARDS ====================
    async function loadBoards() {
      const type = document.getElementById('search-type').value;
      const activeChip = document.querySelector('.filter-chip.active');
      const chipType = activeChip ? activeChip.dataset.type : '';
      const finalType = type || chipType;
      const spotId = document.getElementById('selected-spot-id').value;
      const spotLat = document.getElementById('selected-spot-lat').value;
      const spotLng = document.getElementById('selected-spot-lng').value;

      // Brief fade before showing skeleton
      const grid = document.getElementById('boards-grid');
      if (grid) { grid.style.opacity = '0.3'; grid.style.transition = 'opacity 0.15s'; }
      await new Promise(r => setTimeout(r, 80));
      if (grid) { grid.style.opacity = ''; grid.style.transition = ''; }

      document.getElementById('boards-grid').innerHTML = loadingSkeleton();
      document.getElementById('results-count').textContent = '';

      const params = new URLSearchParams();
      if (finalType) params.set('type', finalType);
      if (spotId) params.set('spotId', spotId);
      if (spotLat && spotLng) { params.set('spotLat', spotLat); params.set('spotLng', spotLng); }

      try {
        const res = await fetch('/api/boards?' + params);
        const data = await res.json();
        allBoards = data.boards || [];
        renderBoards(allBoards);
        if (leafletMap) updateBoardMarkers(allBoards);
      } catch(e) {
        document.getElementById('boards-grid').innerHTML = `<div class="empty-state"><div class="empty-state-icon">🌊</div><h3>Impossible de charger les planches</h3><p style="margin-top:0.5rem;"><a href="#" data-action="loadBoards" style="color:var(--primary);font-weight:600;">Réessayer</a></p></div>`;
      }
    }

    function renderBoards(boards) {
      const grid = document.getElementById('boards-grid');
      const count = document.getElementById('results-count');
      count.textContent = boards.length ? `${boards.length} planche${boards.length === 1 ? '' : 's'}` : '';

      if (boards.length === 0) {
        grid.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">🏄</div>
          <h3>Aucune planche dans cette zone</h3>
          <p style="margin-top:0.5rem;">Elargis ta recherche ou sois le premier à lister une planche ici.</p>
          <a href="/host.html" class="btn" style="display:inline-flex;margin-top:1rem;background:var(--primary);color:white;border:none;border-radius:100px;padding:0.7rem 1.5rem;font-weight:600;text-decoration:none;">Lister ma planche →</a>
        </div>`;
        return;
      }

      grid.innerHTML = boards.map(board => {
        const photo = board.photos?.[0];
        const hourlyRate = board.hourly_rate_cents ? (board.hourly_rate_cents / 100).toFixed(0) : null;
        const dailyPrice = (board.daily_price_cents / 100).toFixed(0);
        const rating = parseFloat(board.avg_rating || 0);
        const stars = rating > 0 ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating)) : '';
        const conditionClass = { excellent: 'condition-excellent', good: 'condition-good', fair: 'condition-fair' }[board.condition] || 'condition-good';

        // Build trust signals: tier badge (compact) + member_since (compact) + rental count
        const tierCompact = board.host_tier ? hostTierBadge(board.host_tier, true) : '';
        const memberCompact = memberSinceBadge(board.host_member_since, true);
        const rentalCount = board.total_completed_bookings > 0 ? board.total_completed_bookings : null;

        return `<div class="board-card" data-action="openBoardDetail" data-args="%24%7Bboard.id%7D">
          <div class="board-photo">
            ${photo ? `<img src="${photo}" alt="${escapeHtml(board.title || '')}" loading="lazy">` : `<div class="board-photo-placeholder">🏄</div>`}
            <span class="board-badge">${escapeHtml(board.board_type || '')}</span>
            <span class="board-price-badge">€${hourlyRate ? hourlyRate + '/h' : dailyPrice + '/jour'}</span>
          </div>
          <div class="board-info">
            <div class="board-title">${escapeHtml(board.title)}</div>
            <div class="board-meta">
              ${board.length_ft ? `<span class="board-meta-item">📏 ${board.length_ft}ft</span>` : ''}
              <span class="condition-badge ${conditionClass}">${board.condition}</span>
              ${rating > 0 ? `<span class="board-meta-item"><span class="stars">${stars}</span> ${rating}</span>` : ''}
            </div>
            <div class="board-host">
              <div class="avatar">${board.host_avatar ? `<img src="${board.host_avatar}" loading="lazy">` : escapeHtml(board.host_name[0])}</div>
              <div>
                <div style="font-size:0.78rem;display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
                  ${escapeHtml(board.host_name)}
                  ${board.host_identity_status === 'verified' ? identityBadgeHtml('verified', true) : ''}
                  ${board.host_charges_enabled ? paymentBadgeHtml(true, true) : ''}
                  ${tierCompact}
                  ${memberCompact}
                </div>
                <div class="board-host-name">
                  ${board.spot_name
                    ? `🏄 ${escapeHtml(board.spot_name)}${board.distance_km && board.distance_km < 900 ? ` <span class="spot-board-distance">~${board.distance_km < 1 ? Math.round(board.distance_km * 1000) + 'm' : board.distance_km.toFixed(1) + 'km'}</span>` : ''}`
                    : `📍 ${escapeHtml(board.location)}`}
                  ${rentalCount ? ` · <span style="font-size:0.72rem;color:var(--text-muted);">${rentalCount} location${rentalCount > 1 ? 's' : ''}</span>` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // ==================== LEAFLET MAP ====================
    function initLeafletMap() {
      if (leafletMap) return; // already initialized
      if (!window.L) return;  // Leaflet not yet loaded

      // Center on Hossegor coast by default
      leafletMap = L.map('leaflet-map', {
        center: [43.660, -1.430],
        zoom: 11,
        zoomControl: true,
        scrollWheelZoom: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18
      }).addTo(leafletMap);

      // Draw all surf spot markers
      drawSpotMarkers();

      // Fix Leaflet CSS tile gaps after becoming visible
      setTimeout(() => leafletMap.invalidateSize(), 100);
    }

    function drawSpotMarkers() {
      if (!leafletMap || !allSpots.length) return;

      leafletSpotMarkers.forEach(m => leafletMap.removeLayer(m));
      leafletSpotMarkers = [];

      allSpots.forEach(spot => {
        const count = parseInt(spot.board_count) || 0;
        const icon = L.divIcon({
          className: '',
          html: `<div class="leaflet-spot-pin ${count > 0 ? 'has-boards' : ''}">${spot.name} ${count > 0 ? `(${count})` : ''}</div>`,
          iconAnchor: [0, 0]
        });
        const marker = L.marker([spot.latitude, spot.longitude], { icon })
          .addTo(leafletMap)
          .on('click', () => {
            selectSpot(spot, true);
            loadBoards();
          });
        leafletSpotMarkers.push(marker);
      });
    }

    function updateBoardMarkers(boards) {
      if (!leafletMap) return;

      leafletBoardMarkers.forEach(m => leafletMap.removeLayer(m));
      leafletBoardMarkers = [];

      // Group boards by lat/lng to avoid stacking
      const positioned = boards.filter(b => b.latitude && b.longitude);
      positioned.forEach(board => {
        const price = (board.daily_price_cents / 100).toFixed(0);
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:white;border:2px solid var(--primary);border-radius:8px;padding:3px 7px;font-size:0.7rem;font-weight:700;color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,0.15);cursor:pointer;white-space:nowrap;">€${price}</div>`,
          iconAnchor: [20, 10]
        });
        const m = L.marker([board.latitude, board.longitude], { icon })
          .addTo(leafletMap)
          .on('click', () => openBoardDetail(board.id));
        leafletBoardMarkers.push(m);
      });
    }

    // ==================== BOARD DETAIL ====================
    async function openBoardDetail(boardId) {
      currentBoardId = boardId;
      openModal('detail-modal');
      document.getElementById('detail-body').innerHTML = `
        <div style="border-radius:12px;overflow:hidden;margin-bottom:1.25rem;">
          <div class="skeleton-img" style="height:220px;border-radius:12px;"></div>
        </div>
        <div class="skeleton-line" style="height:22px;width:65%;margin-bottom:0.6rem;"></div>
        <div class="skeleton-line" style="height:14px;width:45%;margin-bottom:1.25rem;"></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.6rem;margin-bottom:1.25rem;">
          ${[1,2,3].map(()=>`<div class="skeleton-line" style="height:52px;border-radius:10px;margin-bottom:0;"></div>`).join('')}
        </div>
        <div class="skeleton-line" style="height:100px;border-radius:10px;margin-bottom:0;"></div>
      `;

      // Update URL to canonical /boards/:id for sharing + SEO
      history.replaceState(null, '', `/boards/${boardId}`);

      try {
        const res = await fetch(`/api/boards/${boardId}`);
        const data = await res.json();
        if (res.status === 410) {
          // Board was delisted by the host
          document.getElementById('detail-title').textContent = 'Planche non disponible';
          document.getElementById('detail-body').innerHTML = `
            <div style="text-align:center;padding:3rem 1.5rem;">
              <div style="font-size:2.5rem;margin-bottom:1rem;">📴</div>
              <h3 style="margin-bottom:0.5rem;color:var(--text);">Cette planche n'est plus disponible</h3>
              <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1.5rem;">Le host a retiré cette planche du marketplace.</p>
              <button class="btn btn-primary" data-action="closeModal" data-args="'board-detail-modal')%3BloadBoards(">Voir les autres planches</button>
            </div>`;
          return;
        }
        if (!res.ok) throw new Error(data.error);
        const { board, reviews, related = [] } = data;
        document.getElementById('detail-title').textContent = board.title;
        // renderBoardDetail sets detail-body.innerHTML directly — do not overwrite with return value
        renderBoardDetail(board, reviews, related);
        loadAvailability(boardId);

        // Inject JSON-LD structured data for this board into <head>
        // Helps search engines index individual board listings from direct ?board= URLs
        injectBoardJsonLd(boardId);

        // Pageview tracking — board_view event with spot/type metadata for segmentation
        trackBoardEvent('board_view', boardId, { board_type: board.board_type, spot_id: board.spot_id });
      } catch(e) {
        document.getElementById('detail-body').innerHTML = `<div style="text-align:center;padding:3rem;color:var(--red);">Impossible de charger la planche</div>`;
      }
    }

    async function injectBoardJsonLd(boardId) {
      try {
        const existing = document.getElementById('board-jsonld');
        if (existing) existing.remove();
        const res = await fetch(`/structured-data/board/${boardId}`);
        if (!res.ok) return;
        const jsonLd = await res.json();
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'board-jsonld';
        script.textContent = JSON.stringify(jsonLd);
        document.head.appendChild(script);
      } catch (_) { /* non-fatal — structured data is enhancement, not critical path */ }
    }

    function renderBoardDetail(board, reviews, related = []) {
      const photos = board.photos || [];
      const price = (board.daily_price_cents / 100).toFixed(0);
      const hourlyRate = (board.hourly_rate_cents ? board.hourly_rate_cents / 100 : Math.round(board.daily_price_cents / 800)).toFixed(0);
      const rating = parseFloat(board.avg_rating || 0);
      const conditionClass = { excellent: 'condition-excellent', good: 'condition-good', fair: 'condition-fair' }[board.condition] || 'condition-good';

      // Photo gallery with lightbox — first photo is main (tap to zoom), thumbnails clickable
      const photoCount = photos.length;
      const galleryHtml = photos.length > 0 ? `
        <div class="board-detail-gallery">
          <div class="board-detail-gallery-main" style="cursor:zoom-in;" data-action="openLightbox" data-args="%24%7BJSON.stringify(photos"/g, '&quot;')}, 0); trackBoardEvent('click_lightbox', ${board.id}, { photo_index: 0 })" role="button" tabindex="0" aria-label="Zoomer sur les photos">
            <img src="${photos[0]}" alt="${board.title}" loading="lazy">
          </div>
          ${photoCount > 1 ? `<div class="board-detail-gallery-thumbs-row">
            ${photos.slice(1, Math.min(photoCount, 4)).map((p, i) => `
              <div class="board-detail-gallery-thumb" style="cursor:zoom-in;" data-action="openLightbox" data-args="%24%7BJSON.stringify(photos"/g, '&quot;')}, ${i + 1}); trackBoardEvent('click_lightbox', ${board.id}, { photo_index: ${i + 1} })" role="button" tabindex="0" aria-label="Photo ${i + 2}">
                <img src="${p}" alt="${board.title}" loading="lazy">
              </div>`).join('')}
            ${photoCount > 4 ? `<div class="board-detail-gallery-thumb board-detail-gallery-more" data-action="openLightbox" data-args="%24%7BJSON.stringify(photos"/g, '&quot;')}, 3)" role="button" tabindex="0" aria-label="Voir toutes les ${photoCount} photos">
                <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;color:#fff;background:rgba(0,0,0,0.5);border-radius:8px;">+${photoCount - 3}</span>
              </div>` : ''}
          </div>` : ''}
        </div>` : `
        <div style="height:180px;background:linear-gradient(135deg,#0f2233,#0a1628);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:3.5rem;margin-bottom:1.25rem;opacity:0.3;">🏄</div>`;

      const includes = [];
      if (board.fins_included) includes.push('Dérives');
      if (board.leash_included) includes.push('Leash');
      if (board.bag_included) includes.push('Housse');

      const reviewsHtml = reviews && reviews.length > 0 ? reviews.map(r => `
        <div class="review-card">
          <div class="review-header">
            <div class="avatar">${r.reviewer_avatar ? `<img src="${r.reviewer_avatar}" loading="lazy">` : escapeHtml(r.reviewer_name[0])}</div>
            <div>
              <div style="font-size:0.85rem;font-weight:500;">${escapeHtml(r.reviewer_name)}</div>
              <div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
            </div>
          </div>
          ${r.comment ? `<div class="review-comment">"${escapeHtml(r.comment)}"</div>` : ''}
          <div class="review-date">${new Date(r.created_at).toLocaleDateString('fr-FR', {month:'short',year:'numeric'})}</div>
        </div>
      `).join('') : `<p style="color:var(--text-muted);font-size:0.85rem;">Aucun avis pour l'instant</p>`;

      document.getElementById('detail-body').innerHTML = `
        ${galleryHtml}
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem;">
          <div>
            ${rating > 0 ? `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;">
              <span class="stars stars-lg">${'★'.repeat(Math.round(rating))}${'☆'.repeat(5-Math.round(rating))}</span>
              <span style="font-size:0.875rem;font-weight:600;color:var(--text);">${rating}</span>
              <span style="font-size:0.8rem;color:var(--text-muted);">(${board.review_count} avis)</span>
            </div>` : ''}
            ${(board.bookings_count_30d > 0) ? `<div class="rental-count-badge" style="margin-bottom:0.3rem;">📅 Réservée ${board.bookings_count_30d} fois ces 30 derniers jours</div>` : ''}
            ${(board.listing_age_days != null && board.listing_age_days < 30) ? `<div class="new-listing-badge" style="margin-bottom:0.3rem;">🆕 Nouveau sur Swell</div>` : ''}
            ${(board.upcoming_bookings_7d > 0) ? `<div class="urgency-badge" style="margin-bottom:0.3rem;">⚡ ${board.upcoming_bookings_7d} créneau${board.upcoming_bookings_7d > 1 ? 'x' : ''} réservé${board.upcoming_bookings_7d > 1 ? 's' : ''} cette semaine</div>` : ''}
            <div style="font-size:0.82rem;color:var(--text-muted);">
              ${board.spot_name ? `🏄 <strong style="color:var(--primary);">${escapeHtml(board.spot_name)}</strong> · ` : ''}📍 ${escapeHtml(board.location)}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:800;color:var(--primary);">€${price}<span style="font-size:0.75rem;font-weight:500;color:var(--text-muted);">/jour</span></div>
            ${board.hourly_rate_cents ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.1rem;">ou €${hourlyRate}/h</div>` : ''}
          </div>
        </div>

        <div class="specs-grid">
          <div class="spec-item">
            <div class="spec-value">${board.board_type}</div>
            <div class="spec-label">Type</div>
          </div>
          ${board.length_ft ? `<div class="spec-item"><div class="spec-value">${board.length_ft}ft</div><div class="spec-label">Longueur</div></div>` : ''}
          <div class="spec-item">
            <div class="spec-value"><span class="condition-badge ${conditionClass}">${board.condition}</span></div>
            <div class="spec-label">État</div>
          </div>
          <div class="spec-item">
            <div class="spec-value">${board.skill_level || 'tous'}</div>
            <div class="spec-label">Niveau</div>
          </div>
        </div>

        ${includes.length > 0 ? `
        <div style="margin-bottom:1.25rem;">
          <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem;">Inclus</div>
          <div class="includes-grid">${includes.map(i => `<span class="include-chip">✓ ${i}</span>`).join('')}</div>
        </div>` : ''}

        ${board.description ? `
        <div style="margin-bottom:1.25rem;">
          <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem;">À propos de cette planche</div>
          <p style="font-size:0.875rem;line-height:1.6;color:rgba(255,255,255,0.75);">${escapeHtml(board.description)}</p>
        </div>` : ''}

        <div style="padding:0.9rem 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:1.25rem;">
          <!-- TRUST BAR: badges row + member since + trust score -->
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.65rem;">
            ${board.host_identity_status === 'verified' ? `<div class="verified-tooltip-wrap" tabindex="0" role="tooltip" aria-label="Hôte vérifié">
              ${identityBadgeHtml('verified', false)}
              <div class="tooltip-box">✓ Identité vérifiée par Swell<br>✓ Stripe configuré (paiements actifs)<br>✓ 3 photos minimum sur l'annonce<br>→ Ce host est fiable et sérieux</div>
            </div>` : ''}
            ${board.host_charges_enabled ? paymentBadgeHtml(true, false) : ''}
            ${board.host_tier ? hostTierBadge(board.host_tier, false) : ''}
            ${board.host_trust_score ? trustScoreBadge(board.host_trust_score, false) : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.7rem;${board.host_best_surf_trip ? 'margin-bottom:0.75rem;' : ''}">
            <div class="avatar avatar-lg">${board.host_avatar ? `<img src="${board.host_avatar}" loading="lazy">` : escapeHtml(board.host_name[0])}</div>
            <div>
              <div style="font-weight:600;font-size:0.9rem;display:flex;align-items:center;gap:0.4rem;">${escapeHtml(board.host_name)}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                Hôte · ${board.host_location || board.location}
              </div>
              <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-top:0.25rem;">
                ${memberSinceBadge(board.host_member_since, true)}
                ${board.host_bio ? `<span style="font-size:0.75rem;color:var(--text-secondary);">${escapeHtml(board.host_bio.slice(0,100))}${board.host_bio.length > 100 ? '…' : ''}</span>` : ''}
              </div>
            </div>
          </div>
          ${board.host_best_surf_trip ? `
          <div style="background:linear-gradient(135deg,rgba(0,102,170,0.06),rgba(255,107,53,0.06));border:1px solid rgba(0,102,170,0.12);border-radius:var(--radius-sm);padding:0.65rem 0.8rem;">
            <div style="font-size:0.68rem;font-weight:700;color:var(--primary);margin-bottom:0.3rem;letter-spacing:0.06em;text-transform:uppercase;">🤙 Trip le plus ouf</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5;">${escapeHtml(board.host_best_surf_trip.slice(0,200))}${board.host_best_surf_trip.length > 200 ? '…' : ''}</div>
          </div>` : ''}
          ${board.host_phone ? (() => {
              const phoneRaw = String(board.host_phone).replace(/\/D/g,'');
              const hostName = escapeHtml(board.host_name || "l'hôte");
              const boardTitle = escapeHtml(board.title || '');
              const msg = "Salut " + hostName + ", je suis interessé(e) par ta planche \"" + boardTitle + "\" sur Swell. Est-ce qu'elle est disponible ?";
              const waUrl = 'https://wa.me/' + phoneRaw + '?text=' + encodeURIComponent(msg);
              return '<a class="whatsapp-cta-btn" href="' + waUrl + '" target="_blank" rel="noopener" data-track="click_whatsapp_host" data-track-board-id="' + board.id + '">&#x1F4AC; Question avant de réserver ?</a>';
            })() : ''}
        </div>

        <!-- BOOKING PANEL — HORARIRE MODEL -->
        <div class="booking-panel">
          <div class="booking-panel-title">Réserver cette planche</div>
          <div id="renter-cal-container" class="cal-wrap"></div>
          <div style="margin-top:0.75rem;">
            <div class="form-group" style="margin-bottom:0.5rem;">
              <label class="form-label">Date de session</label>
              <input type="date" class="form-input" id="booking-start" min="${new Date().toISOString().slice(0,10)}" onchange="onBookingDateChange(${board.id}, ${board.hourly_rate_cents || 'null'}, ${board.daily_price_cents}, ${board.damage_waiver_enabled}, ${board.estimated_value_cents || 0})">
            </div>
          </div>
          <div id="time-picker-section" style="display:none;margin-top:0.75rem;">
            <div class="form-label" style="margin-bottom:0.4rem;">Créneau horaire</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.5rem;">
              <div class="form-group">
                <label class="form-label" style="font-size:0.72rem;">Début</label>
                <select class="form-input" id="booking-start-time" style="padding:0.55rem 0.75rem;font-size:0.9rem;" onchange="onTimeChange(${board.id}, ${board.hourly_rate_cents || 'null'}, ${board.daily_price_cents}, ${board.damage_waiver_enabled}, ${board.estimated_value_cents || 0})">
                  ${[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(h => `<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}h</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size:0.72rem;">Fin</label>
                <select class="form-input" id="booking-end-time" style="padding:0.55rem 0.75rem;font-size:0.9rem;" onchange="onTimeChange(${board.id}, ${board.hourly_rate_cents || 'null'}, ${board.daily_price_cents}, ${board.damage_waiver_enabled}, ${board.estimated_value_cents || 0})">
                  ${[8,9,10,11,12,13,14,15,16,17,18,19,20,21,22].map(h => `<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}h</option>`).join('')}
                </select>
              </div>
            </div>
            <div id="duration-display" style="font-size:0.82rem;font-weight:600;color:var(--primary);margin-bottom:0.3rem;min-height:1.4em;"></div>
          </div>
          <div id="slot-availability" style="font-size:0.78rem;margin-bottom:0.35rem;min-height:1.2em;"></div>
          <div id="slot-pills" style="margin-bottom:0.5rem;"></div>
          ${board.damage_waiver_enabled ? `
          <div style="background:var(--primary-soft);border:1px solid rgba(0,194,224,0.15);border-radius:var(--radius-sm);padding:0.7rem 0.9rem;margin-bottom:0.6rem;">
            <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;">
              <input type="checkbox" id="waiver-checkbox" checked style="margin-top:2px;accent-color:var(--primary);width:14px;height:14px;flex-shrink:0;">
              <div>
                <div style="font-size:0.82rem;font-weight:500;color:var(--text);">Protection dommages · <span style="color:var(--primary);">+€0.50/h</span></div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Couvre les dommages accidentels mineurs pendant ta session</div>
              </div>
            </label>
          </div>` : ''}
          ${board.estimated_value_cents > 0 ? (() => {
            const depCents = Math.min(Math.max(Math.round(board.estimated_value_cents * 0.5), 5000), 50000);
            const depEur = (depCents / 100).toFixed(0);
            return `<div style="background:rgba(255,107,53,0.06);border:1px solid rgba(255,107,53,0.2);border-radius:var(--radius-sm);padding:0.65rem 0.9rem;margin-bottom:0.6rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.45rem;margin-bottom:0.15rem;">
              <div style="display:flex;align-items:center;gap:0.35rem;font-size:0.82rem;font-weight:700;color:var(--sunset);">🔒 Swell Shield</div>
              <div style="font-size:0.78rem;font-weight:700;color:var(--sunset);">€${depEur} caution</div>
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);line-height:1.5;">Bloquée sur ta carte après le paiement — <strong style="color:var(--text-secondary);">non débitée</strong>. Libérée 48h après le retour si tout va bien.</div>
          </div>`;
          })() : ''}
          <div class="form-group">
            <label class="form-label">Message à l'hôte (optionnel)</label>
            <textarea class="form-textarea" id="booking-message" placeholder="Parle-lui de toi et de tes projets de surf..." style="min-height:60px;"></textarea>
          </div>
          <div class="price-breakdown" id="booking-breakdown" style="display:none;">
            <div class="price-row">
              <span id="breakdown-duration-label"></span>
              <span id="breakdown-rental"></span>
            </div>
            <div class="price-row" id="breakdown-waiver-row" style="display:none;">
              <span id="breakdown-waiver-label">Protection dommages</span>
              <span id="breakdown-waiver"></span>
            </div>
            <div class="price-row" style="color:var(--text-muted);font-size:0.8rem;">
              <span>Frais de service (12%)</span>
              <span id="breakdown-fee"></span>
            </div>
            <div class="price-row total">
              <span>Total</span>
              <span id="breakdown-total"></span>
            </div>
            <div class="price-row" id="breakdown-deposit-row" style="display:none;color:var(--sunset);font-size:0.78rem;border-top:1px solid rgba(255,107,53,0.15);padding-top:0.4rem;margin-top:0.2rem;">
              <span>🔒 Caution (bloquée, non débitée)</span>
              <span id="breakdown-deposit"></span>
            </div>
          </div>
          <div id="availability-status" style="font-size:0.75rem;color:var(--text-muted);margin:0.4rem 0;"></div>
          ${board.host_charges_enabled
            ? `<button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:0.6rem;padding:0.75rem;font-size:1rem;" id="book-btn" data-action="showBookingRecap" data-args="%24%7Bboard.id%7D%2C%20%24%7Bboard.hourly_rate_cents%20%7C%7C%20'null'%7D%2C%20%24%7Bboard.daily_price_cents%7D%2C%20%24%7Bboard.damage_waiver_enabled%7D%2C%20'%24%7B(board.title%7C%7C'').replace(%2F'%2Fg%2C'').substring(0%2C60)%7D'%2C%20'%24%7B(board.location%7C%7C'').replace(%2F'%2Fg%2C'').substring(0%2C40)%7D'%2C%20%24%7Bboard.estimated_value_cents%20%7C%7C%200%7D">
              <span id="book-btn-label">Sélectionne une date</span>
            </button>`
            : `<div style="background:rgba(0,0,0,0.04);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.85rem 1rem;text-align:center;margin-top:0.6rem;">
                <div style="font-size:0.85rem;font-weight:600;color:var(--text-muted);">💳 Paiements non disponibles</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">Ce host n'a pas encore configuré ses paiements. Reviens plus tard ou contacte le host via message.</div>
              </div>`
          }
          <div class="stripe-trust-bar">
            <span class="badge-stripe">stripe</span>
            Paiement 100% sécurisé · Remboursement si annulation
          </div>
        </div>

        <!-- REVIEWS -->
        <div style="margin-top:1.5rem;">
          <div class="section-header">
            <div class="section-title">Avis ${board.review_count > 0 ? `(${board.review_count})` : ''}</div>
          </div>
          ${reviewsHtml}
        </div>

        ${related && related.length > 0 ? `
        <div class="related-boards-section">
          <div class="related-boards-header">📍 Autres planches à ${escapeHtml(board.spot_name || board.location)}</div>
          <div class="related-carousel">
            ${related.map(rb => `
              <div class="related-card" data-action="open-RelatedBoard" data-board-id="${rb.id}" data-source-board-id="${board.id}">
                ${rb.photos && rb.photos[0] ? `<img class="related-card-img" src="${rb.photos[0]}" alt="${escapeHtml(rb.title)}" loading="lazy">` : `<div class="related-card-img-placeholder">🏄</div>`}
                <div class="related-card-body">
                  <div class="related-card-title">${escapeHtml(rb.title)}</div>
                  <div class="related-card-price">€${Math.round((rb.hourly_rate_cents || rb.daily_price_cents) / 100)}/h</div>
                  <div class="related-card-spot">${escapeHtml(rb.spot_name || rb.location || '')}</div>
                  ${rb.is_verified_host ? `<div class="related-card-verified">✅ Vérifié</div>` : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <!-- Sticky booking bar — 3-zone mobile CTA fixed to viewport bottom -->
        <div class="detail-sticky-bar" id="detail-sticky-bar" role="region" aria-label="Réservation rapide">
          <!-- Zone 1: price/hour -->
          <div class="sticky-bar-price">
            <div class="sticky-bar-rate" id="sticky-bar-rate" aria-label="Prix par heure">—</div>
            <div class="sticky-bar-min">min 2h</div>
          </div>
          <!-- Zone 2: Swell Shield toggle (hidden when board has no damage_waiver) -->
          <div class="sticky-bar-shield" id="sticky-bar-shield-zone" style="display:none;" aria-label="Protection Swell Shield">
            <div class="sticky-bar-shield-row">
              <span class="sticky-shield-label">🛡 Shield</span>
              <label class="sticky-shield-toggle" aria-label="Activer la protection dommages">
                <input type="checkbox" id="sticky-shield-checkbox" onchange="onStickyShieldChange(this.checked)">
                <span class="sticky-shield-slider"></span>
              </label>
            </div>
            <div class="sticky-shield-price" id="sticky-shield-price">+ €0.50/h</div>
          </div>
          <!-- Zone 3: book button -->
          <div class="sticky-bar-btn">
            <button class="btn btn-primary" id="sticky-book-btn"
              aria-label="Réserver maintenant — aller au widget de réservation"
              style="min-height:44px;padding:0.7rem 1.1rem;font-size:0.9rem;"
              data-action="scrollToBookingPanel" data-board-id="${board.id}">
              Réserver maintenant
            </button>
          </div>
        </div>
      `;

      // Set dates from search
      setTimeout(() => {
        const start = document.getElementById('search-start').value;
        const end = document.getElementById('search-end').value;
        if (start) { document.getElementById('booking-start').value = start; }
        if (end) { document.getElementById('booking-end').value = end; }
        if (start && end) updateBookingTotal(board.id, board.daily_price_cents, board.damage_waiver_enabled, board.estimated_value_cents || 0);
        initStickyBar(board);
      }, 0);

      return '';
    }

    // ==================== STICKY BAR ====================

    // Set up the sticky bar for a board: populate static fields, wire scroll observer, init shield state.
    // Called once per board open, after renderBoardDetail injects the DOM.
    function initStickyBar(board) {
      // Only activate on mobile — desktop stays hidden via CSS
      if (window.matchMedia('(min-width: 769px)').matches) return;

      const bar = document.getElementById('detail-sticky-bar');
      const rateEl = document.getElementById('sticky-bar-rate');
      const shieldZone = document.getElementById('sticky-bar-shield-zone');
      const shieldPriceEl = document.getElementById('sticky-shield-price');
      const shieldCb = document.getElementById('sticky-shield-checkbox');
      if (!bar) return;

      // Zone 1: set the hourly rate
      const hourlyRate = board.hourly_rate_cents || Math.round((board.daily_price_cents || 0) / 8);
      if (rateEl) rateEl.textContent = `${Math.round(hourlyRate / 100)}€/h`;

      // Zone 2: Shield — only show if damage_waiver_enabled
      if (shieldZone) {
        if (board.damage_waiver_enabled) {
          shieldZone.style.display = 'flex';
          if (shieldPriceEl) shieldPriceEl.style.display = 'block';
          // Sync with the main waiver checkbox state
          const mainCb = document.getElementById('waiver-checkbox');
          if (shieldCb) shieldCb.checked = mainCb ? mainCb.checked : true;
        } else {
          shieldZone.style.display = 'none';
        }
      }

      // Show bar once user scrolls past the gallery (first child of detail-body)
      const detailBody = document.getElementById('detail-body');
      const gallery = detailBody ? detailBody.querySelector('.board-detail-gallery, [style*="height:180px"]') : null;
      const bookingPanel = detailBody ? detailBody.querySelector('.booking-panel') : null;

      // Use the modal scroll container for the observer root
      const modalEl = document.querySelector('#detail-modal .modal');

      if (gallery && typeof IntersectionObserver !== 'undefined') {
        const showObs = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) {
              // Gallery scrolled out of view — show sticky bar (unless booking panel visible)
              bar.style.display = 'flex';
            } else {
              // Gallery back in view — hide sticky bar
              bar.style.display = 'none';
            }
          });
        }, { root: modalEl || null, threshold: 0.1 });
        showObs.observe(gallery);

        // Hide sticky bar when booking panel is fully visible (user is interacting with it)
        if (bookingPanel) {
          const hideObs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.intersectionRatio > 0.5) {
                bar.style.display = 'none';
              }
            });
          }, { root: modalEl || null, threshold: 0.5 });
          hideObs.observe(bookingPanel);
        }
      } else {
        // Fallback: show immediately if no IntersectionObserver support
        bar.style.display = 'flex';
      }
    }

    // Scroll the booking panel into view and focus the date input — called by sticky bar CTA.
    function scrollToBookingPanel() {
      const panel = document.querySelector('#detail-body .booking-panel');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
          const dateInput = document.getElementById('booking-start');
          if (dateInput) dateInput.focus();
        }, 400);
      }
    }

    // Sync the sticky Shield toggle with the main waiver checkbox and re-run pricing.
    // Called when the user flips the sticky shield toggle.
    function onStickyShieldChange(checked) {
      const mainCb = document.getElementById('waiver-checkbox');
      if (mainCb) {
        mainCb.checked = checked;
        // Trigger pricing refresh
        mainCb.dispatchEvent(new Event('change'));
      }
      refreshSlotDisplay();
    }

    // Shows pricing for the currently selected date+times — called when date changes or time changes.
    // Works for both pre-filled date (from search) and interactive date input.
    function updateBookingTotal(boardId, dailyPriceCents, damageWaiverEnabled, estimatedValueCents) {
      const startDate = document.getElementById('booking-start')?.value;
      if (!startDate) return;

      // For pre-filled dates: show available slot pills immediately
      const slotPills = document.getElementById('slot-pills');
      const startDateVal = startDate;
      const slots = renterCalState.slotsByDate[startDateVal] || [];
      if (slotPills) {
        if (slots.length > 0) {
          slotPills.innerHTML = `<div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);margin-bottom:0.35rem;">Créneaux disponibles</div>
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">${slots.map(s => {
              const label = s.end - s.start >= 2 ? `${s.start}h–${s.end}h` : '';
              return label ? `<button class="slot-pill" style="font-size:0.72rem;padding:0.25rem 0.5rem;border-radius:6px;border:1px solid var(--green-border);background:var(--green-bg);color:var(--green);font-weight:600;cursor:pointer;" data-action="selectSlotPill" data-args="%24%7Bs.start%7D%2C%20%24%7Bs.end%7D">${label}</button>` : '';
            }).join('')}</div>`;
        } else {
          slotPills.innerHTML = '';
        }
      }

      // Check if times are set — if not, skip pricing breakdown
      const startTimeSel = document.getElementById('booking-start-time');
      const endTimeSel = document.getElementById('booking-end-time');
      if (!startTimeSel?.value || !endTimeSel?.value) return;

      // Delegate to refreshSlotDisplay which has all the pricing logic
      refreshSlotDisplay();
    }

    // When a slot pill is tapped — pre-fill start/end times and show pricing
    function selectSlotPill(startHour, endHour) {
      const startTimeSel = document.getElementById('booking-start-time');
      const endTimeSel = document.getElementById('booking-end-time');
      if (startTimeSel) startTimeSel.value = String(startHour).padStart(2, '0') + ':00';
      if (endTimeSel) endTimeSel.value = String(endHour).padStart(2, '0') + ':00';
      refreshSlotDisplay();
    }

    // Show booking recap modal before redirecting to Stripe
    function showBookingRecap(boardId, hourlyRateCents, dailyPriceCents, damageWaiverEnabled, boardTitle, boardLocation, estimatedValueCents) {
      if (!currentUser) {
        pendingBoardId = boardId;
        closeModal('detail-modal');
        openModal('auth-modal');
        return;
      }

      // KYC gate
      if (userIdentityStatus !== 'verified') {
        pendingAction = 'book';
        openKycModal();
        return;
      }

      const startDate = document.getElementById('booking-start')?.value;
      const startTimeSel = document.getElementById('booking-start-time');
      const endTimeSel = document.getElementById('booking-end-time');
      if (!startDate) { toast('Sélectionne une date', 'error'); return; }
      if (!startTimeSel?.value || !endTimeSel?.value) { toast('Sélectionne les heures de début et fin', 'error'); return; }

      const startTime = startTimeSel.value;
      const endTime = endTimeSel.value;
      const startH = parseInt(startTime.split(':')[0]);
      const endH = parseInt(endTime.split(':')[0]);
      const hours = endH - startH;
      if (hours < 2) { toast('La durée doit être au moins 2h', 'error'); return; }
      if (hours > 16) { toast('Durée maximum 16h', 'error'); return; }

      const hourlyRate = hourlyRateCents || Math.round((dailyPriceCents || 0) / 8);
      const rentalCents = hours * hourlyRate;
      const waiverChecked = damageWaiverEnabled && (document.getElementById('waiver-checkbox')?.checked || false);
      const waiverCents = waiverChecked ? Math.round(hours * 50) : 0;
      const serviceFeeCents = Math.round(rentalCents * 0.12);
      const totalCents = rentalCents + waiverCents + serviceFeeCents;
      const ev = estimatedValueCents || 0;
      const depositCents = ev > 0 ? Math.min(Math.max(Math.round(ev * 0.5), 5000), 50000) : 0;

      const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });

      const recapBody = document.getElementById('recap-body');
      if (recapBody) {
        recapBody.innerHTML = `
          <div style="background:var(--primary-soft);border:1px solid rgba(0,102,170,0.12);border-radius:12px;padding:1rem 1.1rem;margin-bottom:1rem;">
            <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.95rem;margin-bottom:0.15rem;">${boardTitle || 'Planche sélectionnée'}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">📍 ${boardLocation || ''}</div>
          </div>
          <div style="margin-bottom:1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
              <span style="color:var(--text-muted);">📅 Date</span><span style="font-weight:600;">${fmtDate(startDate)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
              <span style="color:var(--text-muted);">🕐 Horaires</span><span style="font-weight:600;">${startTime} → ${endTime}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
              <span style="color:var(--text-muted);">Location</span><span>${hours}h × ${(hourlyRate/100).toFixed(0)}€/h = €${(rentalCents/100).toFixed(2)}</span>
            </div>
            ${waiverCents > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
              <span style="color:var(--text-muted);">Protection dommages</span><span>€0.50 × ${hours}h = €${(waiverCents/100).toFixed(2)}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
              <span style="color:var(--text-muted);">Frais de service (12%)</span><span>€${(serviceFeeCents/100).toFixed(2)}</span>
            </div>
            ${depositCents > 0 ? `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
              <span style="color:var(--sunset);">🔒 Caution bloquée</span><span style="color:var(--sunset);">€${(depositCents/100).toFixed(0)}</span>
            </div>` : ''}
            <div id="recap-total-row" style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0 0;font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;">
              <span>Total</span><span style="color:var(--primary);">€${(totalCents/100).toFixed(2)}</span>
            </div>
          </div>
          ${damageWaiverEnabled ? `
          <div style="background:rgba(0,102,170,0.05);border:1px solid rgba(0,102,170,0.15);border-radius:10px;padding:0.75rem 0.9rem;margin-bottom:0.75rem;">
            <div style="font-size:0.8rem;font-weight:700;color:var(--primary);margin-bottom:0.4rem;">🛡️ Swell Shield — ce qui est couvert</div>
            <div style="display:grid;gap:0.3rem;font-size:0.72rem;color:var(--text-secondary);">
              <div style="display:flex;gap:0.4rem;align-items:flex-start;"><span style="color:var(--green);font-weight:700;">✓</span> Dommage accidentel au leash, ailerons, dérives</div>
              <div style="display:flex;gap:0.4rem;align-items:flex-start;"><span style="color:var(--green);font-weight:700;">✓</span> Fissure de strings / delaminage accidentel</div>
              <div style="display:flex;gap:0.4rem;align-items:flex-start;"><span style="color:var(--green);font-weight:700;">✓</span> Dommage lié au transport ou au stockage</div>
            </div>
            <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.5rem;padding-top:0.4rem;border-top:1px solid rgba(0,102,170,0.1);">✗ Non couvert : usure normale, dommage volontaire, perte</div>
          </div>` : ''}
          ${depositCents > 0 ? `
          <div style="background:rgba(255,107,53,0.06);border:1px solid rgba(255,107,53,0.22);border-radius:10px;padding:0.75rem 0.9rem;margin-bottom:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.82rem;font-weight:700;color:var(--sunset);margin-bottom:0.25rem;">🔒 Caution Swell Shield · €${(depositCents/100).toFixed(0)}</div>
            <div style="font-size:0.72rem;color:var(--text-secondary);line-height:1.5;margin-bottom:0.5rem;">Bloquée sur ta carte après le paiement — <strong>non débitée</strong>. Libérée 48h après le retour si aucun dommage.</div>
            <div style="font-size:0.68rem;color:var(--text-muted);line-height:1.4;">En cas de dommage : inspecter les photos check-in/out → arbitrage Swell → retenue sur caution.</div>
          </div>` : ''}
          ${damageWaiverEnabled && !waiverChecked ? `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:0.7rem 0.85rem;margin-bottom:0.75rem;">
            <div style="font-size:0.8rem;font-weight:700;color:var(--text);margin-bottom:0.35rem;">❌ Protection désactivée</div>
            <div style="font-size:0.72rem;color:var(--text-secondary);line-height:1.5;">Sans Shield, un dommage accidentel peut engager ta caution dans sa totalité. Active la protection pour €${(hours * 50 / 100).toFixed(2)}.</div>
            <button data-action="document.getElementById" data-args="'waiver-checkbox').click(" style="margin-top:0.5rem;font-size:0.72rem;padding:0.3rem 0.7rem;border-radius:6px;border:1px solid rgba(0,102,170,0.3);background:var(--primary-soft);color:var(--primary);cursor:pointer;font-weight:500;">Activer Shield</button>
          </div>` : ''}
          <div style="font-size:0.75rem;color:var(--text-muted);background:var(--surface);border-radius:8px;padding:0.6rem 0.75rem;line-height:1.5;">
            📋 En confirmant, tu acceptes les <strong>conditions Swell</strong> : photos état au check-in/out, annulation 48h avant pour remboursement complet.
          </div>
        `;
      }

      // Store booking params including hourly times and pricing for promo calculation
      window._recapParams = {
        boardId,
        startDate,
        endDate: startDate, // same day for hourly
        startTime,
        endTime,
        damageWaiver: waiverChecked,
        message: document.getElementById('booking-message')?.value || '',
        estimatedValueCents: ev,
        hourlyRateCents,
        dailyPriceCents,
        _totalCents: totalCents
      };
      // Reset promo state each time the recap opens
      _promoState = null;
      const promoInput = document.getElementById('promo-code-input');
      const promoResult = document.getElementById('promo-result');
      const promoBtn = document.getElementById('promo-apply-btn');
      if (promoInput) { promoInput.value = ''; promoInput.style.borderColor = ''; }
      if (promoResult) { promoResult.style.display = 'none'; }
      if (promoBtn) { promoBtn.textContent = 'Appliquer'; promoBtn.disabled = false; promoBtn.style.background = ''; }
      openModal('recap-modal');
    }

    // ==================== PROMO CODE ====================

    // Validated promo state — set by applyPromoCode(), consumed by confirmAndPay()
    let _promoState = null; // null | { code, discountCents, discountPct }

    async function applyPromoCode() {
      const input = document.getElementById('promo-code-input');
      const resultEl = document.getElementById('promo-result');
      const applyBtn = document.getElementById('promo-apply-btn');
      const code = input?.value?.trim().toUpperCase();

      if (!code) {
        resultEl.textContent = 'Saisis un code promo';
        resultEl.style.color = 'var(--red)';
        resultEl.style.display = 'block';
        return;
      }

      // Need rental amount from recap params
      const p = window._recapParams;
      if (!p) return;
      const sh = parseInt((p.startTime || '08:00').split(':')[0]);
      const eh = parseInt((p.endTime || '10:00').split(':')[0]);
      const hours = eh - sh;
      const hourlyRate = p.hourlyRateCents || Math.round((p.dailyPriceCents || 0) / 8);
      const rentalCents = hours * hourlyRate;

      applyBtn.textContent = '...';
      applyBtn.disabled = true;
      resultEl.style.display = 'none';

      try {
        const res = await fetch('/api/promo/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, rentalCents, isHourly: !!(p.startTime && p.endTime) })
        });
        const data = await res.json();

        if (data.valid) {
          _promoState = { code: data.code, discountCents: data.discountCents, discountPct: data.discountPct };
          resultEl.style.color = 'var(--green)';
          resultEl.textContent = data.message;
          resultEl.style.display = 'block';
          input.style.borderColor = 'var(--green)';
          applyBtn.textContent = '✓';
          applyBtn.style.background = 'var(--green)';
          // Update the total display in recap body
          updateRecapWithPromo(data.discountCents);
        } else {
          _promoState = null;
          resultEl.style.color = 'var(--red)';
          resultEl.textContent = data.message || 'Code invalide';
          resultEl.style.display = 'block';
          applyBtn.textContent = 'Appliquer';
          applyBtn.disabled = false;
        }
      } catch (e) {
        _promoState = null;
        resultEl.style.color = 'var(--red)';
        resultEl.textContent = 'Impossible de vérifier le code';
        resultEl.style.display = 'block';
        applyBtn.textContent = 'Appliquer';
        applyBtn.disabled = false;
      }
    }

    // Inject a promo discount line into the recap summary table
    function updateRecapWithPromo(discountCents) {
      const p = window._recapParams;
      if (!p || !p._totalCents) return;
      // Find the total row and update it; also add a promo discount row
      const recapBody = document.getElementById('recap-body');
      if (!recapBody) return;

      const existingPromoRow = recapBody.querySelector('#recap-promo-row');
      if (existingPromoRow) existingPromoRow.remove();

      const existingTotal = recapBody.querySelector('#recap-total-row');
      if (existingTotal) {
        // Insert promo row before total
        const promoRow = document.createElement('div');
        promoRow.id = 'recap-promo-row';
        promoRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;font-size:0.85rem;border-bottom:1px solid var(--border);color:var(--green);font-weight:600;';
        promoRow.innerHTML = `<span>🎁 Code promo (${_promoState?.discountPct}%)</span><span>−€${(discountCents/100).toFixed(2)}</span>`;
        existingTotal.parentNode.insertBefore(promoRow, existingTotal);

        // Update total
        const newTotal = (p._totalCents - discountCents) / 100;
        const totalSpan = existingTotal.querySelector('span:last-child');
        if (totalSpan) totalSpan.textContent = `€${newTotal.toFixed(2)}`;
      }
    }

    async function confirmAndPay() {
      const p = window._recapParams;
      if (!p) return;

      const btn = document.getElementById('recap-confirm-btn');
      btn.textContent = 'Redirection vers Stripe...';
      btn.disabled = true;

      try {
        // Include promo code if one was validated
        const bookingPayload = { ...p };
        if (_promoState?.code) bookingPayload.promoCode = _promoState.code;

        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bookingPayload)
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Erreur lors de la réservation', 'error');
          btn.textContent = 'Confirmer et payer'; btn.disabled = false;
          return;
        }

        if (data.checkoutUrl) {
          closeModal('recap-modal');
          closeModal('detail-modal');
          // Stash deposit info so payment-success page can chain to deposit checkout
          if (data.depositCents > 0 && data.booking) {
            sessionStorage.setItem('swell_pending_deposit', JSON.stringify({
              bookingId: data.booking.id,
              depositCents: data.depositCents
            }));
          }
          const overlay = document.getElementById('stripe-overlay');
          if (overlay) overlay.classList.add('visible');
          setTimeout(() => { window.location.href = data.checkoutUrl; }, 900);
          return;
        }

        // Fallback if Stripe API unavailable
        closeModal('recap-modal');
        closeModal('detail-modal');
        const board = allBoards.find(b => b.id === p.boardId);
        const isHourly = !!(p.startTime && p.endTime);
        const hours = data.hours || (isHourly ? parseInt(p.endTime?.split(':')[0]) - parseInt(p.startTime?.split(':')[0]) : null);
        showBookingConfirmation({
          boardTitle: board ? board.title : 'Board',
          days: null,
          hours,
          startDate: p.startDate,
          startTime: p.startTime,
          endTime: p.endTime,
          rentalEur: (data.rentalCents / 100).toFixed(2),
          waiverEur: data.damageWaiverCents > 0 ? (data.damageWaiverCents / 100).toFixed(2) : null,
          serviceFeeEur: (data.serviceFeeCents / 100).toFixed(2),
          totalEur: (data.totalCents / 100).toFixed(2),
          hostName: board ? board.host_name : 'Host'
        });
      } catch(e) {
        toast('Impossible d\'envoyer la demande de réservation', 'error');
        btn.textContent = 'Confirmer et payer'; btn.disabled = false;
      }
    }

    // ==================== CALENDAR ENGINE ====================
    // Shared utilities used by both renter (read-only) and host (editable) calendars.

    const FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const FR_DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

    function calDayOfWeek(date) {
      // Returns 0=Mon … 6=Sun (ISO week)
      return (date.getDay() + 6) % 7;
    }

    function calDaysInMonth(year, month) {
      return new Date(year, month + 1, 0).getDate();
    }

    function ymd(date) {
      return date.toISOString().slice(0, 10);
    }

    function addDays(dateStr, n) {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + n);
      return ymd(d);
    }

    /**
     * Count available days in the current calendar month.
     * Available = not blocked by host, not booked.
     */
    function countAvailableDays(year, month, blockedSet, bookedSet) {
      const today = ymd(new Date());
      const days = calDaysInMonth(year, month);
      let count = 0;
      for (let d = 1; d <= days; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (dateStr >= today && !blockedSet.has(dateStr) && !bookedSet.has(dateStr)) count++;
      }
      return count;
    }

    // ==================== RENTER CALENDAR ====================

    // State for the renter calendar + hourly booking
    let renterCalState = {
      boardId: null,
      year: null,
      month: null,
      blocked: new Set(),   // host-blocked dates
      booked: new Set(),    // dates from confirmed/pending bookings
      selectStart: null,
      selectEnd: null,
      hourlyRateCents: null,
      dailyPriceCents: 0,
      damageWaiverEnabled: false,
      estimatedValueCents: 0,
      slotsByDate: {}       // date -> available slot ranges
    };

    async function loadAvailability(boardId) {
      const board = allBoards.find(b => b.id === boardId) || {};
      const today = new Date();
      renterCalState = {
        boardId,
        year: today.getFullYear(),
        month: today.getMonth(),
        blocked: new Set(),
        booked: new Set(),
        selectStart: null,
        selectEnd: null,
        hourlyRateCents: board.hourly_rate_cents || null,
        dailyPriceCents: board.daily_price_cents || 0,
        damageWaiverEnabled: board.damage_waiver_enabled || false,
        estimatedValueCents: board.estimated_value_cents || 0,
        slotsByDate: {}
      };

      const bookingPanel = document.querySelector('.booking-panel');
      if (!bookingPanel) return;

      // Ensure the calendar container exists (it's now in the HTML directly)
      const calContainer = document.getElementById('renter-cal-container');
      if (calContainer) {
        calContainer.innerHTML = `<div class="cal-loading">⏳ Chargement...</div>`;
      }

      // Hide the old date-range div (replaced by cal container + date input)
      const dateRangeDiv = bookingPanel.querySelector('.date-range');
      if (dateRangeDiv) dateRangeDiv.style.display = 'none';

      try {
        const from = ymd(today);
        const toDate = new Date(today); toDate.setDate(toDate.getDate() + 62);
        const to = ymd(toDate);
        const [availRes, bookedRes, slotsRes] = await Promise.all([
          fetch(`/api/availability/${boardId}?from=${from}&to=${to}`),
          fetch(`/api/bookings/availability/${boardId}`),
          fetch(`/api/availability/${boardId}/slots-by-date?from=${from}&to=${to}`)
        ]);
        const availData = await availRes.json();
        const bookedData = await bookedRes.json();
        const slotsData = await slotsRes.json();

        const bookedSet = new Set();
        for (const range of (bookedData.bookedDates || [])) {
          let cur = new Date(range.start_date + 'T00:00:00');
          const end = new Date(range.end_date + 'T00:00:00');
          while (cur < end) {
            bookedSet.add(ymd(cur));
            cur.setDate(cur.getDate() + 1);
          }
        }

        renterCalState.blocked = new Set(availData.blockedDates || []);
        renterCalState.booked = bookedSet;
        renterCalState.slotsByDate = slotsData.slotsByDate || {};
      } catch (_) {
        // Non-fatal — calendar renders, slots empty
      }

      renderRenterCal();
    }

    // Called when renter picks a date — shows time picker + slot availability
    async function onBookingDateChange(boardId, hourlyRateCents, dailyPriceCents, damageWaiverEnabled, estimatedValueCents) {
      const startEl = document.getElementById('booking-start');
      const timeSection = document.getElementById('time-picker-section');
      const slotAvail = document.getElementById('slot-availability');
      const breakdown = document.getElementById('booking-breakdown');
      const btn = document.getElementById('book-btn');
      const btnLabel = document.getElementById('book-btn-label');
      const endTimeSel = document.getElementById('booking-end-time');

      if (!startEl?.value) {
        if (timeSection) timeSection.style.display = 'none';
        if (slotAvail) slotAvail.textContent = '';
        if (breakdown) breakdown.style.display = 'none';
        if (btnLabel) btnLabel.textContent = 'Sélectionne une date';
        return;
      }

      renterCalState.selectStart = startEl.value;
      if (timeSection) timeSection.style.display = 'block';

      // Show slot availability + auto-select first available slot (zero-friction)
      const slots = renterCalState.slotsByDate[startEl.value] || [];
      const startTimeSel = document.getElementById('booking-start-time');
      const endTimeSel2 = document.getElementById('booking-end-time');
      if (slots.length > 0 && startTimeSel && endTimeSel2) {
        const first = slots[0];
        startTimeSel.value = String(first.start).padStart(2, '0') + ':00';
        endTimeSel2.value = String(first.end).padStart(2, '0') + ':00';
      }
      // Show availability message
      if (slotAvail) {
        slotAvail.textContent = '';
      }
      if (btnLabel) btnLabel.textContent = 'Réserver et payer';
    }

    async function onTimeChange(boardId, hourlyRateCents, dailyPriceCents, damageWaiverEnabled, estimatedValueCents) {
      await refreshSlotDisplay();
    }

    async function refreshSlotDisplay() {
      const startDate = document.getElementById('booking-start')?.value;
      const startTimeSel = document.getElementById('booking-start-time');
      const endTimeSel = document.getElementById('booking-end-time');
      const durationEl = document.getElementById('duration-display');
      const slotAvail = document.getElementById('slot-availability');
      const breakdown = document.getElementById('booking-breakdown');
      const btn = document.getElementById('book-btn');
      const btnLabel = document.getElementById('book-btn-label');

      if (!startDate || !startTimeSel?.value || !endTimeSel?.value) {
        if (durationEl) durationEl.textContent = '';
        if (breakdown) breakdown.style.display = 'none';
        // Do NOT hide sticky bar — IntersectionObserver controls visibility.
        // Reset rate display to base hourly price.
        const stickyRateReset = document.getElementById('sticky-bar-rate');
        if (stickyRateReset && renterCalState.hourlyRateCents) {
          stickyRateReset.textContent = `${Math.round(renterCalState.hourlyRateCents / 100)}€/h`;
        }
        return;
      }

      const startH = parseInt(startTimeSel.value.split(':')[0]);
      const endH = parseInt(endTimeSel.value.split(':')[0]);
      const hours = endH - startH;

      if (hours < 2) {
        if (durationEl) durationEl.innerHTML = `<span style="color:var(--red);">Minimum 2h — sélectionne un créneau plus long</span>`;
        if (breakdown) breakdown.style.display = 'none';
        if (btnLabel) btnLabel.textContent = 'Durée minimum 2h';
        // Do NOT hide sticky bar — keep rate display with error hint
        return;
      }

      if (hours > 16) {
        if (durationEl) durationEl.innerHTML = `<span style="color:var(--red);">Maximum 16h par réservation</span>`;
        if (breakdown) breakdown.style.display = 'none';
        // Do NOT hide sticky bar
        return;
      }

      const { boardId, hourlyRateCents: hr, dailyPriceCents: dp, damageWaiverEnabled: dw, estimatedValueCents: ev } = renterCalState;
      const hourlyRate = hr || Math.round(dp / 8);
      const rentalCents = hours * hourlyRate;
      const waiverChecked = dw && (document.getElementById('waiver-checkbox')?.checked || false);
      const waiverCents = waiverChecked ? Math.round(hours * 50) : 0;
      const serviceFeeCents = Math.round(rentalCents * 0.12);
      const totalCents = rentalCents + waiverCents + serviceFeeCents;
      const evVal = ev || estimatedValueCents || 0;
      const depositCents = evVal > 0 ? Math.min(Math.max(Math.round(evVal * 0.5), 5000), 50000) : 0;

      if (durationEl) {
        durationEl.innerHTML = `<span style="color:var(--green);">✓ ${hours}h · ${(hourlyRate/100).toFixed(0)}€/h</span>`;
      }

      // Show slot availability for this date
      if (slotAvail && renterCalState.slotsByDate[startDate]) {
        const slots = renterCalState.slotsByDate[startDate];
        const allSlots = buildAllSlots();
        const selected = { start: startH, end: endH };
        const conflict = allSlots.some(s => s.start < selected.end && s.end > selected.start);
        if (conflict) {
          slotAvail.innerHTML = `<span style="color:var(--red);">⚠ Ce créneau est déjà réservé ou bloqué</span>`;
        } else {
          const slotDescriptions = slots.map(s => `${s.start}h–${s.end}h`).join(', ');
          slotAvail.innerHTML = `<span style="color:var(--green);">✓ Dispo · autres créneaux: ${slotDescriptions}</span>`;
        }
      }

      // Sticky bar: don't override visibility — IntersectionObserver controls show/hide.
      // Just ensure the bar has display:flex if it was hidden by a previous "no-date" state
      // and we're on mobile. The IntersectionObserver will have already set display:flex by now.
      const stickyBar = document.getElementById('detail-sticky-bar');
      if (stickyBar && !window.matchMedia('(min-width: 769px)').matches) {
        if (stickyBar.style.display !== 'flex') stickyBar.style.display = 'flex';
      }

      // Update breakdown
      if (breakdown) {
        breakdown.style.display = 'block';
        document.getElementById('breakdown-duration-label').textContent = `${hours}h × ${(hourlyRate/100).toFixed(0)}€/h`;
        document.getElementById('breakdown-rental').textContent = `€${(rentalCents/100).toFixed(2)}`;

        const waiverRow = document.getElementById('breakdown-waiver-row');
        if (waiverRow) {
          if (waiverChecked) {
            waiverRow.style.display = 'flex';
            document.getElementById('breakdown-waiver-label').textContent = `Protection dommages (€0.50 × ${hours}h)`;
            document.getElementById('breakdown-waiver').textContent = `€${(waiverCents/100).toFixed(2)}`;
          } else {
            waiverRow.style.display = 'none';
          }
        }
        const feeEl = document.getElementById('breakdown-fee');
        if (feeEl) feeEl.textContent = `€${(serviceFeeCents/100).toFixed(2)}`;
        document.getElementById('breakdown-total').textContent = `€${(totalCents/100).toFixed(2)}`;

        const depositRow = document.getElementById('breakdown-deposit-row');
        if (depositRow) {
          if (depositCents > 0) {
            depositRow.style.display = 'flex';
            const depEl = document.getElementById('breakdown-deposit');
            if (depEl) depEl.textContent = `€${(depositCents/100).toFixed(0)} (bloqué)`;
          } else {
            depositRow.style.display = 'none';
          }
        }
      }

      if (btnLabel) btnLabel.textContent = `Réserver — ${hours}h`;

      // Sync sticky bar Zone 1: show total in rate slot when session is priced
      const stickyRateEl = document.getElementById('sticky-bar-rate');
      if (stickyRateEl) stickyRateEl.textContent = `€${(totalCents/100).toFixed(2)} · ${hours}h`;

      // Sync sticky bar Zone 2: keep shield toggle in sync with waiver checkbox
      const stickyShieldCb = document.getElementById('sticky-shield-checkbox');
      const mainWaiverCb = document.getElementById('waiver-checkbox');
      if (stickyShieldCb && mainWaiverCb) stickyShieldCb.checked = mainWaiverCb.checked;
    }

    function buildAllSlots() {
      const startDate = document.getElementById('booking-start')?.value;
      if (!startDate) return [];
      const slots = renterCalState.slotsByDate[startDate] || [];
      // Combine booked slots (8-22 operating hours minus available slots)
      const occupied = [];
      for (let h = 6; h < 22; h++) {
        let free = false;
        for (const s of slots) {
          if (h >= s.start && h < s.end) { free = true; break; }
        }
        if (!free) {
          // Find the next occupied end
          let end = h + 1;
          for (const s of slots) {
            if (s.start <= h && s.end > end) end = s.end;
          }
          occupied.push({ start: h, end });
        }
      }
      return occupied.filter((s, i, arr) => s.start !== arr[i-1]?.end || s.end !== arr[i-1]?.end);
    }

    function allSlotsDisplay() {
      const startDate = document.getElementById('booking-start')?.value;
      if (!startDate) return '';
      const slots = renterCalState.slotsByDate[startDate] || [];
      if (slots.length === 0) return '';
      return slots.map(s => `${s.start}h–${s.end}h`).join(' · ');
    }

    function renderRenterCal() {
      const { year, month, blocked, booked, selectStart, selectEnd } = renterCalState;
      const container = document.getElementById('renter-cal-container');
      if (!container) return;

      const today = ymd(new Date());
      const daysInMonth = calDaysInMonth(year, month);
      const firstDow = calDayOfWeek(new Date(year, month, 1));
      const availCount = countAvailableDays(year, month, blocked, booked);
      const monthLabel = `${FR_MONTHS[month]} ${year}`;

      // Build day cells
      let dayCells = '';
      for (let i = 0; i < firstDow; i++) dayCells += `<div class="cal-day cal-day-empty"></div>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const isBlocked = blocked.has(dateStr);
        const isBooked = booked.has(dateStr);
        const isStart = dateStr === selectStart;
        const isEnd = dateStr === selectEnd;
        const inRange = selectStart && selectEnd && dateStr > selectStart && dateStr < selectEnd;

        let cls = 'cal-day';
        let title = '';
        if (isPast) { cls += ' cal-day-past'; }
        else if (isBooked) { cls += ' cal-day-booked'; title = 'Déjà réservé'; }
        else if (isBlocked) { cls += ' cal-day-blocked'; title = 'Non disponible'; }
        else if (isStart) { cls += ' cal-day-selected-start'; title = 'Début'; }
        else if (isEnd) { cls += ' cal-day-selected-end'; title = 'Fin'; }
        else if (inRange) { cls += ' cal-day-selected-range'; }
        if (isToday) cls += ' cal-day-today';

        const clickable = !isPast && !isBooked && !isBlocked;
        const onclick = clickable ? `data-action="renterCalDayClick" data-arg="${dateStr}"` : '';
        dayCells += `<div class="${cls}" ${title ? `title="${title}"` : ''} ${onclick}>${d}</div>`;
      }

      const canGoPrev = !(year === new Date().getFullYear() && month === new Date().getMonth());

      container.innerHTML = `
        <div class="cal-section-title" style="display:flex;align-items:center;gap:0.5rem;">
          Disponibilités
          ${availCount > 0 ? `<span class="cal-avail-count">${availCount} jour${availCount > 1 ? 's' : ''} dispo ce mois</span>` : ''}
        </div>
        <div class="cal-header">
          <button class="cal-nav" data-action="renterCalNav" data-arg="-1" ${!canGoPrev ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>‹</button>
          <span class="cal-month-label">${monthLabel}</span>
          <button class="cal-nav" data-action="renterCalNav" data-arg="1">›</button>
        </div>
        <div class="cal-grid">
          ${FR_DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${dayCells}
        </div>
        <div class="cal-legend">
          <div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--primary);"></div>Sélectionné</div>
          <div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--red-bg);border:1px solid var(--red-border);"></div>Indisponible</div>
          ${booked.size > 0 ? `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:rgba(0,0,0,0.08);"></div>Réservé</div>` : ''}
        </div>
        ${selectStart ? `<div style="margin-top:0.6rem;font-size:0.8rem;color:var(--text-secondary);">
          Du <strong>${formatDateFr(selectStart)}</strong>${selectEnd ? ` au <strong>${formatDateFr(selectEnd)}</strong>` : ' — sélectionne la date de fin'}
        </div>` : `<div style="margin-top:0.6rem;font-size:0.78rem;color:var(--text-muted);">Tap pour sélectionner ta date de début</div>`}
      `;
    }

    function renterCalNav(dir) {
      let { year, month } = renterCalState;
      month += dir;
      if (month < 0) { month = 11; year--; }
      if (month > 11) { month = 0; year++; }
      // Don't navigate before current month
      const now = new Date();
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) return;
      renterCalState.year = year;
      renterCalState.month = month;
      renderRenterCal();
    }

    function renterCalDayClick(dateStr) {
      const { blocked, booked, selectStart, selectEnd } = renterCalState;
      if (blocked.has(dateStr) || booked.has(dateStr)) return;

      if (!selectStart || (selectStart && selectEnd)) {
        // Start fresh selection
        renterCalState.selectStart = dateStr;
        renterCalState.selectEnd = null;
      } else {
        // Second tap — set end
        if (dateStr <= selectStart) {
          // Swap: treat as new start
          renterCalState.selectStart = dateStr;
          renterCalState.selectEnd = null;
        } else {
          // Validate: no blocked/booked day in the range
          const rangeValid = rangeHasNoConflict(selectStart, dateStr, blocked, booked);
          if (!rangeValid) {
            toast('Cette board n\'est pas disponible sur ces dates — il y a un jour bloqué dans ta sélection', 'error');
            renterCalState.selectStart = null;
            renterCalState.selectEnd = null;
            renderRenterCal();
            return;
          }
          renterCalState.selectEnd = dateStr;
          // Drive the hidden inputs and update price breakdown
          syncRenterCalToInputs();
        }
      }
      renderRenterCal();
    }

    function rangeHasNoConflict(startDate, endDate, blocked, booked) {
      let cur = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      while (cur < end) {
        const ds = ymd(cur);
        if (blocked.has(ds) || booked.has(ds)) return false;
        cur.setDate(cur.getDate() + 1);
      }
      return true;
    }

    function syncRenterCalToInputs() {
      const { selectStart, selectEnd, boardId, dailyPriceCents, damageWaiverEnabled } = renterCalState;
      if (!selectStart || !selectEnd) return;

      // Update the hidden date inputs so requestBooking() can read them
      const startEl = document.getElementById('booking-start');
      const endEl = document.getElementById('booking-end');
      if (startEl) startEl.value = selectStart;
      if (endEl) endEl.value = selectEnd;

      // Update price breakdown
      updateBookingTotal(boardId, dailyPriceCents, damageWaiverEnabled);
    }

    function formatDateFr(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }

    // ==================== HOST CALENDAR ====================

    let hostCalState = {
      boardId: null,
      year: null,
      month: null,
      blocked: new Set(),
      booked: new Set(),
      rangeStart: null,  // for range-select mode
      loaded: false
    };

    async function openHostCalendar(boardId, containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const today = new Date();
      hostCalState = {
        boardId,
        year: today.getFullYear(),
        month: today.getMonth(),
        blocked: new Set(),
        booked: new Set(),
        rangeStart: null,
        loaded: false
      };

      container.innerHTML = `<div class="cal-loading">⏳ Chargement...</div>`;

      try {
        const from = ymd(today);
        const toDate = new Date(today); toDate.setDate(toDate.getDate() + 62);
        const to = ymd(toDate);
        const [availRes, bookedRes] = await Promise.all([
          fetch(`/api/availability/${boardId}?from=${from}&to=${to}`),
          fetch(`/api/bookings/availability/${boardId}`)
        ]);
        const availData = await availRes.json();
        const bookedData = await bookedRes.json();

        const bookedSet = new Set();
        for (const range of (bookedData.bookedDates || [])) {
          let cur = new Date(range.start_date + 'T00:00:00');
          const end = new Date(range.end_date + 'T00:00:00');
          while (cur < end) {
            bookedSet.add(ymd(cur));
            cur.setDate(cur.getDate() + 1);
          }
        }

        hostCalState.blocked = new Set(availData.blockedDates || []);
        hostCalState.booked = bookedSet;
        hostCalState.loaded = true;
      } catch (_) {
        container.innerHTML = `<div style="color:var(--red);font-size:0.8rem;">Impossible de charger le calendrier</div>`;
        return;
      }

      renderHostCal(containerId);
    }

    function renderHostCal(containerId) {
      const { year, month, blocked, booked, boardId, rangeStart } = hostCalState;
      const container = document.getElementById(containerId);
      if (!container) return;

      const today = ymd(new Date());
      const daysInMonth = calDaysInMonth(year, month);
      const firstDow = calDayOfWeek(new Date(year, month, 1));
      const availCount = countAvailableDays(year, month, blocked, booked);
      const monthLabel = `${FR_MONTHS[month]} ${year}`;
      const canGoPrev = !(year === new Date().getFullYear() && month === new Date().getMonth());

      let dayCells = '';
      for (let i = 0; i < firstDow; i++) dayCells += `<div class="cal-day cal-day-empty"></div>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const isBlocked = blocked.has(dateStr);
        const isBooked = booked.has(dateStr);
        const isRangeStart = dateStr === rangeStart;

        let cls = 'cal-day';
        let label = String(d);
        let title = '';
        if (isPast) { cls += ' cal-day-past'; }
        else if (isBooked) { cls += ' cal-day-booked'; title = 'Réservé'; }
        else if (isBlocked) { cls += ' cal-day-blocked'; title = 'Bloqué — tap pour débloquer'; }
        else { title = 'Tap pour bloquer'; }
        if (isRangeStart) { cls += ' cal-day-selected-start'; }
        if (isToday) cls += ' cal-day-today';

        const clickable = !isPast && !isBooked;
        const onclick = clickable ? `data-action="hostCalDayClick" data-arg="${dateStr}" data-container="${containerId}"` : '';
        dayCells += `<div class="${cls}" ${title ? `title="${title}"` : ''} ${onclick}>${label}</div>`;
      }

      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
          <span style="font-size:0.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Calendrier de dispo</span>
          ${availCount > 0 ? `<span class="cal-avail-count">${availCount}j dispo</span>` : ''}
        </div>
        <div class="cal-header">
          <button class="cal-nav" data-action="hostCalNav" data-args="-1%2C%20'%24%7BcontainerId%7D'" ${!canGoPrev ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>‹</button>
          <span class="cal-month-label">${monthLabel}</span>
          <button class="cal-nav" data-action="hostCalNav" data-args="1%2C%20'%24%7BcontainerId%7D'">›</button>
        </div>
        <div class="cal-grid">
          ${FR_DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${dayCells}
        </div>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
          <div class="cal-legend">
            <div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--green-bg);border:1px solid var(--green-border);"></div>Dispo</div>
            <div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--red-bg);border:1px solid var(--red-border);"></div>Bloqué</div>
            ${booked.size > 0 ? `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:rgba(0,0,0,0.08);"></div>Réservé</div>` : ''}
          </div>
        </div>
        ${rangeStart ? `
        <div style="margin-top:0.5rem;font-size:0.78rem;color:var(--primary);background:var(--primary-soft);border-radius:8px;padding:0.4rem 0.6rem;">
          📅 Sélection de plage : depuis <strong>${formatDateFr(rangeStart)}</strong> — tap la date de fin pour bloquer toute la période
          <button data-action="hostCalCancelRange" data-arg="${containerId}" style="float:right;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.9rem;">✕</button>
        </div>` : `
        <div style="margin-top:0.4rem;font-size:0.7rem;color:var(--text-muted);">
          Tap = bloquer/débloquer un jour · Tap 2 jours = bloquer une période
        </div>`}
      `;
    }

    function hostCalNav(dir, containerId) {
      let { year, month } = hostCalState;
      month += dir;
      if (month < 0) { month = 11; year--; }
      if (month > 11) { month = 0; year++; }
      const now = new Date();
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) return;
      hostCalState.year = year;
      hostCalState.month = month;

      // Fetch new month if we haven't loaded it yet
      loadHostCalMonth(containerId, year, month);
    }

    async function loadHostCalMonth(containerId, year, month) {
      const { boardId } = hostCalState;
      const from = `${year}-${String(month+1).padStart(2,'0')}-01`;
      const lastDay = calDaysInMonth(year, month);
      const to = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      try {
        const res = await fetch(`/api/availability/${boardId}?from=${from}&to=${to}`);
        const data = await res.json();
        // Merge new blocked dates into the set
        for (const d of (data.blockedDates || [])) hostCalState.blocked.add(d);
        // Also remove dates in this month that are no longer blocked
        for (let d = 1; d <= lastDay; d++) {
          const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          if (!data.blockedDates.includes(dateStr)) hostCalState.blocked.delete(dateStr);
        }
      } catch (_) { /* render anyway */ }
      renderHostCal(containerId);
    }

    async function hostCalDayClick(dateStr, containerId) {
      const { boardId, blocked, booked, rangeStart } = hostCalState;

      if (!rangeStart) {
        // First tap — if no range in progress, toggle immediately
        hostCalState.rangeStart = dateStr;

        // Immediately toggle (single tap = single day block/unblock)
        // We use a small delay: if user taps a second day within 600ms it becomes a range
        hostCalState._pendingToggleTimer = setTimeout(async () => {
          hostCalState.rangeStart = null;
          await hostCalToggleDay(boardId, dateStr, containerId);
        }, 450);
      } else {
        // Second tap — cancel pending single-day toggle and do range
        clearTimeout(hostCalState._pendingToggleTimer);
        const start = rangeStart;
        const end = dateStr;
        hostCalState.rangeStart = null;

        if (start === end) {
          // Same day — just toggle
          await hostCalToggleDay(boardId, start, containerId);
          return;
        }

        const [fromDate, toDate] = start < end ? [start, end] : [end, start];
        // endDate is exclusive for blockDateRange, so add 1 day
        const exclusiveEnd = addDays(toDate, 1);

        // Determine action: if any day in range is available → block all; else unblock all
        const anyAvailable = (() => {
          let cur = new Date(fromDate + 'T00:00:00');
          const endDt = new Date(toDate + 'T00:00:00');
          while (cur <= endDt) {
            if (!blocked.has(ymd(cur))) return true;
            cur.setDate(cur.getDate() + 1);
          }
          return false;
        })();

        try {
          const endpoint = anyAvailable ? 'block-range' : 'unblock-range';
          const res = await fetch(`/api/availability/${boardId}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startDate: fromDate, endDate: exclusiveEnd })
          });
          if (!res.ok) throw new Error();

          // Update local state
          let cur = new Date(fromDate + 'T00:00:00');
          const endDt = new Date(toDate + 'T00:00:00');
          while (cur <= endDt) {
            const ds = ymd(cur);
            if (anyAvailable) blocked.add(ds);
            else blocked.delete(ds);
            cur.setDate(cur.getDate() + 1);
          }
          const days = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;
          toast(`${anyAvailable ? '🔒 ' + days + ' jour' + (days>1?'s':'') + ' bloqués' : '✅ Période débloquée'}`, anyAvailable ? 'info' : 'success');
        } catch (_) {
          toast('Impossible de mettre à jour la disponibilité', 'error');
        }
        renderHostCal(containerId);
      }
    }

    function hostCalCancelRange(containerId) {
      clearTimeout(hostCalState._pendingToggleTimer);
      hostCalState.rangeStart = null;
      renderHostCal(containerId);
    }

    async function hostCalToggleDay(boardId, dateStr, containerId) {
      const { blocked } = hostCalState;
      try {
        const res = await fetch(`/api/availability/${boardId}/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateStr })
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.blocked) {
          blocked.add(dateStr);
          toast('🔒 Jour bloqué', 'info');
        } else {
          blocked.delete(dateStr);
          toast('✅ Jour disponible', 'success');
        }
      } catch (_) {
        toast('Impossible de mettre à jour', 'error');
      }
      renderHostCal(containerId);
    }

    async function requestBooking(boardId, damageWaiverEnabled) {
      if (!currentUser) {
        pendingBoardId = boardId;
        closeModal('detail-modal');
        openModal('auth-modal');
        return;
      }

      // KYC gate: require verified identity before first booking
      if (userIdentityStatus !== 'verified') {
        pendingAction = 'book';
        openKycModal();
        return;
      }

      const start = document.getElementById('booking-start')?.value;
      const end = document.getElementById('booking-end')?.value;
      const message = document.getElementById('booking-message')?.value;
      const damageWaiver = damageWaiverEnabled && (document.getElementById('waiver-checkbox')?.checked || false);

      if (!start || !end) { toast('Veuillez sélectionner les dates de location', 'error'); return; }

      const btn = document.getElementById('book-btn');
      btn.textContent = 'Réservation en cours...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boardId, startDate: start, endDate: end, message, damageWaiver })
        });
        const data = await res.json();
        if (!res.ok) { toast(data.error, 'error'); btn.textContent = 'Réserver et payer'; btn.disabled = false; return; }

        // If Stripe checkout URL returned, redirect to payment
        // The success page will then trigger deposit checkout if depositCents > 0
        if (data.checkoutUrl) {
          closeModal('detail-modal');
          // Stash deposit info so the success page can chain to deposit checkout
          if (data.depositCents > 0) {
            sessionStorage.setItem('swell_pending_deposit', JSON.stringify({
              bookingId: data.booking.id,
              depositCents: data.depositCents
            }));
          }
          // Show premium Stripe redirect overlay
          const overlay = document.getElementById('stripe-overlay');
          if (overlay) overlay.classList.add('visible');
          setTimeout(() => { window.location.href = data.checkoutUrl; }, 900);
          return;
        }

        // Fallback: show confirmation without payment (API unavailable)
        closeModal('detail-modal');
        const days = data.days || Math.ceil((new Date(end) - new Date(start)) / 86400000);
        const total = (data.totalCents / 100).toFixed(0);
        const board = allBoards.find(b => b.id === boardId);
        const boardTitle = board ? board.title : 'Board';
        const rentalEur = (data.rentalCents / 100).toFixed(0);
        const waiverEur = data.damageWaiverCents > 0 ? (data.damageWaiverCents / 100).toFixed(0) : null;

        showBookingConfirmation({
          boardTitle,
          days,
          startDate: start,
          endDate: end,
          rentalEur,
          waiverEur,
          totalEur: total,
          hostName: board ? board.host_name : 'Host'
        });

      } catch(e) {
        toast('Impossible d\'envoyer la demande de réservation', 'error');
        btn.textContent = 'Réserver et payer'; btn.disabled = false;
      }
    }

    function showBookingConfirmation(info) {
      const body = document.getElementById('confirm-body');
      const isHourly = info.hours != null;
      const dateStr = new Date(info.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      const durationStr = isHourly
        ? `${info.hours}h (${info.startTime}–${info.endTime})`
        : `${info.days} jour${(info.days || 0) > 1 ? 's' : ''}`;
      body.innerHTML = `
        <div class="confirm-content">
          <div class="confirm-check">🏄</div>
          <div class="confirm-title">Demande envoyée !</div>
          <div class="confirm-sub">${escapeHtml(info.hostName || '')} s'occupe de tout. Prépare ton wetsuit !</div>
          <div class="confirm-details">
            <div class="confirm-row"><span class="label">Planche</span><span>${escapeHtml(info.boardTitle || '')}</span></div>
            <div class="confirm-row"><span class="label">Date</span><span>${dateStr}${isHourly ? ` · ${info.startTime}–${info.endTime}` : ''}</span></div>
            <div class="confirm-row"><span class="label">Durée</span><span>${durationStr}</span></div>
            <div class="confirm-row"><span class="label">Location</span><span>€${info.rentalEur}</span></div>
            ${info.waiverEur ? `<div class="confirm-row"><span class="label">Protection dommages</span><span>€${info.waiverEur}</span></div>` : ''}
            <div class="confirm-row" style="font-weight:700;color:var(--text);border-top:1px solid var(--border);padding-top:0.5rem;margin-top:0.3rem;">
              <span>Total</span><span>€${info.totalEur}</span>
            </div>
          </div>
          <div class="confirm-actions">
            <button class="btn btn-primary" data-action="closeModal" data-args="'confirm-modal')%3B%20openModal('profile-modal')%3B%20switchProfileTab('messages'%2C%20null">Envoyer un message</button>
            <button class="btn btn-outline" data-action="closeModal" data-args="'confirm-modal')%3B%20openModal('profile-modal')%3B%20loadProfileTab('bookings'">Voir mes voyages</button>
          </div>
        </div>
      `;
      openModal('confirm-modal');
    }

    // ==================== IDENTITY VERIFICATION (KYC) ====================
    // kycFileFront / kycFileBack hold the actual File objects for two-sided upload
    let kycFileFront = null;
    let kycFileBack = null;

    function setKycProgress(step) {
      // step 1, 2, or 3
      const dots = [
        document.getElementById('kyc-dot-1'),
        document.getElementById('kyc-dot-2'),
        document.getElementById('kyc-dot-3')
      ];
      dots.forEach((dot, i) => {
        dot.style.background = i < step ? 'var(--primary)' : 'var(--border)';
      });
    }

    function showKycStep(stepId) {
      const all = ['kyc-step-front','kyc-step-back','kyc-step-review',
                   'kyc-step-submitting','kyc-step-pending','kyc-step-rejected'];
      all.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const show = document.getElementById(stepId);
      if (show) show.style.display = 'block';
    }

    function resetKycDrop(dropId, previewId, placeholderId, nextBtnId) {
      const drop = document.getElementById(dropId);
      if (drop) { drop.style.borderColor = 'var(--border)'; drop.style.background = 'var(--surface)'; }
      const preview = document.getElementById(previewId);
      if (preview) preview.style.display = 'none';
      const placeholder = document.getElementById(placeholderId);
      if (placeholder) placeholder.style.display = 'block';
      const btn = document.getElementById(nextBtnId);
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    }

    function resetKycFront() {
      document.getElementById('kyc-front-input').value = '';
      resetKycDrop('kyc-drop-front', 'kyc-front-preview', 'kyc-front-placeholder', 'kyc-next-front-btn');
      const err = document.getElementById('kyc-error-front');
      if (err) err.style.display = 'none';
    }

    function resetKycBack() {
      document.getElementById('kyc-back-input').value = '';
      resetKycDrop('kyc-drop-back', 'kyc-back-preview', 'kyc-back-placeholder', 'kyc-next-back-btn');
      const err = document.getElementById('kyc-error-back');
      if (err) err.style.display = 'none';
    }

    function previewImage(file, imgEl, placeholderEl, dropEl) {
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        imgEl.src = e.target.result;
        imgEl.style.display = 'block';
        if (placeholderEl) placeholderEl.style.display = 'none';
        dropEl.style.borderColor = 'var(--primary)';
        dropEl.style.background = 'rgba(0,194,224,0.06)';
      };
      reader.readAsDataURL(file);
    }

    function kycHandleFileFront(input) {
      const file = input.files[0];
      if (!file) return;
      const err = document.getElementById('kyc-error-front');
      err.style.display = 'none';
      if (file.size > 10 * 1024 * 1024) {
        err.textContent = 'Fichier trop volumineux — max 10 Mo.'; err.style.display = 'block'; return;
      }
      if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
        err.textContent = 'Format non reconnu — utilisez JPG, PNG ou WEBP.'; err.style.display = 'block'; return;
      }
      kycFileFront = file;
      previewImage(file,
        document.getElementById('kyc-front-img'),
        document.getElementById('kyc-front-placeholder'),
        document.getElementById('kyc-drop-front'));
      const btn = document.getElementById('kyc-next-front-btn');
      btn.disabled = false; btn.style.opacity = '1';
    }

    function kycHandleFileBack(input) {
      const file = input.files[0];
      if (!file) return;
      const err = document.getElementById('kyc-error-back');
      err.style.display = 'none';
      if (file.size > 10 * 1024 * 1024) {
        err.textContent = 'Fichier trop volumineux — max 10 Mo.'; err.style.display = 'block'; return;
      }
      if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
        err.textContent = 'Format non reconnu — utilisez JPG, PNG ou WEBP.'; err.style.display = 'block'; return;
      }
      kycFileBack = file;
      previewImage(file,
        document.getElementById('kyc-back-img'),
        document.getElementById('kyc-back-placeholder'),
        document.getElementById('kyc-drop-back'));
      const btn = document.getElementById('kyc-next-back-btn');
      btn.disabled = false; btn.style.opacity = '1';
    }

    
    // State
    let kycFrontFile = null;
    let kycBackFile = null;
    const KYC_STEP_LABELS = ['', 'Recto', 'Verso', 'Aperçu'];

    function openKycModal() {
      const modal = document.getElementById('kyc-modal');
      if (!modal) return;

      // Reset all step visibility
      document.querySelectorAll('.kyc-upload-step').forEach(el => el.style.display = 'none');
      document.getElementById('kyc-step-pending').style.display = 'none';
      document.getElementById('kyc-step-rejected').style.display = 'none';
      document.getElementById('kyc-loading').style.display = 'none';
      document.getElementById('kyc-error').style.display = 'none';

      // Reset state
      kycFrontFile = null;
      kycBackFile = null;
      document.getElementById('kyc-front-input').value = '';
      document.getElementById('kyc-back-input').value = '';
      document.getElementById('kyc-front-preview').style.display = 'none';
      document.getElementById('kyc-back-preview').style.display = 'none';
      document.getElementById('kyc-drop-1').style.display = 'flex';
      document.getElementById('kyc-drop-2').style.display = 'flex';
      document.getElementById('kyc-step1-next').disabled = true;
      document.getElementById('kyc-step2-next').disabled = true;

      // Show correct state
      if (userIdentityStatus === 'pending_review') {
        document.getElementById('kyc-step-1').style.display = 'block';
        document.getElementById('kyc-step-pending').style.display = 'flex';
        document.querySelectorAll('.kyc-upload-step').forEach(el => el.style.display = 'none');
      } else if (userIdentityStatus === 'rejected') {
        document.getElementById('kyc-step-1').style.display = 'block';
      } else {
        document.getElementById('kyc-step-1').style.display = 'block';
      }

      // Reset step indicator + progress bar
      kycSetStepIndicator(1);
      openModal('kyc-modal');
    }

    function kycSetStepIndicator(step) {
      for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById('kyc-dot-' + i);
        if (!dot) continue;
        const isActive = i === step;
        const isDone = i < step;
        dot.style.background = isActive ? 'var(--primary)' : (isDone ? '#16a34a' : 'var(--border)');
        dot.style.color = isActive || isDone ? '#fff' : 'var(--text-muted)';
        // Also sync the progress bar dots (separate from step indicator circles)
        const progDot = document.getElementById('kyc-progress-dot-' + i);
        if (progDot) {
          progDot.style.background = isActive ? 'var(--primary)' : (isDone ? '#16a34a' : 'var(--border)');
        }
      }
      const sep1 = document.getElementById('kyc-sep-1');
      const sep2 = document.getElementById('kyc-sep-2');
      if (sep1) sep1.style.background = step > 1 ? '#16a34a' : 'var(--border)';
      if (sep2) sep2.style.background = step > 2 ? '#16a34a' : 'var(--border)';
      const label = document.getElementById('kyc-step-label');
      if (label) label.textContent = '— ' + (KYC_STEP_LABELS[step] || '');
    }

    function kycNextStep(current) {
      if (current === 1 && !kycFrontFile) return;
      if (current === 2 && !kycBackFile) return;
      if (current === 2) {
        // Go to step 3: preview
        document.getElementById('kyc-step-2').style.display = 'none';
        document.getElementById('kyc-step-3').style.display = 'block';
        document.getElementById('kyc-preview-front').src = URL.createObjectURL(kycFrontFile);
        document.getElementById('kyc-preview-back').src = URL.createObjectURL(kycBackFile);
        kycSetStepIndicator(3);
      } else {
        document.getElementById('kyc-step-' + current).style.display = 'none';
        document.getElementById('kyc-step-' + (current + 1)).style.display = 'block';
        kycSetStepIndicator(current + 1);
      }
    }

    function kycPrevStep(current) {
      if (current === 3) {
        document.getElementById('kyc-step-3').style.display = 'none';
        document.getElementById('kyc-step-2').style.display = 'block';
        kycSetStepIndicator(2);
      } else if (current === 2) {
        document.getElementById('kyc-step-2').style.display = 'none';
        document.getElementById('kyc-step-1').style.display = 'block';
        kycSetStepIndicator(1);
      }
    }

    function kycHandleFrontFile(input) {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        kycShowError('Fichier trop volumineux — max 10 Mo');
        input.value = '';
        return;
      }
      kycFrontFile = file;
      const preview = document.getElementById('kyc-front-preview');
      const img = document.getElementById('kyc-front-img');
      const drop = document.getElementById('kyc-drop-1');
      img.src = URL.createObjectURL(file);
      preview.style.display = 'flex';
      drop.style.display = 'none';
      document.getElementById('kyc-step1-next').disabled = false;
      kycHideError();
    }

    function kycHandleBackFile(input) {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        kycShowError('Fichier trop volumineux — max 10 Mo');
        input.value = '';
        return;
      }
      kycBackFile = file;
      const preview = document.getElementById('kyc-back-preview');
      const img = document.getElementById('kyc-back-img');
      const drop = document.getElementById('kyc-drop-2');
      img.src = URL.createObjectURL(file);
      preview.style.display = 'flex';
      drop.style.display = 'none';
      document.getElementById('kyc-step2-next').disabled = false;
      kycHideError();
    }

    function kycShowError(msg) {
      const el = document.getElementById('kyc-error');
      if (el) { el.textContent = msg; el.style.display = 'block'; }
    }
    function kycHideError() {
      const el = document.getElementById('kyc-error');
      if (el) el.style.display = 'none';
    }

    async function kycSubmit() {
      if (!kycFrontFile || !kycBackFile) {
        kycShowError('Les deux faces sont requises');
        return;
      }
      const btn = document.getElementById('kyc-confirm-btn');
      const loading = document.getElementById('kyc-loading');
      btn.disabled = true;
      btn.textContent = 'Envoi…';
      loading.style.display = 'flex';

      try {
        const formData = new FormData();
        formData.append('doc_front', kycFrontFile);
        formData.append('doc_back', kycBackFile);

        const res = await fetch('/api/identity/submit', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
          kycShowError(data.error || 'Erreur lors de la soumission.');
          btn.disabled = false;
          btn.textContent = 'Envoyer mes documents';
          loading.style.display = 'none';
          return;
        }
        userIdentityStatus = data.status;
        document.querySelectorAll('.kyc-upload-step').forEach(el => el.style.display = 'none');
        document.getElementById('kyc-step-pending').style.display = 'flex';
        document.getElementById('kyc-loading').style.display = 'none';
        document.getElementById('kyc-steps-indicator').style.display = 'none';
      } catch(_) {
        kycShowError('Vérification temporairement indisponible, réessayez.');
        btn.disabled = false;
        btn.textContent = 'Envoyer mes documents';
        loading.style.display = 'none';
      }
    }

    function kycRetry() {
      document.getElementById('kyc-step-rejected').style.display = 'none';
      document.getElementById('kyc-step-1').style.display = 'block';
      document.getElementById('kyc-steps-indicator').style.display = 'flex';
      kycFrontFile = null;
      kycBackFile = null;
      document.getElementById('kyc-front-input').value = '';
      document.getElementById('kyc-back-input').value = '';
      document.getElementById('kyc-front-preview').style.display = 'none';
      document.getElementById('kyc-back-preview').style.display = 'none';
      document.getElementById('kyc-drop-1').style.display = 'flex';
      document.getElementById('kyc-drop-2').style.display = 'flex';
      document.getElementById('kyc-step1-next').disabled = true;
      document.getElementById('kyc-step2-next').disabled = true;
      kycSetStepIndicator(1);
      kycHideError();
    }

    // Drag & drop for KYC drop zones
    ['kyc-drop-1', 'kyc-drop-2'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        if (id === 'kyc-drop-1') {
          const input = document.getElementById('kyc-front-input');
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          kycHandleFrontFile(input);
        } else {
          const input = document.getElementById('kyc-back-input');
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          kycHandleBackFile(input);
        }
      });
    });

    // Returns badge HTML for identity status — used on board cards and detail
    function identityBadgeHtml(status, compact = false) {
      if (status === 'verified') {
        return compact
          ? `<span style="display:inline-flex;align-items:center;gap:0.15rem;font-size:0.68rem;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.1);border:1px solid rgba(22,163,74,0.25);border-radius:4px;padding:0.1rem 0.35rem;" title="Identité vérifiée">✅ Vérifié</span>`
          : `<span style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.78rem;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.25);border-radius:6px;padding:0.2rem 0.6rem;">✅ Identité vérifiée</span>`;
      }
      return '';
    }

    // Returns badge HTML indicating host has payment configured — visible on board cards and detail
    function paymentBadgeHtml(chargesEnabled, compact = false) {
      if (chargesEnabled) {
        return compact
          ? `<span style="display:inline-flex;align-items:center;gap:0.15rem;font-size:0.68rem;font-weight:700;color:#0066aa;background:rgba(0,102,170,0.08);border:1px solid rgba(0,102,170,0.2);border-radius:4px;padding:0.1rem 0.35rem;" title="Paiements activés">💳 Paiements actifs</span>`
          : `<span style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.78rem;font-weight:700;color:#0066aa;background:rgba(0,102,170,0.06);border:1px solid rgba(0,102,170,0.18);border-radius:6px;padding:0.2rem 0.6rem;">💳 Paiements activés</span>`;
      }
      return '';
    }

    // Host tier badge — ALPHA_SHAPER / LOCAL_ICON / PREMIUM_HOST / GROWTH_HOST / AT_RISK
    const TIER_CONFIG = {
      ALPHA_SHAPER: { label: 'Alpha Shaper', emoji: '✦', color: '#9333ea', bg: 'rgba(147,51,234,0.08)', border: 'rgba(147,51,234,0.25)', title: 'Top host — exceptional quality' },
      LOCAL_ICON:   { label: 'Local Icon',   emoji: '◆', color: '#0066aa', bg: 'rgba(0,102,170,0.08)', border: 'rgba(0,102,170,0.2)',  title: 'Trusted local host' },
      PREMIUM_HOST: { label: 'Premium',     emoji: '★', color: '#16a34a', bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.25)', title: 'Verified host with great reviews' },
      GROWTH_HOST:  { label: 'Croissant',    emoji: '↗', color: '#d97706', bg: 'rgba(217,119,6,0.08)', border: 'rgba(217,119,6,0.2)',  title: 'Growing host' },
      AT_RISK:      { label: 'Attention',   emoji: '⚠',  color: '#dc2626', bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.2)', title: 'Needs attention' },
      null:         { label: null,          emoji: null,  color: null, bg: null, border: null, title: null }
    };

    function hostTierBadge(tier, compact = false) {
      const cfg = TIER_CONFIG[tier];
      if (!cfg || !cfg.label) return '';
      if (compact) {
        return `<span style="display:inline-flex;align-items:center;gap:0.15rem;font-size:0.66rem;font-weight:700;color:${cfg.color};background:${cfg.bg};border:1px solid ${cfg.border};border-radius:4px;padding:0.08rem 0.3rem;" title="${cfg.title}">${cfg.emoji} ${cfg.label}</span>`;
      }
      return `<span style="display:inline-flex;align-items:center;gap:0.25rem;font-size:0.78rem;font-weight:700;color:${cfg.color};background:${cfg.bg};border:1px solid ${cfg.border};border-radius:6px;padding:0.2rem 0.6rem;" title="${cfg.title}">${cfg.emoji} ${cfg.label}</span>`;
    }

    // Member since badge — shows tenure in months/years
    function memberSinceBadge(createdAt, compact = false) {
      if (!createdAt) return '';
      const created = new Date(createdAt);
      const now = new Date();
      const diffMonths = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
      let label;
      if (diffMonths < 1) label = 'Nouveau';
      else if (diffMonths < 12) label = `${diffMonths} mois`;
      else if (diffMonths < 24) label = '1 an';
      else label = `${Math.floor(diffMonths / 12)} ans`;
      if (compact) {
        return `<span style="display:inline-flex;align-items:center;gap:0.15rem;font-size:0.66rem;font-weight:600;color:#6b7280;background:rgba(107,114,128,0.08);border:1px solid rgba(107,114,128,0.18);border-radius:4px;padding:0.08rem 0.3rem;" title="Membre depuis ${created.toLocaleDateString('fr-FR', {month:'short',year:'numeric'})}">⏱ ${label}</span>`;
      }
      return `<span style="display:inline-flex;align-items:center;gap:0.25rem;font-size:0.78rem;font-weight:600;color:#6b7280;">⏱ Membre depuis ${created.toLocaleDateString('fr-FR', {month:'short', year:'numeric'})}</span>`;
    }

    // Trust score badge — shows numeric score 0-100 with color
    function trustScoreBadge(score, compact = false) {
      if (!score) return '';
      const n = parseFloat(score);
      let color;
      if (n >= 80) color = '#16a34a';
      else if (n >= 60) color = '#0066aa';
      else if (n >= 40) color = '#d97706';
      else color = '#dc2626';
      if (compact) {
        return `<span style="display:inline-flex;align-items:center;gap:0.1rem;font-size:0.66rem;font-weight:800;color:${color};background:transparent;" title="Score de confiance Swell">🔒 ${Math.round(n)}</span>`;
      }
      return `<span style="display:inline-flex;align-items:center;gap:0.2rem;font-size:0.78rem;font-weight:700;color:${color};" title="Score de confiance Swell — plus il est élevé, plus l'hôte est fiable">🔒 Confiance ${Math.round(n)}/100</span>`;
    }

    // ==================== PHOTO LIGHTBOX ====================
    let lbPhotos = [], lbIndex = 0, lbTouchStartX = 0;

    function openLightbox(photos, index) {
      if (!photos || photos.length === 0) return;
      lbPhotos = photos;
      lbIndex = Math.max(0, Math.min(index, photos.length - 1));
      updateLightbox();
      document.getElementById('lb-overlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function updateLightbox() {
      document.getElementById('lb-img').src = lbPhotos[lbIndex];
      document.getElementById('lb-counter').textContent = `${lbIndex + 1}/${lbPhotos.length}`;
      const dotsEl = document.getElementById('lb-dots');
      dotsEl.innerHTML = lbPhotos.map((_, i) =>
        `<div class="lb-dot ${i === lbIndex ? 'active' : ''}" data-action="jumpToLightbox" data-args="%24%7Bi%7D"></div>`
      ).join('');
      document.getElementById('lb-prev').style.display = lbPhotos.length > 1 ? '' : 'none';
      document.getElementById('lb-next').style.display = lbPhotos.length > 1 ? '' : 'none';
    }

    function lbNext() {
      lbIndex = (lbIndex + 1) % lbPhotos.length;
      updateLightbox();
    }

    function lbPrev() {
      lbIndex = (lbIndex - 1 + lbPhotos.length) % lbPhotos.length;
      updateLightbox();
    }

    function jumpToLightbox(i) {
      lbIndex = i;
      updateLightbox();
    }

    function closeLightbox() {
      document.getElementById('lb-overlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    document.getElementById('lb-close').addEventListener('click', closeLightbox);
    document.getElementById('lb-prev').addEventListener('click', lbPrev);
    document.getElementById('lb-next').addEventListener('click', lbNext);

    const lbCanvas = document.getElementById('lb-canvas');
    lbCanvas.addEventListener('touchstart', e => { lbTouchStartX = e.changedTouches[0].clientX; }, { passive: true });
    lbCanvas.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - lbTouchStartX;
      if (Math.abs(dx) > 50) dx < 0 ? lbNext() : lbPrev();
    }, { passive: true });
    lbCanvas.addEventListener('click', e => {
      const w = lbCanvas.offsetWidth;
      const x = e.clientX - lbCanvas.getBoundingClientRect().left;
      if (Math.abs(x - w / 2) < w * 0.15) closeLightbox();
    });

    // ==================== EVENT TRACKING ====================
    // Lightweight analytics for board detail conversion metrics
    function trackBoardEvent(event, boardId, extra = {}) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, board_id: boardId, ...extra, ts: Date.now() })
      }).catch(() => {}); // fire-and-forget
    }

    // ==================== LISTING WIZARD ====================
    // Price suggestion table: type → suggested daily price (€) in Hossegor area
    const PRICE_SUGGESTIONS = {
      shortboard: 28, longboard: 35, 'mid-length': 30, fish: 25,
      funboard: 22, foam: 18, sup: 35, bodyboard: 15
    };
    const TYPE_LABELS = {
      shortboard: 'shortboard', longboard: 'longboard', 'mid-length': 'mid-length',
      fish: 'fish', funboard: 'funboard', foam: 'mousse', sup: 'SUP', bodyboard: 'bodyboard'
    };
    const CONDITION_LABELS = { excellent: 'excellent état', good: 'bon état', fair: 'état correct', poor: 'état usé' };
    const SKILL_LABELS = { all: 'tous niveaux', beginner: 'débutants', intermediate: 'intermédiaires', advanced: 'surfeurs confirmés' };

    let wizState = {
      step: 1, photos: [], photoFiles: [], customTitle: '', type: '', length: '', condition: 'good',
      skill: 'all', price: 25, hourlyRate: 5, instantBooking: true, waiver: true,
      location: 'Hossegor, France', fins: true, leash: false, bag: false,
      spotId: null, publishedBoardId: null
    };

    function openListModal() {
      if (!currentUser) { openModal('auth-modal'); return; }
      wizReset();
      wizPopulateSpotDropdown();
      openModal('list-modal');
    }

    // Populate spot dropdown from allSpots (loaded at startup)
    function wizPopulateSpotDropdown() {
      const sel = document.getElementById('wiz-spot-select');
      if (!sel || !allSpots || allSpots.length === 0) return;
      const l = (wizState.location || '').toLowerCase();
      // Find matching spot by location text
      let matchedId = null;
      if (wizState.spotId) {
        matchedId = wizState.spotId;
      } else {
        const found = allSpots.find(s =>
          l.includes(s.name.toLowerCase()) ||
          l.includes(s.slug)
        );
        if (found) matchedId = found.id;
      }
      sel.innerHTML = '<option value="">— Sélectionne un spot —</option>' +
        allSpots.map(s => `<option value="${s.id}" ${matchedId == s.id ? 'selected' : ''}>${s.name}</option>`).join('');
    }

    // When user types location, auto-select the matching spot
    function wizOnLocationInput(val) {
      wizState.location = val;
      if (wizState.spotId) return; // don't override manual selection
      const sel = document.getElementById('wiz-spot-select');
      const l = (val || '').toLowerCase();
      const matched = allSpots?.find(s =>
        l.includes(s.name.toLowerCase()) || l.includes(s.slug)
      );
      if (sel && matched) {
        sel.value = matched.id;
        wizState.spotId = matched.id;
      } else if (sel) {
        sel.value = '';
        wizState.spotId = null;
      }
    }

    function wizOnSpotChange() {
      const sel = document.getElementById('wiz-spot-select');
      wizState.spotId = sel?.value ? parseInt(sel.value) : null;
    }

    function wizReset() {
      wizState = {
        step: 1, photos: [], photoFiles: [], customTitle: '', type: '', length: '', condition: 'good',
        skill: 'all', price: 25, hourlyRate: 5, instantBooking: true, waiver: true,
        location: 'Hossegor, France', fins: true, leash: false, bag: false, publishedBoardId: null
      };
      // Reset step visibility
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`wiz-step-${i}`);
        if (el) el.style.display = i === 1 ? 'block' : 'none';
      }
      // Clear photos
      const grid = document.getElementById('wiz-photo-grid');
      if (grid) grid.innerHTML = '';
      const input = document.getElementById('wiz-photos-input');
      if (input) input.value = '';
      // Reset price
      const slider = document.getElementById('wiz-price-slider');
      if (slider) slider.value = 25;
      const disp = document.getElementById('wiz-price-display');
      if (disp) disp.textContent = '25';
      // Reset hourly rate
      const hrSlider = document.getElementById('wiz-hourly-slider');
      if (hrSlider) hrSlider.value = 5;
      const hrDisp = document.getElementById('wiz-hourly-display');
      if (hrDisp) hrDisp.textContent = '5';
      // Reset toggles
      wizSyncToggles();
      wizUpdateDots(1);
    }

    function wizUpdateDots(step) {
      document.querySelectorAll('.wiz-dot').forEach(dot => {
        const s = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'done');
        if (s === step) dot.classList.add('active');
        else if (s < step) dot.classList.add('done');
      });
      // Back button: hide on step 1 and step 5 success
      const backBtn = document.getElementById('wiz-back-btn');
      if (backBtn) backBtn.style.visibility = (step === 1 || step === 5) ? 'hidden' : 'visible';
    }

    function wizShowStep(n) {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`wiz-step-${i}`);
        if (el) el.style.display = i === n ? 'block' : 'none';
      }
      wizState.step = n;
      wizUpdateDots(n);
    }

    function wizBack() {
      if (wizState.step > 1 && wizState.step < 5) wizShowStep(wizState.step - 1);
    }

    function wizNext(fromStep) {
      if (fromStep === 1) {
        // Require at least 3 photos (face, arrière, vue globale)
        if (wizState.photoFiles.length < 3) {
          const err = document.getElementById('wiz-step1-error');
          const remaining = 3 - wizState.photoFiles.length;
          err.textContent = wizState.photoFiles.length === 0
            ? 'Il nous faut 3 photos minimum — une de face, une de derrière, et une vue d\'ensemble.'
            : `Encore ${remaining} photo${remaining > 1 ? 's' : ''} — ajoute face, arrière et vue globale pour continuer.`;
          err.style.display = 'block';
          return;
        }
        wizShowStep(2);
        wizPrefillStep2();
      } else if (fromStep === 2) {
        wizState.customTitle = document.getElementById('wiz-custom-title')?.value.trim() || '';
        const err = document.getElementById('wiz-step2-error');
        err.style.display = 'none';
        const type = wizState.type;
        if (!type) { err.textContent = 'Choisis un type de planche.'; err.style.display = 'block'; return; }
        wizState.length = document.getElementById('wiz-length').value;
        wizState.condition = document.getElementById('wiz-condition').value;
        wizState.skill = document.getElementById('wiz-skill').value;
        wizShowStep(3);
        wizPrefillStep3();
      } else if (fromStep === 3) {
        const hrErr = document.getElementById('wiz-step3-error');
        hrErr.style.display = 'none';
        const hr = wizState.hourlyRate;
        if (!hr || hr < 3 || hr > 100) {
          hrErr.textContent = 'Le tarif horaire doit être entre 3€ et 100€/h.';
          hrErr.style.display = 'block';
          return;
        }
        wizShowStep(4);
        wizPrefillStep4();
      }
    }

    function wizPrefillStep2() {
      // If type already selected, reflect it
      if (wizState.type) {
        document.querySelectorAll('.wiz-type-btn').forEach(b => {
          b.classList.toggle('selected', b.dataset.val === wizState.type);
        });
      }
      const lenEl = document.getElementById('wiz-length');
      if (lenEl && !lenEl.value && wizState.length) lenEl.value = wizState.length;
      const condEl = document.getElementById('wiz-condition');
      if (condEl) condEl.value = wizState.condition;
      const skillEl = document.getElementById('wiz-skill');
      if (skillEl) skillEl.value = wizState.skill;
    }

    function wizPrefillStep3() {
      // Set suggested price based on board type
      const suggested = PRICE_SUGGESTIONS[wizState.type] || 25;
      wizSetPrice(suggested);
      const avgEl = document.getElementById('wiz-avg-price');
      if (avgEl) avgEl.textContent = `${suggested}€`;
      // Highlight matching preset
      document.querySelectorAll('.wiz-preset-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.textContent) === suggested);
      });
    }

    function wizPrefillStep4() {
      const locEl = document.getElementById('wiz-location');
      if (locEl) locEl.value = wizState.location;
      const finsEl = document.getElementById('wiz-fins');
      if (finsEl) finsEl.checked = wizState.fins;
      const leashEl = document.getElementById('wiz-leash');
      if (leashEl) leashEl.checked = wizState.leash;
      const bagEl = document.getElementById('wiz-bag');
      if (bagEl) bagEl.checked = wizState.bag;
      wizSyncToggles();
    }

    function wizSelectType(btn) {
      document.querySelectorAll('.wiz-type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      wizState.type = btn.dataset.val;
    }

    function wizUpdatePriceDisplay(val) {
      wizState.price = parseInt(val);
      const disp = document.getElementById('wiz-price-display');
      if (disp) disp.textContent = val;
      document.querySelectorAll('.wiz-preset-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.textContent) === parseInt(val));
      });
    }

    function wizSetPrice(val) {
      wizState.price = val;
      const slider = document.getElementById('wiz-price-slider');
      if (slider) slider.value = val;
      const disp = document.getElementById('wiz-price-display');
      if (disp) disp.textContent = val;
      document.querySelectorAll('.wiz-preset-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.textContent) === val);
      });
    }

    function wizSyncToggles() {
      // Instant booking toggle
      const track = document.getElementById('wiz-instant-track');
      const thumb = document.getElementById('wiz-instant-thumb');
      if (track && thumb) {
        track.style.background = wizState.instantBooking ? 'var(--primary)' : '#ccc';
        thumb.style.marginLeft = wizState.instantBooking ? 'auto' : '0';
      }
      // Waiver toggle
      const wtrack = document.getElementById('wiz-waiver-track');
      const wthumb = document.getElementById('wiz-waiver-thumb');
      if (wtrack && wthumb) {
        wtrack.style.background = wizState.waiver ? 'var(--primary)' : '#ccc';
        wthumb.style.marginLeft = wizState.waiver ? 'auto' : '0';
      }
    }

    function wizToggleInstant() {
      wizState.instantBooking = !wizState.instantBooking;
      const cb = document.getElementById('wiz-instant');
      if (cb) cb.checked = wizState.instantBooking;
      wizSyncToggles();
    }

    function wizToggleWaiver() {
      wizState.waiver = !wizState.waiver;
      const cb = document.getElementById('wiz-waiver');
      if (cb) cb.checked = wizState.waiver;
      wizSyncToggles();
    }

    // Append newly picked files to the current selection (not replace), capped at 8.
    function wizHandlePhotos(input) {
      const incoming = Array.from(input.files || []);
      for (const f of incoming) {
        if (wizState.photoFiles.length >= 8) break;
        const dup = wizState.photoFiles.some(e =>
          e.name === f.name && e.size === f.size && e.lastModified === f.lastModified);
        if (!dup) wizState.photoFiles.push(f);
      }
      // Reset so re-selecting the same file fires 'change' again.
      input.value = '';
      wizRenderPhotos();
    }

    // Render the current photoFiles into the thumbnail grid.
    function wizRenderPhotos() {
      const grid = document.getElementById('wiz-photo-grid');
      if (!grid) return;
      grid.innerHTML = '';
      wizState.photos = [];
      wizState.photoFiles.forEach((file, i) => {
        const url = URL.createObjectURL(file);
        wizState.photos.push(url);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;display:inline-block;';
        const img = document.createElement('img');
        img.src = url;
        img.loading = 'lazy';
        img.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:10px;border:2px solid var(--primary);display:block;';
        // Remove button
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.innerHTML = '×';
        rm.style.cssText = 'position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#e53;color:white;border:none;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;';
        rm.setAttribute('data-action', 'wizRemovePhoto');
        rm.setAttribute('data-arg', i.toString());
        wrap.appendChild(img);
        wrap.appendChild(rm);
        grid.appendChild(wrap);
      });
      wizUpdateStep1Button();
    }

    // Update step 1 button state, counter badge, and upload zone based on photo count
    function wizUpdateStep1Button() {
      const count = wizState.photoFiles.length;
      const btn = document.getElementById('wiz-step1-btn');
      const label = document.getElementById('wiz-photo-count-label');
      const zone = document.getElementById('wiz-upload-zone');
      const err = document.getElementById('wiz-step1-error');

      if (err) err.style.display = 'none';

      // Guide chip visual feedback — check off angles as photos are added
      const chipFace = document.getElementById('wiz-chip-face');
      const chipBack = document.getElementById('wiz-chip-back');
      const chipGlobal = document.getElementById('wiz-chip-global');
      const chips = [chipFace, chipBack, chipGlobal];
      chips.forEach((chip, i) => {
        if (!chip) return;
        if (i < count) {
          chip.style.background = 'var(--primary)';
          chip.style.color = '#fff';
        } else {
          chip.style.background = 'var(--primary-soft)';
          chip.style.color = 'var(--primary)';
        }
      });

      if (count === 0) {
        if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; }
        if (label) label.innerHTML = '<span style="color:var(--text-muted);">0/3 minimum</span>';
        if (zone) { zone.style.borderColor = 'var(--border)'; zone.style.background = 'var(--surface)'; }
      } else if (count < 3) {
        if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; }
        if (label) label.innerHTML = `<span style="color:var(--sunset);font-weight:600;">${count}/3 minimum</span> <span style="color:var(--text-muted);">· encore ${3 - count} photo${3 - count > 1 ? 's' : ''}</span>`;
        if (zone) { zone.style.borderColor = 'var(--sunset)'; zone.style.background = 'rgba(255,152,0,0.04)'; }
      } else {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        if (label) label.innerHTML = `<span style="color:var(--primary);font-weight:600;">✓ ${count} photo${count > 1 ? 's' : ''}</span>`;
        if (zone) { zone.style.borderColor = 'var(--primary)'; zone.style.background = 'rgba(0,102,170,0.04)'; }
      }
    }

    // Build auto-generated description from wizard state
    function wizBuildDescription() {
      const typeLabel = TYPE_LABELS[wizState.type] || wizState.type;
      const condLabel = CONDITION_LABELS[wizState.condition] || wizState.condition;
      const skillLabel = SKILL_LABELS[wizState.skill] || wizState.skill;
      const sizeStr = wizState.length ? ` ${wizState.length}'` : '';
      const locationShort = (wizState.location || 'Hossegor').split(',')[0].trim();
      return `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)}${sizeStr}, ${condLabel}. Parfaite pour ${skillLabel}. Disponible à ${locationShort}.`;
    }

    // Determine region from location
    function wizDetectRegion(loc) {
      const l = (loc || '').toLowerCase();
      if (l.includes('biarritz')) return 'biarritz';
      if (l.includes('seignosse')) return 'seignosse';
      if (l.includes('capbreton')) return 'capbreton';
      if (l.includes('anglet')) return 'biarritz';
      if (l.includes('lacanau')) return 'lacanau';
      return 'hossegor';
    }

    // Live deposit preview in wizard step 4
    function wizUpdateDeposit(val) {
      const preview = document.getElementById('wiz-deposit-preview');
      if (!preview) return;
      const v = parseFloat(val);
      if (!v || v <= 0) {
        preview.textContent = 'Optionnel. Une caution de 50% sera bloquée sur la carte du locataire (min. 50€, max. 500€) et libérée 48h après le retour.';
        preview.style.color = 'var(--text-muted)';
        return;
      }
      const dep = Math.min(Math.max(Math.round(v * 0.5 * 100) / 100, 50), 500);
      preview.innerHTML = `✅ Caution : <strong style="color:var(--sunset);">€${dep.toFixed(0)}</strong> bloqués sur la carte du locataire, libérés 48h après le retour.`;
      preview.style.color = 'var(--text-secondary)';
    }

    async function wizSubmit() {
      const err = document.getElementById('wiz-step4-error');
      err.style.display = 'none';

      wizState.location = document.getElementById('wiz-location').value.trim();
      wizState.fins = document.getElementById('wiz-fins')?.checked || false;
      wizState.leash = document.getElementById('wiz-leash')?.checked || false;
      wizState.bag = document.getElementById('wiz-bag')?.checked || false;
      wizState.estimatedValue = parseFloat(document.getElementById('wiz-estimated-value')?.value) || 0;

      if (!wizState.location) { err.textContent = 'Indique une localisation.'; err.style.display = 'block'; return; }
      if (!wizState.type) { err.textContent = 'Choisis un type de planche (étape 2).'; err.style.display = 'block'; return; }
      if (!wizState.spotId) { err.textContent = 'Sélectionne un spot de surf.'; err.style.display = 'block'; return; }

      // Show publishing overlay
      const overlay = document.getElementById('wiz-publishing-overlay');
      if (overlay) { overlay.style.display = 'flex'; overlay.parentElement.style.position = 'relative'; }

      try {
        const typeLabel = TYPE_LABELS[wizState.type] || wizState.type;
        const sizeStr = wizState.length ? ` ${wizState.length}'` : '';
        const locationShort = (wizState.location || 'Hossegor').split(',')[0].trim();
        const title = wizState.customTitle
          || `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)}${sizeStr} — ${locationShort}`;

        const formData = new FormData();
        formData.set('title', title);
        formData.set('description', wizBuildDescription());
        formData.set('boardType', wizState.type);
        formData.set('lengthFt', wizState.length || '');
        formData.set('condition', wizState.condition);
        formData.set('dailyPrice', wizState.price);
        formData.set('hourlyRate', wizState.hourlyRate);
        formData.set('location', wizState.location);
        formData.set('region', wizDetectRegion(wizState.location));
        formData.set('skillLevel', wizState.skill);
        formData.set('finsIncluded', wizState.fins ? 'true' : 'false');
        formData.set('leashIncluded', wizState.leash ? 'true' : 'false');
        formData.set('bagIncluded', wizState.bag ? 'true' : 'false');
        formData.set('damageWaiverEnabled', wizState.waiver ? 'true' : 'false');
        if (wizState.spotId) formData.set('spotId', wizState.spotId);
        if (wizState.estimatedValue > 0) formData.set('estimatedValue', wizState.estimatedValue);

        // Attach photo files
        wizState.photoFiles.forEach(file => formData.append('photos', file));

        const res = await fetch('/api/boards', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) {
          if (overlay) overlay.style.display = 'none';
          err.textContent = data.error || 'Erreur lors de la publication.';
          err.style.display = 'block';
          return;
        }

        wizState.publishedBoardId = data.board.id;
        if (overlay) overlay.style.display = 'none';
        wizShowSuccess(data.board, data.pending_kyc);

      } catch(e) {
        if (overlay) overlay.style.display = 'none';
        err.textContent = 'Impossible de publier l\'annonce. Réessaie.';
        err.style.display = 'block';
      }
    }

    function wizShowSuccess(board, pendingKyc) {
      wizShowStep(5);
      // Set share link
      const shareLink = `${window.location.origin}/boards/${board.id}`;
      const linkEl = document.getElementById('wiz-share-link');
      if (linkEl) linkEl.textContent = shareLink;

      // Toggle live vs pending-KYC state
      const liveEl = document.getElementById('wiz-success-live');
      const kycEl = document.getElementById('wiz-success-kyc');
      const exploreBtn = document.getElementById('wiz-explore-btn');
      const shareArea = document.getElementById('wiz-share-area');
      if (pendingKyc) {
        // Board saved but hidden — show KYC activation prompt
        if (liveEl) liveEl.style.display = 'none';
        if (kycEl) kycEl.style.display = 'block';
        if (exploreBtn) exploreBtn.style.display = 'none';
        if (shareArea) shareArea.style.display = 'none';
      } else {
        // Board is live immediately
        if (liveEl) liveEl.style.display = 'block';
        if (kycEl) kycEl.style.display = 'none';
        if (exploreBtn) exploreBtn.style.display = 'flex';
        if (shareArea) shareArea.style.display = 'block';
        // Refresh boards in background so new listing appears
        loadBoards();
      }

      // Confetti either way — they completed the wizard
      wizConfetti();
    }

    function wizCopyLink() {
      const linkEl = document.getElementById('wiz-share-link');
      if (!linkEl) return;
      navigator.clipboard.writeText(linkEl.textContent).then(() => {
        toast('Lien copié !', 'success');
      }).catch(() => {
        toast('Lien : ' + linkEl.textContent, 'info');
      });
    }

    function wizConfetti() {
      const area = document.getElementById('wiz-confetti-area');
      if (!area) return;
      const colors = ['#0066aa','#ff6b35','#00c2e0','#ffd700','#ff4da6','#6cd97e'];
      for (let i = 0; i < 28; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.cssText = `
          left: ${Math.random() * 100}%;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          width: ${6 + Math.random() * 6}px;
          height: ${6 + Math.random() * 6}px;
          border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
          animation-delay: ${Math.random() * 0.4}s;
          animation-duration: ${0.7 + Math.random() * 0.5}s;
        `;
        area.appendChild(piece);
        setTimeout(() => piece.remove(), 1500);
      }
    }

    // Legacy shim — called from profile dashboard "Ajouter une planche" button
    function setupPhotoPreview() {
      // CSP (strict script-src, no unsafe-inline) blocks inline onchange handlers,
      // so the wizard photo input is wired here instead of in the markup.
      const wizInput = document.getElementById('wiz-photos-input');
      if (wizInput) wizInput.addEventListener('change', (e) => wizHandlePhotos(e.target));
    }

    // ==================== PROFILE/DASHBOARD ====================
    function switchProfileTab(tab, el) {
      document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
      if (el) {
        el.classList.add('active');
      } else {
        // Find the tab by its text content — handle special cases with emoji prefixes
        const tabTextMap = { messages: 'Messages', payments: 'Paiements' };
        const matchText = tabTextMap[tab] || tab;
        document.querySelectorAll('.tabs .tab').forEach(t => {
          if (t.textContent.includes(matchText)) t.classList.add('active');
        });
      }
      loadProfileTab(tab);
    }

    async function loadProfileTab(tab) {
      const content = document.getElementById('profile-tab-content');
      // Fade out before content swap
      content.style.opacity = '0'; content.style.transition = 'opacity 0.12s';
      await new Promise(r => setTimeout(r, 100));
      content.style.opacity = ''; content.style.transition = '';
      content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">Chargement...</div>`;

      if (tab === 'bookings') {
        try {
          const res = await fetch('/api/bookings/my');
          const data = await res.json();
          const bookings = data.bookings || [];
          content.innerHTML = bookings.length === 0
            ? `<div class="empty-state"><div class="empty-state-icon">🏄</div><h3>Aucun voyage pour l'instant</h3><p>Parcours les planches et planifie ton premier trip surf !</p><a href="/app.html#search" class="btn" style="display:inline-flex;margin-top:1rem;background:var(--primary);color:white;border:none;border-radius:100px;padding:0.7rem 1.5rem;font-weight:600;text-decoration:none;">Trouver une planche →</a></div>`
            : bookings.map(b => {
              const photo = b.photos?.[0];
              const status = b.status;
              const statusLabels = { pending:'en attente', confirmed:'confirmé', completed:'terminé', cancelled:'annulé' };
              const statusColor = { pending:'#fbbf24', confirmed:'#4ade80', completed:'#60a5fa', cancelled:'#ff6b6b' }[status] || '#aaa';
              const canReview = status === 'completed';
              const hasReviewed = b.has_reviewed;
              const depositAmt = b.deposit_amount_cents || 0;
              const depositStatus = b.deposit_status || 'none';
              const depositBadge = (() => {
                if (depositStatus === 'held' && depositAmt > 0)
                  return `<div style="margin-top:0.4rem;font-size:0.7rem;padding:0.2rem 0.5rem;border-radius:6px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.2);color:var(--sunset);">🔒 Caution €${(depositAmt/100).toFixed(0)} bloquée</div>`;
                if (depositStatus === 'released' && depositAmt > 0)
                  return `<div style="margin-top:0.4rem;font-size:0.7rem;padding:0.2rem 0.5rem;border-radius:6px;background:var(--green-bg);border:1px solid var(--green-border);color:var(--green);">✓ Caution €${(depositAmt/100).toFixed(0)} libérée</div>`;
                if (depositStatus === 'captured' && depositAmt > 0)
                  return `<div style="margin-top:0.4rem;font-size:0.7rem;padding:0.2rem 0.5rem;border-radius:6px;background:var(--red-bg);border:1px solid var(--red-border);color:var(--red);">⚠️ Caution €${(depositAmt/100).toFixed(0)} retenue</div>`;
                if (depositStatus === 'pending')
                  return `<div style="margin-top:0.4rem;font-size:0.7rem;padding:0.2rem 0.5rem;border-radius:6px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#b45309;">⏳ Caution en attente</div>`;
                return '';
              })();
              return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:0.9rem;display:flex;gap:0.9rem;margin-bottom:0.6rem;align-items:flex-start;">
                ${photo ? `<img src="${photo}" style="width:64px;height:64px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0" loading="lazy">` : `<div style="width:64px;height:64px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#0f2233,#0a1628);display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;opacity:0.4;">🏄</div>`}
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:0.875rem;margin-bottom:0.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(b.board_title || '')}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);">${new Date(b.start_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} – ${new Date(b.end_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);">📍 ${escapeHtml(b.location || '')}</div>
                  ${depositBadge}
                  ${(status === 'confirmed' || status === 'completed') ? `<button style="margin-top:0.3rem;font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(0,102,170,0.3);background:var(--primary-soft);color:var(--primary);cursor:pointer;font-weight:500;" data-action="openInspectionModal" data-args="%24%7Bb.id%7D">📸 Photos état</button>` : ''}
                  ${canReview && !hasReviewed ? `<button class="review-prompt-btn" data-action="openReviewModal" data-args="%24%7Bb.id%7D">⭐ Laisser un avis</button>` : ''}
                  ${canReview && hasReviewed ? `<span class="review-done-badge">✓ Avis envoyé</span>` : ''}
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <div style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:100px;background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}30;">${statusLabels[status] || status}</div>
                  <div style="font-size:0.82rem;font-weight:700;margin-top:0.3rem;">€${(b.total_cents/100).toFixed(0)}</div>
                </div>
              </div>`;
            }).join('');
        } catch(e) { content.innerHTML = '<p style="color:var(--red);">Impossible de charger les voyages</p>'; }

      } else if (tab === 'host-bookings') {
        try {
          const res = await fetch('/api/bookings/host');
          const data = await res.json();
          const bookings = data.bookings || [];
          content.innerHTML = bookings.length === 0
            ? `<div class="empty-state"><div class="empty-state-icon">📋</div><h3>Aucune demande pour l'instant</h3><p>Propose tes planches pour commencer à recevoir des demandes.</p><a href="/app.html#publish" class="btn" style="display:inline-flex;margin-top:1rem;background:var(--primary);color:white;border:none;border-radius:100px;padding:0.7rem 1.5rem;font-weight:600;text-decoration:none;">Publier une planche →</a></div>`
            : bookings.map(b => {
              const photo = b.photos?.[0];
              const status = b.status;
              const statusLabels = { pending:'en attente', confirmed:'confirmé', completed:'terminé', cancelled:'annulé' };
              const statusColor = { pending:'#fbbf24', confirmed:'#4ade80', completed:'#60a5fa', cancelled:'#ff6b6b' }[status] || '#aaa';
              const canReview = status === 'completed';
              const hasReviewed = b.has_reviewed;
              return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:0.9rem;margin-bottom:0.6rem;">
                <div style="display:flex;gap:0.9rem;align-items:center;margin-bottom:${(status === 'pending' || (canReview && !hasReviewed)) ? '0.7rem' : '0'};">
                  ${photo ? `<img src="${photo}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0" loading="lazy">` : `<div style="width:56px;height:56px;border-radius:8px;background:linear-gradient(135deg,#0f2233,#0a1628);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;opacity:0.4;">🏄</div>`}
                  <div style="flex:1;">
                    <div style="font-weight:600;font-size:0.875rem;margin-bottom:0.15rem;">${escapeHtml(b.board_title || '')}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${new Date(b.start_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} – ${new Date(b.end_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">Locataire : ${escapeHtml(b.renter_name || '')}</div>
                    ${canReview && hasReviewed ? `<span class="review-done-badge">✓ Avis envoyé</span>` : ''}
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:100px;background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}30;">${statusLabels[status] || status}</div>
                    <div style="font-weight:700;font-size:0.875rem;margin-top:0.3rem;">€${(b.total_cents/100).toFixed(0)}</div>
                  </div>
                </div>
                ${status === 'pending' ? `<div style="display:flex;gap:0.5rem;">
                  <button class="btn btn-primary" style="flex:1;justify-content:center;font-size:0.78rem;padding:0.45rem;" data-action="updateBookingStatus" data-args="%24%7Bb.id%7D%2C'confirmed'">Accepter</button>
                  <button class="btn btn-outline" style="flex:1;justify-content:center;font-size:0.78rem;padding:0.45rem;" data-action="updateBookingStatus" data-args="%24%7Bb.id%7D%2C'cancelled'">Refuser</button>
                </div>` : ''}
                ${(status === 'confirmed' || status === 'completed') ? `<div style="margin-top:0.4rem;"><button style="font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(0,102,170,0.3);background:var(--primary-soft);color:var(--primary);cursor:pointer;font-weight:500;" data-action="openInspectionModal" data-args="%24%7Bb.id%7D">📸 Photos état</button></div>` : ''}
                ${canReview && !hasReviewed ? `<div style="margin-top:0.4rem;"><button class="review-prompt-btn" data-action="openReviewModal" data-args="%24%7Bb.id%7D">⭐ Noter ce locataire</button></div>` : ''}
                ${b.deposit_status === 'held' ? `<div style="margin-top:0.5rem;padding:0.5rem 0.7rem;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.2);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
                  <div style="font-size:0.72rem;color:var(--text-secondary);">🔒 Caution : <strong>€${((b.deposit_amount_cents||0)/100).toFixed(0)}</strong> bloqués</div>
                  <div style="display:flex;gap:0.4rem;">
                    <button data-action="hostReleaseDeposit" data-args="%24%7Bb.id%7D" style="font-size:0.68rem;padding:0.2rem 0.55rem;border-radius:6px;border:1px solid var(--green-border);background:var(--green-bg);color:var(--green);cursor:pointer;font-weight:500;">✓ Libérer</button>
                    <button data-action="hostReportDamage" data-args="%24%7Bb.id%7D%2C%20%24%7Bb.deposit_amount_cents%7C%7C0%7D" style="font-size:0.68rem;padding:0.2rem 0.55rem;border-radius:6px;border:1px solid rgba(255,107,53,0.3);background:rgba(255,107,53,0.08);color:var(--sunset);cursor:pointer;font-weight:500;">⚠️ Signaler dommage</button>
                  </div>
                </div>` : ''}
                ${b.deposit_status === 'captured' ? `<div style="margin-top:0.5rem;padding:0.4rem 0.7rem;background:rgba(255,107,53,0.05);border:1px solid rgba(255,107,53,0.15);border-radius:8px;font-size:0.72rem;color:var(--sunset);">⚠️ Caution de €${((b.deposit_amount_cents||0)/100).toFixed(0)} conservée suite à un dommage signalé</div>` : ''}
                ${b.deposit_status === 'released' ? `<div style="margin-top:0.5rem;padding:0.4rem 0.7rem;background:var(--green-bg);border:1px solid var(--green-border);border-radius:8px;font-size:0.72rem;color:var(--green);">✓ Caution libérée</div>` : ''}
              </div>`;
            }).join('');
        } catch(e) { content.innerHTML = '<p style="color:var(--red);">Impossible de charger les demandes</p>'; }

      } else if (tab === 'listings') {
        try {
          const res = await fetch(`/api/boards/host/${currentUser.id}`);
          const data = await res.json();
          const boards = data.boards || [];
          content.innerHTML = `<div style="margin-bottom:0.9rem;text-align:right;"><button class="btn btn-sunset" data-action="closeModal" data-args="'profile-modal')%3BopenListModal(">+ Ajouter une planche</button></div>` +
            (boards.length === 0
              ? `<div class="empty-state"><div class="empty-state-icon">🏄</div><h3>Aucune planche publiée</h3><p>Partage tes planches avec les surfeurs de passage.</p><a href="/app.html#publish" class="btn" style="display:inline-flex;margin-top:1rem;background:var(--primary);color:white;border:none;border-radius:100px;padding:0.7rem 1.5rem;font-weight:600;text-decoration:none;">Lister ma première planche →</a></div>`
              : boards.map(b => {
                const photo = b.photos?.[0];
                return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:0.9rem;display:flex;gap:0.9rem;align-items:flex-start;margin-bottom:0.6rem;${!b.is_listed ? 'opacity:0.65;' : ''}">
                  ${photo ? `<img src="${photo}" style="width:64px;height:64px;border-radius:var(--radius-sm);object-fit:cover;" loading="lazy">` : `<div style="width:64px;height:64px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#0f2233,#0a1628);display:flex;align-items:center;justify-content:center;font-size:1.3rem;opacity:0.4;">🏄</div>`}
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.875rem;margin-bottom:0.15rem;">${b.title}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">€${(b.daily_price_cents/100).toFixed(0)}/jour · ${b.board_type}</div>
                    ${b.avg_rating > 0 ? `<div style="font-size:0.75rem;color:var(--gold);">★ ${b.avg_rating} · ${b.review_count} avis</div>` : ''}
                    ${b.total_bookings > 0 ? `<div style="font-size:0.75rem;color:var(--text-muted);">${b.total_bookings} réservation${b.total_bookings > 1 ? 's' : ''}</div>` : ''}
                    <div style="margin-top:0.3rem;display:flex;align-items:center;gap:0.4rem;">
                      <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:0.72rem;color:var(--text-muted);">
                        <input type="checkbox" ${b.damage_waiver_enabled !== false ? 'checked' : ''} onchange="toggleDamageWaiver(${b.id}, this.checked)" style="accent-color:var(--primary);">
                        Protection dommages (+€5/j)
                      </label>
                    </div>
                    <div style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
                      <button data-action="toggleHostBoardCal" data-arg="${b.id}" id="cal-btn-${b.id}" style="font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(0,102,170,0.3);background:var(--primary-soft);color:var(--primary);cursor:pointer;font-weight:500;">📅 Disponibilités</button>
                      <button data-action="openEditModal" data-arg="${b.id}" style="font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(0,102,170,0.3);background:var(--primary-soft);color:var(--primary);cursor:pointer;font-weight:500;">✏️ Modifier</button>
                      ${b.is_listed
                        ? `<button data-action="confirmDelistBoard" data-args="${encodeURIComponent(JSON.stringify([b.id, b.title]))}" style="font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid var(--red-border);background:var(--red-bg);color:var(--red);cursor:pointer;font-weight:500;">📴 Délister</button>`
                        : `<button data-action="doRelistBoard" data-arg="${b.id}" style="font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid var(--green-border);background:var(--green-bg);color:var(--green);cursor:pointer;font-weight:500;">🔄 Remettre en ligne</button>`
                      }
                      <button data-action="confirmDeleteBoard" data-args="${encodeURIComponent(JSON.stringify([b.id, b.title]))}" style="font-size:0.72rem;padding:0.25rem 0.6rem;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);cursor:pointer;font-weight:500;">🗑 Supprimer</button>
                    </div>
                    <div id="host-cal-${b.id}" class="cal-wrap" style="display:none;margin-top:0.75rem;padding:0.75rem;background:var(--surface);border-radius:var(--radius-sm);border:1px solid var(--border);"></div>
                  </div>
                  <div>
                    <span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:100px;background:${b.is_listed?'var(--green-bg)':'var(--red-bg)'};color:${b.is_listed?'var(--green)':'var(--red)'};border:1px solid ${b.is_listed?'var(--green-border)':'var(--red-border)'};">${b.is_listed?'En ligne':'Délistée'}</span>
                  </div>
                </div>`;
              }).join(''));
        } catch(e) { content.innerHTML = '<p style="color:var(--red);">Impossible de charger les planches</p>'; }

      } else if (tab === 'messages') {
        try {
          const res = await fetch('/api/messages/conversations');
          const data = await res.json();
          const convs = data.conversations || [];
          if (convs.length === 0) {
            content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><h3>Aucun message</h3><p>Tes échanges avec les hôtes et locataires apparaîtront ici après une réservation.</p><a href="/app.html#search" class="btn" style="display:inline-flex;margin-top:1rem;background:var(--primary);color:white;border:none;border-radius:100px;padding:0.7rem 1.5rem;font-weight:600;text-decoration:none;">Explorer les planches →</a></div>`;
          } else {
            const statusLabels = { pending:'en attente', confirmed:'confirmé', completed:'terminé', cancelled:'annulé' };
            const statusColors = { pending:'#fbbf24', confirmed:'#4ade80', completed:'#60a5fa', cancelled:'#ff6b6b' };
            content.innerHTML = `<div class="conv-list">${convs.map(c => {
              const unread = c.unread_count > 0;
              const time = c.last_message_at ? formatMsgTime(c.last_message_at) : '';
              const preview = c.last_message
                ? (c.last_sender_id === currentUser.id ? `Toi : ${c.last_message}` : c.last_message)
                : 'Aucun message';
              const sc = statusColors[c.booking_status] || '#aaa';
              const sl = statusLabels[c.booking_status] || c.booking_status;
              return `<div class="conv-item" data-action="openConversation" data-args="%24%7Bc.booking_id%7D">
                <div class="conv-avatar">
                  <div class="avatar">${c.other_user_avatar ? `<img src="${c.other_user_avatar}" loading="lazy">` : escapeHtml(c.other_user_name[0] || '?')}</div>
                  ${unread ? `<div class="unread-dot">${c.unread_count > 9 ? '9+' : c.unread_count}</div>` : ''}
                </div>
                <div class="conv-info">
                  <div class="conv-name">${escapeHtml(c.other_user_name)}</div>
                  <div class="conv-preview${unread ? ' unread' : ''}">${escapeHtml(preview.slice(0,60))}${preview.length>60?'…':''}</div>
                </div>
                <div class="conv-meta">
                  <div class="conv-time">${time}</div>
                  <div class="conv-board">${escapeHtml((c.board_title||'').slice(0,18))}${(c.board_title||'').length>18?'…':''}</div>
                  <div class="conv-status-badge" style="background:${sc}18;color:${sc};border:1px solid ${sc}30;">${sl}</div>
                </div>
              </div>`;
            }).join('')}</div>`;
          }
        } catch(e) { content.innerHTML = '<p style="color:var(--red);">Impossible de charger les messages</p>'; }

      } else if (tab === 'profile') {
        const avatarHtml = currentUser.avatar_url
          ? `<img src="${currentUser.avatar_url}" id="profile-avatar-preview" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--primary);display:block;">`
          : `<div id="profile-avatar-preview" style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--sunset));display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:#fff;">${(currentUser.name||'?')[0].toUpperCase()}</div>`;
        // Build trust metrics section for host users
        const trustSection = (async () => {
          if (!currentUser.is_host) return '';
          try {
            const res = await fetch('/api/host-metrics/me');
            if (!res.ok) return '';
            const { metrics } = await res.json();
            if (!metrics) return '';
            const score = Math.round(metrics.trust_score || 0);
            const scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#0066aa' : score >= 40 ? '#d97706' : '#dc2626';
            const tierConfig = {
              ALPHA_SHAPER: '✦ Alpha Shaper',
              LOCAL_ICON: '◆ Local Icon',
              PREMIUM_HOST: '★ Premium Host',
              GROWTH_HOST: '↗ Croissant',
              AT_RISK: '⚠ Attention'
            };
            const tierLabel = tierConfig[metrics.tier] || 'Hôte';
            const trendEl = metrics.evolution_trend === 'rising' ? '↗' : metrics.evolution_trend === 'declining' ? '↘' : '→';
            const trendLabel = metrics.evolution_trend === 'rising' ? 'en progression' : metrics.evolution_trend === 'declining' ? 'en déclin' : 'stable';
            return `<div style="margin-bottom:1rem;padding:0.85rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);">
              <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.6rem;">🔒 Score de confiance Swell</div>
              <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">
                <div style="text-align:center;">
                  <div style="font-family:'Syne',sans-serif;font-size:2rem;font-weight:800;color:${scoreColor};">${score}</div>
                  <div style="font-size:0.68rem;color:var(--text-muted);">/ 100</div>
                </div>
                <div style="flex:1;">
                  <div style="font-size:0.85rem;font-weight:700;color:var(--text);">${tierLabel}</div>
                  <div style="font-size:0.75rem;color:var(--text-secondary);">${trendEl} ${trendLabel}</div>
                  ${metrics.total_rentals > 0 ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">${metrics.total_rentals} location${metrics.total_rentals > 1 ? 's' : ''} · ★ ${metrics.board_quality_avg.toFixed(1)} moyenne</div>` : ''}
                </div>
              </div>
            </div>`;
          } catch(_) { return ''; }
        })();
        // Build identity status banner for profile tab
        const kycBanner = (() => {
          if (userIdentityStatus === 'verified') {
            return `<div style="display:flex;align-items:center;gap:0.6rem;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.25);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;">
              <span style="font-size:1.3rem;">✅</span>
              <div><div style="font-weight:700;font-size:0.85rem;color:#16a34a;">Identité vérifiée</div><div style="font-size:0.75rem;color:var(--text-muted);">Ton badge est visible sur ton profil et tes annonces.</div></div>
            </div>`;
          }
          if (userIdentityStatus === 'pending_review') {
            return `<div style="display:flex;align-items:center;gap:0.6rem;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.3);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;">
              <span style="font-size:1.3rem;">⏳</span>
              <div><div style="font-weight:700;font-size:0.85rem;color:#b45309;">Vérification en cours</div><div style="font-size:0.75rem;color:var(--text-muted);">Délai habituel : quelques heures.</div></div>
            </div>`;
          }
          if (userIdentityStatus === 'rejected') {
            return `<div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;background:var(--red-bg);border:1px solid var(--red-border);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;">
              <div style="display:flex;align-items:center;gap:0.6rem;">
                <span style="font-size:1.3rem;">❌</span>
                <div><div style="font-weight:700;font-size:0.85rem;color:var(--red);">Document refusé</div><div style="font-size:0.75rem;color:var(--text-muted);">Réessaie avec un autre document.</div></div>
              </div>
              <button class="btn btn-outline" style="font-size:0.75rem;padding:0.3rem 0.7rem;" data-action="openKycModal">Réessayer</button>
            </div>`;
          }
          // Not started
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;">
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <span style="font-size:1.3rem;">🛡️</span>
              <div><div style="font-weight:700;font-size:0.85rem;">Vérification d'identité</div><div style="font-size:0.75rem;color:var(--text-muted);">Obligatoire avant la première location ou mise en location.</div></div>
            </div>
            <button class="btn btn-primary" style="font-size:0.75rem;padding:0.3rem 0.7rem;white-space:nowrap;" data-action="openKycModal">Vérifier</button>
          </div>`;
        })();

        const trustHtml = await trustSection;
        content.innerHTML = kycBanner + trustHtml + `<form onsubmit="updateProfile(event)" enctype="multipart/form-data">
          <!-- PHOTO DE PROFIL -->
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem;padding:1rem;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border);">
            ${avatarHtml}
            <div>
              <div style="font-size:0.82rem;font-weight:600;color:var(--text);margin-bottom:0.3rem;">Photo de profil</div>
              <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.78rem;padding:0.4rem 0.8rem;border-radius:100px;border:1px solid var(--border);background:var(--card);color:var(--text-secondary);transition:all 0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'">
                📸 Changer la photo
                <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" style="display:none;" onchange="previewProfilePhoto(this)">
              </label>
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem;">JPG, PNG ou WebP · Max 2MB</div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Nom complet</label>
            <input type="text" name="name" class="form-input" value="${escHtml(currentUser.name || '')}" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Niveau de surf</label>
              <select name="surf_level" class="form-select">
                <option value="">Choisir un niveau</option>
                <option value="beginner" ${currentUser.surf_level==='beginner'?'selected':''}>Débutant</option>
                <option value="intermediate" ${currentUser.surf_level==='intermediate'?'selected':''}>Intermédiaire</option>
                <option value="advanced" ${currentUser.surf_level==='advanced'?'selected':''}>Avancé</option>
                <option value="expert" ${currentUser.surf_level==='expert'?'selected':''}>Expert</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Localisation</label>
              <input type="text" name="location" class="form-input" value="${escHtml(currentUser.location || '')}" placeholder="ex. Hossegor, France">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Bio</label>
            <textarea name="bio" class="form-textarea" placeholder="Parle-toi aux autres surfeurs...">${currentUser.bio || ''}</textarea>
          </div>
          <!-- MON TRIP SURF LE PLUS OUF -->
          <div class="form-group" style="background:linear-gradient(135deg,rgba(0,102,170,0.06),rgba(255,107,53,0.06));border:1px solid rgba(0,102,170,0.15);border-radius:var(--radius);padding:1rem;">
            <label class="form-label" style="font-size:0.9rem;font-weight:700;color:var(--text);">🤙 Mon trip surf le plus ouf</label>
            <textarea name="best_surf_trip_text" class="form-textarea" maxlength="500" placeholder="Pipeline à l'aube, Biarritz sous l'orage, ce jour à Mundaka où les vagues étaient parfaites... Raconte nous !">${currentUser.best_surf_trip_text || ''}</textarea>
            <div style="text-align:right;font-size:0.68rem;color:var(--text-muted);margin-top:0.25rem;" id="trip-char-count">${(currentUser.best_surf_trip_text||'').length}/500</div>
          </div>
          <div id="profile-msg" style="margin-bottom:0.6rem;"></div>
          <div style="display:flex;gap:0.6rem;">
            <button type="submit" class="btn btn-primary">Enregistrer</button>
            <button type="button" class="btn btn-outline" data-action="doLogout">Se déconnecter</button>
          </div>
        </form>`;
        // Live character counter for surf trip
        setTimeout(() => {
          const ta = content.querySelector('[name=best_surf_trip_text]');
          const counter = document.getElementById('trip-char-count');
          if (ta && counter) ta.addEventListener('input', () => { counter.textContent = ta.value.length + '/500'; });
        }, 0);

      } else if (tab === 'payments') {
        // Host payment profile — IBAN setup and payout status
        try {
          const res = await fetch('/api/stripe-connect/status');
          const data = res.ok ? await res.json() : {};
          const enabled = data.chargesEnabled;
          const completedAt = data.completedAt ? new Date(data.completedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

          if (enabled) {
            content.innerHTML = `
              <div style="display:flex;align-items:center;gap:0.9rem;background:linear-gradient(135deg, rgba(22,163,74,0.1), rgba(22,163,74,0.05));border:1px solid rgba(22,163,74,0.3);border-radius:var(--radius);padding:1.2rem 1.4rem;margin-bottom:2rem;box-shadow:0 2px 8px rgba(22,163,74,0.08);">
                <span style="font-size:2rem;flex-shrink:0;">✓</span>
                <div>
                  <div style="font-weight:700;font-size:1rem;color:#16a34a;margin-bottom:0.3rem;">Paiements configurés</div>
                  <div style="font-size:0.8rem;color:var(--text-secondary);">Tes coordonnées bancaires sont enregistrées${completedAt ? ' depuis le ' + completedAt : ''}. Les virements sont traités sous 2-3 jours ouvrés après chaque location.</div>
                </div>
              </div>
              <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.4rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size:0.95rem;font-weight:700;color:var(--text);margin-bottom:1rem;">Comment fonctionne le paiement Swell ?</div>
                <ul style="font-size:0.85rem;color:var(--text-secondary);line-height:2;margin-left:1.2rem;space-y:0.6rem;">
                  <li><strong style="color:var(--text);">Le renter paie</strong> — Montant total (location + frais de service) via Stripe</li>
                  <li><strong style="color:var(--text);">Swell prélève 15%</strong> — Frais de la plateforme et assurance</li>
                  <li><strong style="color:var(--text);">Tu reçois 85%</strong> — Virement sur ton IBAN sous 2-3 jours ouvrés</li>
                  <li><strong style="color:var(--text);">Protection dommages</strong> — Frais versés à Swell pour couvrir les réclamations</li>
                </ul>
              </div>
              <div style="margin-top:2rem;font-size:0.8rem;color:var(--text-muted);text-align:center;">Besoin de modifier tes coordonnées ? <a href="mailto:support@swell.fr" style="color:var(--primary);font-weight:600;text-decoration:none;">Contacte le support</a></div>`;
          } else {
            content.innerHTML = `
              <div style="display:flex;align-items:flex-start;gap:0.9rem;background:linear-gradient(135deg, rgba(255,107,53,0.08), rgba(255,107,53,0.04));border:1px solid rgba(255,107,53,0.25);border-radius:var(--radius);padding:1.2rem 1.4rem;margin-bottom:2rem;box-shadow:0 2px 8px rgba(255,107,53,0.06);">
                <span style="font-size:2rem;flex-shrink:0;margin-top:0.1rem;">⚠️</span>
                <div style="flex:1;">
                  <div style="font-weight:700;font-size:1rem;color:var(--sunset);margin-bottom:0.3rem;">Configuration requise</div>
                  <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5;">Les renters ne peuvent pas réserver tes planches tant que tu n'as pas configuré tes coordonnées bancaires. Active les paiements ci-dessous pour commencer à louer.</div>
                </div>
              </div>
              <form id="payment-onboard-form" onsubmit="submitPaymentOnboarding(event)" style="display:flex;flex-direction:column;gap:0;">
                <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.4rem;margin-bottom:1.2rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                  <div style="font-weight:700;font-size:0.95rem;color:var(--text);margin-bottom:1.2rem;">Coordonnées bancaires</div>
                  <div class="form-group" style="margin-bottom:1rem;">
                    <label class="form-label" style="font-size:0.85rem;font-weight:600;">IBAN <span style="color:var(--red);">*</span></label>
                    <input type="text" id="onboard-iban" class="form-input" placeholder="FR76 3000 6000 0112 3456 7890 189" required autocomplete="off" style="font-family:monospace;letter-spacing:0.04em;font-size:0.9rem;">
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.35rem;">IBAN français ou européen — vérifié sous 24-48h.</div>
                  </div>
                  <div class="form-group">
                    <label class="form-label" style="font-size:0.85rem;font-weight:600;">Nom du titulaire <span style="color:var(--red);">*</span></label>
                    <input type="text" id="onboard-name" class="form-input" placeholder="Prénom NOM" required autocomplete="name" style="font-size:0.9rem;">
                  </div>
                </div>
                <div style="background:linear-gradient(135deg, rgba(0,102,170,0.06), rgba(0,102,170,0.03));border:1px solid rgba(0,102,170,0.15);border-radius:var(--radius);padding:1rem 1.2rem;margin-bottom:1.2rem;">
                  <div style="display:flex;align-items:flex-start;gap:0.7rem;font-size:0.8rem;color:var(--text-secondary);line-height:1.6;">
                    <span style="flex-shrink:0;margin-top:0.1rem;">🔒</span>
                    <div>
                      <strong style="color:var(--text);">Sécurité :</strong> Tes coordonnées bancaires sont transmises de façon sécurisée. Swell ne stocke pas ton RIB complet — seules les 4 derniers chiffres sont conservés pour référence.
                    </div>
                  </div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.2rem;margin-bottom:1.4rem;font-size:0.8rem;color:var(--text-secondary);line-height:1.7;">
                  <strong style="color:var(--text);">Après activation :</strong> Tu reçois 85% de chaque location directement sur ton IBAN sous 2-3 jours ouvrés. Les 15% restants couvrent les frais Swell et l'assurance dommages.
                </div>
                <div id="payment-onboard-error" style="display:none;background:var(--red-bg);border:1px solid var(--red-border);border-radius:var(--radius-sm);padding:0.75rem 1rem;font-size:0.8rem;color:var(--red);margin-bottom:1rem;"></div>
                <button type="submit" id="payment-onboard-btn" class="btn btn-primary" style="width:100%;justify-content:center;padding:0.85rem 1.2rem;font-size:0.95rem;font-weight:600;">
                  Activer les paiements
                </button>
              </form>`;
          }
        } catch(e) {
          content.innerHTML = '<p style="color:var(--red);text-align:center;padding:2rem;">Impossible de charger le statut paiement</p>';
        }

      } else if (tab === 'invite') {
        // Referral invite card
        try {
          const res = await fetch('/api/referrals/me');
          if (!res.ok) throw new Error('Not found');
          const data = await res.json();
          const code = data.referralCode || '—';
          const url = data.referralUrl || '';
          const credits = data.creditCents || 0;
          const redeemed = data.totalRedemptions || 0;
          const remaining = data.remainingSlots ?? 5;
          const creditsEur = (credits / 100).toFixed(0);
          content.innerHTML = `
            <div style="padding:0.25rem 0 0.5rem;">
              <div style="font-size:1.05rem;font-weight:700;color:var(--text);margin-bottom:0.35rem;">🤙 Inviter un ami</div>
              <p style="font-size:0.83rem;color:var(--text-secondary);margin:0 0 1rem;line-height:1.6;">Partage ton code. Quand un ami finalise sa première réservation, vous gagnez <strong>€10 chacun</strong>. Jusqu'à 5 parrainages.</p>

              <div style="background:var(--surface);border:2px dashed var(--primary);border-radius:12px;padding:1.2rem;text-align:center;margin-bottom:1rem;">
                <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.5rem;">Ton code perso</div>
                <div style="font-family:'Syne',sans-serif;font-size:2rem;font-weight:800;color:var(--primary);letter-spacing:4px;">${code}</div>
              </div>

              <div style="display:flex;gap:0.5rem;margin-bottom:1.2rem;">
                <input type="text" id="referral-link-input" readonly value="${url}" style="flex:1;font-size:0.78rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.6rem 0.8rem;color:var(--text);">
                <button class="btn btn-primary" data-action="copyReferralLink" data-arg="${url}" style="white-space:nowrap;padding:0.6rem 1rem;font-size:0.82rem;">📋 Copier</button>
                ${typeof navigator.share === 'function' ? `<button class="btn btn-outline" data-action="shareReferralLink" data-args="'%24%7Burl%7D'%2C%20'%24%7Bcode%7D'" style="padding:0.6rem 0.8rem;font-size:0.82rem;">↗ Partager</button>` : ''}
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:1.2rem;">
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.8rem;text-align:center;">
                  <div style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:800;color:var(--primary);">${redeemed}</div>
                  <div style="font-size:0.72rem;color:var(--text-muted);">amis parrainés</div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.8rem;text-align:center;">
                  <div style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:800;color:#16a34a;">€${creditsEur}</div>
                  <div style="font-size:0.72rem;color:var(--text-muted);">crédits gagnés</div>
                </div>
              </div>

              <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.85rem 1rem;font-size:0.78rem;color:var(--text-secondary);line-height:1.7;">
                ✓ Ton ami doit finaliser sa <strong>première réservation payée</strong><br>
                ✓ €10 de crédit pour toi + €10 pour lui<br>
                ✓ ${remaining} parrainage${remaining !== 1 ? 's' : ''} restant${remaining !== 1 ? 's' : ''} (max 5)
              </div>
            </div>`;
        } catch(e) {
          content.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:2rem;">Chargement du programme de parrainage impossible.</p>';
        }
      }
    }

    function copyReferralLink(url) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => toast('🔗 Lien copié !', 'success')).catch(() => {});
      } else {
        const el = document.getElementById('referral-link-input');
        if (el) { el.select(); document.execCommand('copy'); toast('🔗 Lien copié !', 'success'); }
      }
    }

    function shareReferralLink(url, code) {
      if (navigator.share) {
        navigator.share({ title: 'Swell — Location de planches', text: `Utilise mon code ${code} pour ta première session de surf — on gagne €10 chacun 🤙`, url }).catch(() => {});
      }
    }

    async function submitPaymentOnboarding(e) {
      e.preventDefault();
      const iban = document.getElementById('onboard-iban')?.value || '';
      const name = document.getElementById('onboard-name')?.value || '';
      const errEl = document.getElementById('payment-onboard-error');
      const btn = document.getElementById('payment-onboard-btn');

      errEl.style.display = 'none';
      btn.disabled = true; btn.textContent = 'Enregistrement...';

      try {
        const res = await fetch('/api/stripe-connect/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iban: iban.replace(/\s+/g, ''), accountName: name })
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.textContent = data.error || 'Erreur lors de l\'enregistrement';
          errEl.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Activer les paiements';
          return;
        }
        toast('💳 Coordonnées bancaires enregistrées ! Virements activés sous 24-48h.', 'success');
        loadProfileTab('payments');
      } catch(e) {
        errEl.textContent = 'Erreur réseau. Réessaie.';
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Activer les paiements';
      }
    }

    function previewProfilePhoto(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      // 2MB guard
      if (file.size > 2 * 1024 * 1024) {
        toast('Photo trop lourde — max 2MB', 'error');
        input.value = '';
        return;
      }
      const url = URL.createObjectURL(file);
      const preview = document.getElementById('profile-avatar-preview');
      if (!preview) return;
      preview.outerHTML = `<img id="profile-avatar-preview" src="${url}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--primary);display:block;">`;
    }

    async function updateProfile(e) {
      e.preventDefault();
      // Use FormData directly so multer can receive the avatar file
      const formData = new FormData(e.target);
      const msgEl = document.getElementById('profile-msg');
      const btn = e.target.querySelector('[type=submit]');
      const origText = btn.textContent;
      btn.textContent = 'Enregistrement…'; btn.disabled = true;

      try {
        const res = await fetch('/api/profiles/me', {
          method: 'PUT',
          body: formData  // no Content-Type header — browser sets multipart boundary automatically
        });
        const data = await res.json();
        if (!res.ok) { msgEl.innerHTML = `<span class="form-error">${data.error}</span>`; return; }
        currentUser = { ...currentUser, ...data.user };
        updateNavAuth();
        msgEl.innerHTML = '<span class="form-success">✓ Profil enregistré !</span>';
      } catch(e) {
        msgEl.innerHTML = '<span class="form-error">Impossible d\'enregistrer</span>';
      } finally {
        btn.textContent = origText; btn.disabled = false;
      }
    }

    async function updateBookingStatus(bookingId, status) {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error();
        const labels = { confirmed: 'Réservation acceptée', cancelled: 'Réservation refusée' };
        toast(labels[status] || 'Réservation mise à jour', 'success');
        loadProfileTab('host-bookings');
      } catch(e) { toast('Impossible de mettre à jour la réservation', 'error'); }
    }

    // Toggle host calendar inline below board card
    function toggleHostBoardCal(boardId) {
      const calDiv = document.getElementById(`host-cal-${boardId}`);
      const btn = document.getElementById(`cal-btn-${boardId}`);
      if (!calDiv) return;

      const isOpen = calDiv.style.display !== 'none';
      if (isOpen) {
        calDiv.style.display = 'none';
        if (btn) btn.textContent = '📅 Disponibilités';
      } else {
        calDiv.style.display = 'block';
        if (btn) btn.textContent = '📅 Masquer';
        openHostCalendar(boardId, `host-cal-${boardId}`);
      }
    }

    async function toggleDamageWaiver(boardId, enabled) {
      try {
        const res = await fetch(`/api/boards/${boardId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ damageWaiverEnabled: enabled })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        toast(enabled ? 'Protection dommages activée ✅' : 'Protection dommages désactivée', 'success');
      } catch(e) {
        console.error('toggleDamageWaiver failed:', e.message);
        toast('Impossible de mettre à jour la protection', 'error');
      }
    }

    // Host manually releases a deposit hold (clean return, no damage)
    async function hostReleaseDeposit(bookingId) {
      try {
        const res = await fetch(`/api/deposits/${bookingId}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        toast('Caution libérée ✅', 'success');
        loadProfileTab('host-bookings');
      } catch(e) {
        toast('Impossible de libérer la caution : ' + e.message, 'error');
      }
    }

    // Host reports damage — opens a proper modal with amount input + photo evidence link
    async function hostReportDamage(bookingId, maxCents) {
      const maxEur = (maxCents / 100).toFixed(0);
      const modalBody = document.getElementById('damage-modal-body');
      modalBody.innerHTML = `
        <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:1rem;line-height:1.5;">
          Documente le dommage avec des photos. La retenue sera basée sur les photos check-in/out comparées à l'état au retour.
        </p>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:0.85rem;margin-bottom:1rem;font-size:0.78rem;color:var(--text-secondary);line-height:1.5;">
          <div style="font-weight:600;color:var(--text);margin-bottom:0.4rem;">📸 Preuves photo disponibles</div>
          Tu as soumis des photos check-in et check-out dans l'inspection. En cas de litige, elles servent de preuve à l'arbitrage Swell.
        </div>
        <div class="form-group" style="margin-bottom:0.9rem;">
          <label class="form-label">Montant à conserver de la caution</label>
          <div style="position:relative;">
            <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.9rem;pointer-events:none;">€</span>
            <input type="number" id="damage-amount-input" min="1" max="${maxEur}" step="1" placeholder="ex. 80"
              style="width:100%;padding:0.65rem 0.75rem 0.65rem 1.8rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font-size:0.95rem;" />
          </div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">Maximum : €${maxEur} (montant de la caution bloquée)</div>
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Description du dommage <span style="font-weight:400;color:var(--text-muted);">(recommandé)</span></label>
          <textarea id="damage-desc-input" rows="3" placeholder="ex. : aileron avant cassé au check-out, leash fendu en deux"
            style="width:100%;padding:0.65rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font-size:0.85rem;resize:vertical;font-family:inherit;line-height:1.5;"></textarea>
        </div>
        <div style="display:flex;gap:0.6rem;flex-direction:column;">
          <button class="btn btn-danger" id="damage-submit-btn" style="background:var(--red);color:#fff;justify-content:center;font-weight:600;"
            data-action="submitDamageReport" data-args="%24%7BbookingId%7D%2C%20%24%7BmaxCents%7D">
            ⚠️ Signaler le dommage
          </button>
          <button class="btn btn-outline" style="justify-content:center;font-size:0.82rem;"
            data-action="closeModal" data-args="'damage-modal')%3BopenInspectionModal(%24%7BbookingId%7D">
            📸 Voir les photos d'inspection
          </button>
          <button class="btn btn-ghost" style="justify-content:center;font-size:0.78rem;color:var(--text-muted);background:none;border:none;padding:0.5rem;"
            data-action="closeModal" data-arg="damage-modal">
            Annuler
          </button>
        </div>
      `;
      openModal('damage-modal');
      // Focus amount input
      setTimeout(() => document.getElementById('damage-amount-input')?.focus(), 100);
    }

    // Submits damage report from the modal
    async function submitDamageReport(bookingId, maxCents) {
      const amountInput = document.getElementById('damage-amount-input');
      const descInput = document.getElementById('damage-desc-input');
      const amount = parseFloat(amountInput?.value);
      if (!amount || amount <= 0 || isNaN(amount)) {
        amountInput.style.borderColor = 'var(--red)';
        amountInput.focus();
        return;
      }
      amountInput.style.borderColor = '';
      const amountCents = Math.round(Math.min(amount, maxCents / 100) * 100);
      const description = descInput?.value?.trim() || 'Dommage signalé par le host';
      try {
        const res = await fetch(`/api/deposits/${bookingId}/report-damage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ damageAmountCents: amountCents, description })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        closeModal('damage-modal');
        toast(data.message || `Dommage signalé — €${(amountCents/100).toFixed(0)} conservés`, 'success');
        loadProfileTab('host-bookings');
      } catch(e) {
        toast('Impossible de signaler le dommage : ' + e.message, 'error');
      }
    }

    // Delist: check for active bookings first, warn host if any exist
    async function confirmDelistBoard(boardId, boardTitle) {
      try {
        // Try delist without force — server returns 409 + activeBookings count if there are future bookings
        const res = await fetch(`/api/boards/${boardId}/delist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: false })
        });

        if (res.status === 409) {
          const data = await res.json();
          const n = data.activeBookings;
          // Show warning with booking count, offer to proceed anyway
          showBoardConfirm(
            '⚠️ Réservations en cours',
            `"${boardTitle}" a ${n} réservation${n > 1 ? 's' : ''} en cours ou à venir. En délistant, les locataires ne pourront plus accéder à la fiche de ta planche. Continue quand même ?`,
            'Délister quand même',
            'var(--red)',
            () => doDelistBoard(boardId, true)
          );
          return;
        }

        if (!res.ok) throw new Error();
        toast('Planche délistée — elle reste visible dans ton dashboard', 'success');
        loadProfileTab('listings');
      } catch(e) { toast('Impossible de délister la planche', 'error'); }
    }

    // Delist with force=true (after user confirmed warning)
    async function doDelistBoard(boardId, force = false) {
      try {
        const res = await fetch(`/api/boards/${boardId}/delist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force })
        });
        if (!res.ok) throw new Error();
        toast('Planche délistée — elle reste visible dans ton dashboard', 'success');
        loadProfileTab('listings');
      } catch(e) { toast('Impossible de délister la planche', 'error'); }
    }

    // Relist: restore board to marketplace
    async function doRelistBoard(boardId) {
      try {
        const res = await fetch(`/api/boards/${boardId}/relist`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast('Planche remise en ligne ✓', 'success');
        loadProfileTab('listings');
      } catch(e) { toast('Impossible de remettre la planche en ligne', 'error'); }
    }

    // Delete: check active bookings first, then show confirmation modal
    async function confirmDeleteBoard(boardId, boardTitle) {
      try {
        // can-delete is a lightweight check — does not delete, just checks bookings
        const res = await fetch(`/api/boards/${boardId}/can-delete`);
        if (!res.ok) { toast('Planche introuvable', 'error'); return; }
        const data = await res.json();

        if (!data.canDelete) {
          toast(`Impossible de supprimer : ${data.activeBookings} réservation(s) en cours`, 'error');
          return;
        }

        // No active bookings — show confirmation modal before actual deletion
        showBoardConfirm(
          '⚠️ Supprimer définitivement ?',
          'Cette action est irréversible. Tes photos, avis et historique seront perdus.',
          'Oui, supprimer',
          'var(--red)',
          () => doDeleteBoard(boardId)
        );
      } catch(e) { toast('Impossible de supprimer la planche', 'error'); }
    }

    async function doDeleteBoard(boardId) {
      try {
        const res = await fetch(`/api/boards/${boardId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json();
          toast(data.error || 'Impossible de supprimer la planche', 'error');
          return;
        }
        toast('Planche supprimée définitivement', 'success');
        loadProfileTab('listings');
      } catch(e) { toast('Impossible de supprimer la planche', 'error'); }
    }

    // Generic confirmation modal helper
    function showBoardConfirm(title, msg, btnLabel, btnColor, onConfirm) {
      document.getElementById('board-confirm-title').textContent = title;
      document.getElementById('board-confirm-msg').textContent = msg;
      const btn = document.getElementById('board-confirm-btn');
      btn.textContent = btnLabel;
      btn.style.background = btnColor;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '...';
        await onConfirm();
        btn.disabled = false;
        closeModal('board-confirm-modal');
      });
      openModal('board-confirm-modal');
    }

    async function doLogout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      currentUser = null;
      if (msgPollInterval) { clearInterval(msgPollInterval); msgPollInterval = null; }
      updateNavAuth();
      closeModal('profile-modal');
      toast('Déconnecté', 'success');
    }

    // ==================== MESSAGING ====================
    async function openConversation(bookingId) {
      currentConversationBookingId = bookingId;
      const content = document.getElementById('profile-tab-content');
      content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);">Chargement...</div>`;

      try {
        const res = await fetch(`/api/messages/${bookingId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const { messages, booking } = data;
        const otherName = currentUser.id === booking.renter_id ? booking.host_name : booking.renter_name;
        const otherInitial = otherName ? otherName[0] : '?';
        const statusLabels = { pending:'en attente', confirmed:'confirmé', completed:'terminé', cancelled:'annulé' };
        const statusColors = { pending:'#fbbf24', confirmed:'#4ade80', completed:'#60a5fa', cancelled:'#ff6b6b' };
        const sc = statusColors[booking.status] || '#aaa';
        const sl = statusLabels[booking.status] || booking.status;

        content.innerHTML = `
          <div class="chat-header">
            <button class="chat-back" data-action="switchProfileTab" data-args="'messages'%2C%20document.querySelector('.tabs%20.tab%3Anth-child(3)')">&#8592;</button>
            <div class="avatar avatar-lg" style="width:38px;height:38px;font-size:0.85rem;">${booking.other_user_avatar ? `<img src="${booking.other_user_avatar}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">` : otherInitial}</div>
            <div>
              <div style="font-weight:700;font-size:0.9rem;">${otherName}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);">🏄 ${booking.board_title}</div>
            </div>
            <div style="margin-left:auto;">
              <span style="font-size:0.65rem;padding:0.12rem 0.4rem;border-radius:100px;background:${sc}18;color:${sc};border:1px solid ${sc}30;">${sl}</span>
            </div>
          </div>
          <div class="booking-context-bar">
            📅 ${new Date(booking.start_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} – ${new Date(booking.end_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}
            &nbsp;·&nbsp; €${(booking.total_cents/100).toFixed(0)}
          </div>
          <div class="chat-messages" id="chat-messages-list">${renderBubbles(messages)}</div>
          <div class="chat-input-row">
            <textarea class="chat-input" id="chat-input" placeholder="Ton message..." rows="1" maxlength="500"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage(${bookingId});}"></textarea>
            <button class="chat-send-btn" id="chat-send-btn" data-action="sendChatMessage" data-args="%24%7BbookingId%7D">&#9654;</button>
          </div>
        `;

        // Auto-scroll to bottom
        const chatList = document.getElementById('chat-messages-list');
        if (chatList) chatList.scrollTop = chatList.scrollHeight;

        // Mark as read
        fetch(`/api/messages/${bookingId}/read`, { method: 'POST' }).then(() => refreshMsgBadge());

      } catch(e) {
        content.innerHTML = `<p style="color:var(--red);">Impossible de charger la conversation</p>`;
      }
    }

    function renderBubbles(messages) {
      if (!messages || messages.length === 0) {
        return `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.82rem;">Commencez la conversation !</div>`;
      }
      return messages.map(m => {
        const mine = m.sender_id === currentUser.id;
        const time = formatMsgTime(m.created_at);
        return `<div class="bubble-row${mine ? ' mine' : ''}">
          ${!mine ? `<div class="avatar" style="width:22px;height:22px;font-size:0.6rem;flex-shrink:0;">${m.sender_avatar ? `<img src="${m.sender_avatar}" loading="lazy">` : m.sender_name[0]}</div>` : ''}
          <div class="bubble${mine ? ' mine' : ' theirs'}">${escapeHtml(m.content)}</div>
          <div class="bubble-time">${time}</div>
        </div>`;
      }).join('');
    }

    async function sendChatMessage(bookingId) {
      const input = document.getElementById('chat-input');
      const btn = document.getElementById('chat-send-btn');
      const content = input ? input.value.trim() : '';
      if (!content) return;

      input.disabled = true;
      btn.disabled = true;

      try {
        const res = await fetch(`/api/messages/${bookingId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (!res.ok) { toast(data.error || 'Envoi échoué', 'error'); return; }

        input.value = '';
        // Append the new bubble immediately
        const chatList = document.getElementById('chat-messages-list');
        if (chatList) {
          const newBubble = document.createElement('div');
          newBubble.innerHTML = renderBubbles([{ ...data.message, sender_name: currentUser.name }]);
          chatList.appendChild(newBubble.firstElementChild);
          chatList.scrollTop = chatList.scrollHeight;
        }
      } catch(e) {
        toast('Impossible d\'envoyer le message', 'error');
      } finally {
        if (input) input.disabled = false;
        if (btn) btn.disabled = false;
        if (input) input.focus();
      }
    }

    function formatMsgTime(iso) {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      const diffH = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffMin < 1) return 'à l\'instant';
      if (diffMin < 60) return `il y a ${diffMin}min`;
      if (diffH < 24) return `il y a ${diffH}h`;
      if (diffDays < 7) return `il y a ${diffDays}j`;
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }

    function escapeHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    async function refreshMsgBadge() {
      if (!currentUser) return;
      try {
        const res = await fetch('/api/messages/unread');
        const data = await res.json();
        const count = data.count || 0;

        // Nav badge
        const navBadge = document.getElementById('nav-msg-badge');
        if (navBadge) {
          if (count > 0) { navBadge.textContent = count > 9 ? '9+' : count; navBadge.style.display = 'inline-flex'; }
          else { navBadge.style.display = 'none'; }
        }
        // Profile tab badge
        const profileBadge = document.getElementById('profile-msg-badge');
        if (profileBadge) {
          if (count > 0) { profileBadge.textContent = count > 9 ? '9+' : count; profileBadge.style.display = 'inline-flex'; }
          else { profileBadge.style.display = 'none'; }
        }
      } catch(_) { /* non-fatal */ }
    }

    function startMsgBadgePoll() {
      refreshMsgBadge();
      if (msgPollInterval) clearInterval(msgPollInterval);
      // Poll every 30 seconds — MVP without websockets
      msgPollInterval = setInterval(refreshMsgBadge, 30000);
    }

    // ==================== FILTER ====================
    function setTypeFilter(el, type) {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('search-type').value = type;
      loadBoards();
    }

    // ==================== SPOT AUTOCOMPLETE (SEARCH) ====================
    function onSpotInput(val) {
      clearTimeout(spotAcTimeout);
      const ac = document.getElementById('spot-autocomplete');

      // Show all spots on empty input
      if (!val || val.length < 1) {
        const results = allSpots.slice(0, 10);
        renderSpotDropdown(ac, results, 'spot-search-input');
        return;
      }

      spotAcTimeout = setTimeout(async () => {
        try {
          const r = await fetch(`/api/spots/search?q=${encodeURIComponent(val)}`);
          const d = await r.json();
          renderSpotDropdown(ac, d.spots || [], 'spot-search-input');
        } catch(_) {}
      }, 180);
    }

    function renderSpotDropdown(container, spots, inputId) {
      if (!spots.length) { container.style.display = 'none'; return; }
      const waveLabels = { beach: 'beach break', reef: 'reef break', point: 'point break' };
      const levelLabels = { beginner: 'débutant', intermediate: 'intermédiaire', advanced: 'avancé', all: 'tous niveaux' };
      container.innerHTML = spots.map(s => {
        const cnt = parseInt(s.board_count) || 0;
        return `<div class="spot-ac-item" data-action="selectSpot" data-id="${s.id}" data-name="${encodeURIComponent(s.name)}" data-lat="${s.latitude}" data-lng="${s.longitude}" data-input-id="${inputId}">
          <span style="font-size:1.1rem;">🏄</span>
          <div style="flex:1;min-width:0;">
            <div class="spot-ac-name">${escapeHtml(s.name)}</div>
            <div class="spot-ac-meta">
              <span>${s.region}</span>
              <span class="spot-ac-badge">${waveLabels[s.wave_type] || s.wave_type}</span>
              <span class="spot-ac-badge" style="background:rgba(180,120,60,0.08);color:#a07040;">${levelLabels[s.level] || s.level}</span>
              ${cnt > 0 ? `<span class="spot-ac-count">${cnt} board${cnt > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');
      container.style.display = 'block';
    }

    function selectSpotFromInput(id, name, lat, lng, inputId) {
      const spot = allSpots.find(s => s.id === id) || { id, name, latitude: lat, longitude: lng };
      if (inputId === 'spot-search-input') {
        selectSpot(spot, true);
      } else {
        // Listing form
        document.getElementById('list-spot-input').value = name;
        document.getElementById('list-spot-id').value = id;
        document.getElementById('list-spot-autocomplete').style.display = 'none';
      }
    }

    function selectSpot(spot, triggerLoad) {
      document.getElementById('selected-spot-id').value = spot.id;
      document.getElementById('selected-spot-lat').value = spot.latitude;
      document.getElementById('selected-spot-lng').value = spot.longitude;
      document.getElementById('selected-spot-name').value = spot.name;
      document.getElementById('spot-search-input').value = spot.name;
      document.getElementById('spot-autocomplete').style.display = 'none';

      // Update hero title
      const regionEl = document.getElementById('region-name');
      if (regionEl) regionEl.textContent = spot.name;

      // Pan map if initialized
      if (leafletMap) {
        leafletMap.setView([spot.latitude, spot.longitude], 13, { animate: true });
      }

      // Fetch Failure Atlas risk warning for this spot
      showSpotRiskWarning(spot.id);

      if (triggerLoad) loadBoards();
    }

    function clearSpotFilter() {
      document.getElementById('selected-spot-id').value = '';
      document.getElementById('selected-spot-lat').value = '';
      document.getElementById('selected-spot-lng').value = '';
      document.getElementById('selected-spot-name').value = '';
      document.getElementById('spot-search-input').value = '';
      document.getElementById('region-name').textContent = 'tous les spots';
      if (leafletMap) leafletMap.setView([43.620, -1.470], 10, { animate: true });
      hideSpotRiskWarning();
      loadBoards();
    }

    // Failure Atlas — fetch spot risk and inject risk badge into search-hero
    function hideSpotRiskWarning() {
      const banner = document.getElementById('spot-risk-banner');
      if (!banner) return;
      banner.textContent = '';
      banner.className = '';
    }

    async function showSpotRiskWarning(spotId) {
      const banner = document.getElementById('spot-risk-banner');
      if (!banner) return;
      hideSpotRiskWarning();

      try {
        const res = await fetch(`/api/intelligence/failure-atlas/spot/${spotId}`);
        if (!res.ok) return;
        const data = await res.json();
        const primary = data.primary_zone;
        const multiplier = primary?.damage_multiplier ?? 1.0;

        let text = '';
        let cls = '';
        if (multiplier >= 2.0) {
          text = '🔴 Spot expert uniquement — risque de casse élevé';
          cls = 'risk-high';
        } else if (multiplier >= 1.8) {
          text = '⚠️ Spot technique — planches EPS recommandées';
          cls = 'risk-medium';
        } else if (multiplier <= 0.8) {
          text = '✅ Spot débutant — idéal pour toutes planches';
          cls = 'risk-low';
        }

        if (!text) return;

        // Use createElement as required — never innerHTML with API data
        banner.textContent = text;
        banner.className = cls;
      } catch (_) {
        // Fail silently — no badge if API unavailable
      }
    }

    // ==================== SPOT AUTOCOMPLETE (LISTING FORM) ====================
    function onListSpotInput(val) {
      clearTimeout(listSpotAcTimeout);
      const ac = document.getElementById('list-spot-autocomplete');
      if (!ac) return;

      // Clear spot id when user types
      document.getElementById('list-spot-id').value = '';

      if (!val || val.length < 1) {
        const results = allSpots.slice(0, 8);
        renderListSpotDropdown(ac, results);
        return;
      }

      listSpotAcTimeout = setTimeout(async () => {
        try {
          const r = await fetch(`/api/spots/search?q=${encodeURIComponent(val)}`);
          const d = await r.json();
          renderListSpotDropdown(ac, d.spots || []);
        } catch(_) {}
      }, 180);
    }

    function renderListSpotDropdown(container, spots) {
      if (!spots.length) { container.style.display = 'none'; return; }
      const waveLabels = { beach: 'beach break', reef: 'reef break', point: 'point break' };
      container.innerHTML = spots.map(s => {
        return `<div class="spot-ac-item" data-action="selectSpot" data-id="${s.id}" data-name="${encodeURIComponent(s.name)}" data-lat="${s.latitude}" data-lng="${s.longitude}" data-input-id="list-spot-input">
          <span style="font-size:1rem;">🏄</span>
          <div>
            <div class="spot-ac-name">${escapeHtml(s.name)}</div>
            <div class="spot-ac-meta"><span>${s.region}</span> <span class="spot-ac-badge">${waveLabels[s.wave_type] || s.wave_type}</span></div>
          </div>
        </div>`;
      }).join('');
      container.style.display = 'block';
    }

    async function detectNearestSpot() {
      if (!navigator.geolocation) { toast('Géolocalisation non supportée', 'error'); return; }
      toast('Détection de ta position...', 'success');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const r = await fetch(`/api/spots/nearest?lat=${latitude}&lng=${longitude}`);
          const d = await r.json();
          if (d.spot) {
            document.getElementById('list-spot-input').value = d.spot.name;
            document.getElementById('list-spot-id').value = d.spot.id;
            toast(`Spot détecté : ${d.spot.name}`, 'success');
          }
        } catch(_) { toast('Impossible de trouver le spot le plus proche', 'error'); }
      }, () => toast('Accès à la localisation refusé', 'error'));
    }

    // ==================== VIEW ====================
    function setView(view, el) {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('grid-view').style.display = view === 'grid' ? 'block' : 'none';
      document.getElementById('map-view').className = 'map-container' + (view === 'map' ? ' visible' : '');

      if (view === 'map') {
        // Lazy-load Leaflet JS on first map open
        if (!window.L) {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => {
            initLeafletMap();
            updateBoardMarkers(allBoards);
          };
          document.head.appendChild(script);
        } else {
          initLeafletMap();
          updateBoardMarkers(allBoards);
          setTimeout(() => leafletMap && leafletMap.invalidateSize(), 150);
        }
      }
    }

    // ==================== MODAL ====================
    function openModal(id) {
      document.getElementById(id).classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeModal(id) {
      document.getElementById(id).classList.remove('open');
      document.body.style.overflow = '';
    }

    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
        document.body.style.overflow = '';
      }
    });

    // ==================== TOAST ====================
    function toast(msg, type = 'success') {
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.textContent = msg;
      container.appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }

    // ==================== HELPERS ====================
    function loadingSkeleton() {
      return [1,2,3,4,5,6].map(() => `
        <div class="skeleton">
          <div class="skeleton-img"></div>
          <div class="skeleton-info-block">
            <div class="skeleton-line" style="height:14px;width:70%;"></div>
            <div class="skeleton-line" style="height:11px;width:50%;"></div>
            <div class="skeleton-host-row">
              <div class="skeleton-avatar"></div>
              <div class="skeleton-line" style="height:10px;width:40%;margin-bottom:0;"></div>
            </div>
          </div>
        </div>`).join('');
    }

    // ==================== REVIEWS ====================
    let reviewPickedRating = 0;
    let reviewCurrentBookingId = null;
    let reviewCurrentRole = null;

    // Open the review modal for a given booking
    async function openReviewModal(bookingId) {
      reviewCurrentBookingId = bookingId;
      reviewPickedRating = 0;
      const body = document.getElementById('review-modal-body');
      body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Chargement...</div>';
      openModal('review-modal');

      try {
        const res = await fetch(`/api/reviews/status/${bookingId}`);
        const data = await res.json();
        if (!res.ok) { body.innerHTML = `<p style="color:var(--red);">${data.error}</p>`; return; }

        if (data.alreadyReviewed) {
          body.innerHTML = `
            <div style="text-align:center;padding:1.5rem 0;">
              <div style="font-size:2.5rem;margin-bottom:0.75rem;">✓</div>
              <p style="font-weight:600;margin-bottom:0.5rem;">Avis enregistré !</p>
              <p style="font-size:0.85rem;color:var(--text-muted);">
                ${data.published ? 'Les deux avis sont publiés.' : 'Ton avis sera publié dès que l\'autre partie aura noté (ou dans 7 jours).'}
              </p>
              <button class="btn btn-outline" style="margin-top:1.2rem;" data-action="closeModal" data-arg="review-modal">Fermer</button>
            </div>`;
          return;
        }

        reviewCurrentRole = data.role;
        const isRenter = data.role === 'renter';
        const criteriaLabels = isRenter
          ? ['État de la board', 'Réactivité du host', 'Facilité de remise']
          : ['Soin de la board', 'Ponctualité', 'Communication'];

        body.innerHTML = `
          <p style="font-size:0.85rem;color:var(--text-muted);text-align:center;margin-bottom:1rem;">
            ${isRenter ? 'Comment était ta location ?' : 'Comment s\'est comporté(e) le locataire ?'}
          </p>
          <div class="star-picker" id="review-star-picker">
            ${[1,2,3,4,5].map(n => `<button class="star-btn" data-val="${n}" data-action="pickStar" data-args="%24%7Bn%7D">☆</button>`).join('')}
          </div>
          <p style="font-size:0.72rem;color:var(--text-muted);text-align:center;margin-bottom:0.75rem;">Tap pour noter</p>
          <div class="review-sublabels" id="review-criteria">
            ${criteriaLabels.map(l => `<span class="review-sublabel" data-action="toggleCriteria" data-arg="this">${l}</span>`).join('')}
          </div>
          <div class="form-group" style="margin-top:0.5rem;">
            <label class="form-label">Commentaire <span style="color:var(--text-muted);font-weight:400;">(min. 10 caractères)</span></label>
            <textarea id="review-comment" class="form-textarea" placeholder="Raconte ton expérience..." maxlength="300" rows="3" style="resize:none;" oninput="updateReviewCharCount(this)"></textarea>
            <div id="review-char-count" style="font-size:0.68rem;color:var(--text-muted);text-align:right;margin-top:0.2rem;">0 / 300</div>
          </div>
          <div id="review-error" class="form-error" style="display:none;margin-bottom:0.6rem;"></div>
          <button class="btn btn-primary" style="width:100%;justify-content:center;" data-action="submitReview">Envoyer mon avis</button>
          <div class="review-pending-note">
            🔒 Double aveugle : tu ne verras pas la note de l'autre avant d'avoir soumis la tienne — et inversement. Les avis sont publiés simultanément.
          </div>
        `;
      } catch(e) {
        body.innerHTML = `<p style="color:var(--red);">Impossible de charger le formulaire</p>`;
      }
    }

    function pickStar(n) {
      reviewPickedRating = n;
      document.querySelectorAll('#review-star-picker .star-btn').forEach((btn, i) => {
        btn.textContent = i < n ? '★' : '☆';
        btn.classList.toggle('filled', i < n);
      });
    }

    function toggleCriteria(el) {
      el.classList.toggle('active');
    }

    function updateReviewCharCount(el) {
      const count = el.value.length;
      document.getElementById('review-char-count').textContent = `${count} / 300`;
    }

    async function submitReview() {
      const errEl = document.getElementById('review-error');
      errEl.style.display = 'none';

      if (!reviewPickedRating) {
        errEl.textContent = 'Choisis une note (1-5 étoiles)';
        errEl.style.display = 'block';
        return;
      }

      const comment = (document.getElementById('review-comment')?.value || '').trim();
      if (comment && comment.length < 10) {
        errEl.textContent = 'Le commentaire doit faire au moins 10 caractères (ou laisse-le vide)';
        errEl.style.display = 'block';
        return;
      }

      // Collect selected criteria as ratingDetails
      const selectedCriteria = [];
      document.querySelectorAll('#review-criteria .review-sublabel.active').forEach(el => {
        selectedCriteria.push(el.textContent.trim());
      });

      const btn = document.querySelector('#review-modal-body .btn-primary');
      if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }

      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: reviewCurrentBookingId,
            rating: reviewPickedRating,
            ratingDetails: { criteria: selectedCriteria },
            comment: comment || null,
          })
        });
        const data = await res.json();

        if (!res.ok) {
          errEl.textContent = data.error || 'Impossible d\'envoyer l\'avis';
          errEl.style.display = 'block';
          if (btn) { btn.disabled = false; btn.textContent = 'Envoyer mon avis'; }
          return;
        }

        // Success
        closeModal('review-modal');
        toast(data.published ? '⭐ Avis publié — merci !' : '⭐ Avis enregistré — sera publié après notation mutuelle', 'success');

        // Refresh whichever dashboard tab is visible
        const activeTab = document.querySelector('.tabs .tab.active');
        if (activeTab) {
          const tabText = activeTab.textContent.trim();
          if (tabText.startsWith('Mes voyages')) loadProfileTab('bookings');
          else if (tabText.startsWith('Demandes')) loadProfileTab('host-bookings');
        }
      } catch(e) {
        errEl.textContent = 'Erreur réseau. Réessaie.';
        errEl.style.display = 'block';
        if (btn) { btn.disabled = false; btn.textContent = 'Envoyer mon avis'; }
      }
    }

    // ==================== INSPECTIONS CHECK-IN / CHECK-OUT ====================
    let inspectionCurrentBookingId = null;

    const INSPECTION_ANGLES = [
      { key: 'face',   label: 'Face', hint: 'Nose vers le haut, planche entière visible' },
      { key: 'dos',    label: 'Dos',  hint: 'Dérives visibles' },
      { key: 'rail',   label: 'Rail', hint: 'Profil gauche ou droit' },
      { key: 'detail', label: 'Détail', hint: 'Dings, réparations, défauts existants' },
    ];

    async function openInspectionModal(bookingId) {
      inspectionCurrentBookingId = bookingId;
      const body = document.getElementById('inspection-modal-body');
      body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Chargement...</div>';
      openModal('inspection-modal');

      try {
        const res = await fetch(`/api/inspections/${bookingId}/summary`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderInspectionSummary(data);
      } catch(e) {
        body.innerHTML = `<p style="color:var(--red);">Impossible de charger les inspections</p>`;
      }
    }

    function renderInspectionSummary(data) {
      const body = document.getElementById('inspection-modal-body');
      const title = document.getElementById('inspection-modal-title');

      const renderPhase = (phase, phaseData, label, isRenter) => {
        const mine = phaseData.my_submission;
        const hasMyPhotos = mine && mine.photos && mine.photos.length > 0;
        const isMyConfirmed = mine && mine.confirmed_at;
        const bothConfirmed = phaseData.both_confirmed;
        const totalSubmissions = parseInt(phaseData.total_submissions);
        const totalConfirmed = parseInt(phaseData.total_confirmed);
        const otherSubmitted = totalSubmissions >= 2 || (totalSubmissions >= 1 && !hasMyPhotos);

        // Guidance text by role
        const guidance = isRenter
          ? (phase === 'check_in'
              ? 'Documente l\u2019état de la planche avant de partir. Tes photos protègent en cas de litige.'
              : 'Documente l\u2019état au retour. Compare avec les photos check-in pour détecter un dommage.')
          : (phase === 'check_in'
              ? 'Vérifie l\u2019état avec le locataire avant le départ. Photo de chaque côté = preuve mutuelle.'
              : 'Compare l\u2019état au retour avec les photos check-in. Confirme pour libérer la caution.');

        let content = `<div style="background:var(--surface);border-radius:var(--radius);border:1px solid ${bothConfirmed ? 'var(--green-border)' : 'var(--border)'};padding:1rem;margin-bottom:0.9rem;">`;
        content += `<div style="font-weight:700;font-size:0.9rem;margin-bottom:0.35rem;">${label}</div>`;

        // Status badge
        if (bothConfirmed) {
          content += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
            <span style="font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:100px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);font-weight:600;">✓ Clôturé</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${totalConfirmed}/2 confirmations</span>
          </div>`;
          content += `<div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.6rem;">${guidance}</div>`;
          if (mine && mine.photos && mine.photos.length > 0) {
            content += `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">${mine.photos.map(url => `<img src="${url}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" loading="lazy">`).join('')}</div>`;
          }
        } else if (hasMyPhotos) {
          content += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;">
            <span style="font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:100px;background:rgba(255,107,53,0.1);color:var(--sunset);border:1px solid rgba(255,107,53,0.25);font-weight:600;">En cours</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${totalSubmissions}/2 soumissions</span>
          </div>`;
          content += `<div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.5rem;">${guidance}</div>`;
          content += `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.6rem;">${mine.photos.map(url => `<img src="${url}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" loading="lazy">`).join('')}</div>`;
          if (otherSubmitted && !isMyConfirmed) {
            content += `<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.5rem;">L'autre partie a soumise ses photos — confirme quand tu es prêt.</div>`;
          }
          if (!isMyConfirmed) {
            content += `<button class="btn btn-primary" style="font-size:0.8rem;padding:0.45rem 1rem;" data-action="confirmInspection" data-arg="${phase}">✅ Confirmer l'état</button>`;
          } else {
            content += `<div style="font-size:0.8rem;color:var(--primary);font-weight:600;">✓ Confirmé — en attente de l'autre partie</div>`;
          }
        } else {
          content += `<div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.7rem;line-height:1.5;">${guidance}</div>`;
          content += `<button class="btn btn-primary" style="font-size:0.82rem;padding:0.5rem 1rem;" data-action="openPhotoFlow" data-arg="${phase}">📸 Prendre les photos</button>`;
        }

        content += `</div>`;
        return content;
      };

      const isRenter = data.role === 'renter';
      title.textContent = isRenter ? '📸 État de la planche' : '📸 État de la planche — Host';

      body.innerHTML = `
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.9rem;line-height:1.5;">
          Ces photos horodatées protègent les deux parties en cas de litige. Immuables une fois soumises.
        </p>
        ${renderPhase('check_in', data.check_in, '🏄 Check-in — Début de location', isRenter)}
        ${renderPhase('check_out', data.check_out, '🔙 Check-out — Retour de la planche', isRenter)}
        <button class="btn btn-outline" style="width:100%;justify-content:center;font-size:0.82rem;" data-action="closeModal" data-arg="inspection-modal">Fermer</button>
      `;

      // Store role for photo flow
      body.dataset.role = data.role;
    }

    // Photo capture flow — shown in same modal body
    let inspectionPhotoFiles = [];
    let inspectionPhaseActive = null;

    function openPhotoFlow(phase) {
      inspectionPhaseActive = phase;
      inspectionPhotoFiles = [];
      const body = document.getElementById('inspection-modal-body');
      const phaseLabel = phase === 'check_in' ? 'Check-in' : 'Check-out';

      body.innerHTML = `
        <p style="font-size:0.82rem;font-weight:600;color:var(--text);margin-bottom:0.25rem;">${phaseLabel} — 4 photos guidées</p>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.9rem;">Prends une photo par angle. Compression auto appliquée.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.9rem;">
          ${INSPECTION_ANGLES.map((a, i) => `
            <label style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:0.35rem;padding:0.65rem;background:var(--surface);border:2px dashed var(--border);border-radius:var(--radius-sm);transition:border-color 0.2s;" id="angle-zone-${i}">
              <div id="angle-thumb-${i}" style="width:100%;height:80px;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden;background:var(--card);">
                <span style="font-size:1.6rem;">📷</span>
              </div>
              <span style="font-size:0.72rem;font-weight:600;color:var(--text);">${a.label}</span>
              <span style="font-size:0.65rem;color:var(--text-muted);text-align:center;">${a.hint}</span>
              <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="handleAnglePhoto(${i}, this)">
            </label>
          `).join('')}
        </div>

        <div id="inspection-photo-count" style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.6rem;text-align:center;">0 / 4 photos</div>

        <div style="display:flex;gap:0.6rem;">
          <button class="btn btn-outline" style="flex:1;justify-content:center;font-size:0.82rem;" data-action="openInspectionModal" data-arg="inspectionCurrentBookingId">Retour</button>
          <button class="btn btn-primary" id="inspection-submit-btn" style="flex:1;justify-content:center;font-size:0.82rem;" data-action="submitInspectionPhotos" disabled>Soumettre</button>
        </div>
        <p style="font-size:0.7rem;color:var(--text-muted);margin-top:0.5rem;text-align:center;">Photos immuables après soumission · Horodatées automatiquement</p>
      `;
    }

    function handleAnglePhoto(index, input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];

      // Client-side size guard (max 5MB — compress in-browser before upload)
      if (file.size > 5 * 1024 * 1024) {
        toast('Photo trop lourde — max 5MB', 'error');
        input.value = '';
        return;
      }

      // Compress to max ~800px using canvas
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 1024;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            inspectionPhotoFiles[index] = new File([blob], file.name, { type: 'image/jpeg' });

            // Update thumb
            const thumb = document.getElementById(`angle-thumb-${index}`);
            const zone = document.getElementById(`angle-zone-${index}`);
            const url = URL.createObjectURL(blob);
            if (thumb) thumb.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
            if (zone) zone.style.borderColor = 'var(--primary)';

            // Update count
            const count = inspectionPhotoFiles.filter(Boolean).length;
            const countEl = document.getElementById('inspection-photo-count');
            if (countEl) countEl.textContent = `${count} / 4 photos`;

            // Enable submit if at least 1 photo
            const submitBtn = document.getElementById('inspection-submit-btn');
            if (submitBtn) submitBtn.disabled = count === 0;
          }, 'image/jpeg', 0.82);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    async function submitInspectionPhotos() {
      const photos = inspectionPhotoFiles.filter(Boolean);
      if (photos.length === 0) { toast('Prends au moins une photo', 'error'); return; }

      const btn = document.getElementById('inspection-submit-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }

      try {
        // Capture geolocation (best effort, non-blocking)
        let latitude = null, longitude = null;
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch(_) { /* geolocation optional */ }

        const formData = new FormData();
        photos.forEach(f => formData.append('photos', f));
        if (latitude) formData.append('latitude', latitude);
        if (longitude) formData.append('longitude', longitude);

        const res = await fetch(`/api/inspections/${inspectionCurrentBookingId}/${inspectionPhaseActive}/photos`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Impossible de soumettre les photos', 'error');
          if (btn) { btn.disabled = false; btn.textContent = 'Soumettre'; }
          return;
        }

        toast('📸 Photos soumises !', 'success');
        // Go back to summary
        openInspectionModal(inspectionCurrentBookingId);
      } catch(e) {
        toast('Erreur réseau. Réessaie.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Soumettre'; }
      }
    }

    async function confirmInspection(phase) {
      try {
        const res = await fetch(`/api/inspections/${inspectionCurrentBookingId}/${phase}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (!res.ok) { toast(data.error || 'Impossible de confirmer', 'error'); return; }
        const msg = data.both_confirmed ? '✅ Les deux parties ont confirmé !' : '✅ Confirmation enregistrée — en attente de l\'autre partie';
        toast(msg, 'success');
        openInspectionModal(inspectionCurrentBookingId);
      } catch(e) {
        toast('Erreur réseau. Réessaie.', 'error');
      }
    }

    // ==================== DELEGATED CLICK HANDLER ====================
    // Routes clicks from data-action attributes (replacing inline onclick).
    // Supports: data-action, data-arg (single string/number), data-val (preset value),
    // data-args (URL-encoded JSON array for multi/complex args).
    document.addEventListener('click', (e) => {
      // Handle tracking-only elements (data-track attribute, no data-action)
      const trackTarget = e.target.closest('[data-track]');
      if (trackTarget) {
        const eventName = trackTarget.dataset.track;
        const boardId = parseInt(trackTarget.dataset.trackBoardId || trackTarget.dataset.boardId, 10);
        if (eventName && boardId) trackBoardEvent(eventName, boardId);
      }

      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;
      const arg = target.dataset.arg;
      const val = target.dataset.val;
      const argsEncoded = target.dataset.args;

      // Decode multi-arg JSON if present
      let args = [];
      if (argsEncoded) {
        try { args = JSON.parse(decodeURIComponent(argsEncoded)); } catch {}
      }

      // Route based on action name
      switch (action) {
        // ── Modal / UI ──────────────────────────────────
        case 'closeModal': closeModal(arg); break;
        case 'openModal': openModal(arg); break;
        case 'openListModal': openListModal(); break;
        case 'openKycModal': openKycModal(); break;
        case 'closeEditModal': closeEditModal(); break;
        case 'close-profile-modal': closeModal('profile-modal'); break;

        // ── Auth ───────────────────────────────────────
        case 'open-auth-register': openModal('auth-modal'); switchAuthTab('register'); break;
        case 'open-auth-login': openModal('auth-modal'); switchAuthTab('login'); break;
        case 'doLogin': doLogin(); break;
        case 'doRegister': doRegister(); break;
        case 'doLogout': doLogout(); break;

        // ── Navigation / tabs ───────────────────────────
        case 'switchAuthTab': switchAuthTab(arg); break;
        case 'switchProfileTab': switchProfileTab(arg, target); break;
        case 'loadProfileTab': loadProfileTab(arg); break;
        case 'open-messages':
          openModal('profile-modal');
          switchProfileTab('messages', document.querySelector('.tabs .tab:nth-child(3)'));
          break;
        case 'open-profile-bookings':
          openModal('profile-modal'); loadProfileTab('bookings'); break;
        case 'loadBoards': loadBoards(); break;
        case 'setView': setView(arg, target); break;
        case 'scrollToBookingPanel': {
          const bid = parseInt(target.dataset.boardId, 10);
          if (bid) trackBoardEvent('click_booking_widget', bid);
          scrollToBookingPanel();
          break;
        }

        // ── Board / listings ────────────────────────────
        case 'setTypeFilter': setTypeFilter(target, arg); break;
        case 'openBoardDetail': openBoardDetail(parseInt(arg, 10)); break;
        case 'open-RelatedBoard': {
          const srcId = parseInt(target.dataset.sourceBoardId, 10);
          const rbId = parseInt(target.dataset.boardId, 10);
          if (srcId) trackBoardEvent('click_related_board', srcId, { related_board_id: rbId });
          openBoardDetail(rbId);
          break;
        }
        case 'showBookingRecap': showBookingRecap(parseInt(arg, 10)); break;
        case 'selectSlotPill': selectSlotPill(arg); break;
        case 'openEditModal': openEditModal(parseInt(arg, 10)); break;
        case 'confirmDelistBoard':
          if (args.length >= 2) confirmDelistBoard(args[0], args[1]); break;
        case 'confirmDeleteBoard':
          if (args.length >= 2) confirmDeleteBoard(args[0], args[1]); break;
        case 'doRelistBoard': doRelistBoard(parseInt(arg, 10)); break;

        // ── Wizard ─────────────────────────────────────
        case 'wizSelectType': wizSelectType(target); break;
        case 'wizNext': wizNext(parseInt(arg, 10)); break;
        case 'wizBack': wizBack(); break;
        case 'wizSubmit': wizSubmit(); break;
        case 'wizCopyLink': wizCopyLink(); break;
        case 'wiz-preset':
          if (val) {
            document.getElementById('wiz-hourly-slider').value = val;
            wizState.hourlyRate = parseInt(val, 10);
            const disp = document.getElementById('wiz-hourly-display');
            if (disp) disp.textContent = val;
          }
          break;

        // ── Booking ────────────────────────────────────
        case 'confirmAndPay': confirmAndPay(); break;
        case 'applyPromoCode': applyPromoCode(); break;
        case 'updateBookingStatus':
          if (args.length >= 2) updateBookingStatus(args[0], args[1]); break;
        case 'openReviewModal': openReviewModal(parseInt(arg, 10)); break;
        case 'openInspectionModal': openInspectionModal(parseInt(arg, 10)); break;
        case 'confirmInspection': confirmInspection(arg); break;
        case 'openPhotoFlow': openPhotoFlow(arg); break;
        case 'submitInspectionPhotos': submitInspectionPhotos(); break;
        case 'submitDamageReport':
          if (args.length >= 2) submitDamageReport(args[0], args[1]); break;
        case 'hostReleaseDeposit': hostReleaseDeposit(parseInt(arg, 10)); break;
        case 'hostReportDamage':
          if (args.length >= 2) hostReportDamage(args[0], args[1]); break;

        // ── Calendar ───────────────────────────────────
        case 'renterCalDayClick': renterCalDayClick(arg); break;
        case 'renterCalNav': renterCalNav(parseInt(arg, 10)); break;
        case 'hostCalDayClick':
          if (args.length >= 2) hostCalDayClick(args[0], args[1]); break;
        case 'hostCalNav': hostCalNav(parseInt(arg, 10), arg); break;
        case 'hostCalCancelRange': hostCalCancelRange(arg); break;
        case 'toggleHostBoardCal': toggleHostBoardCal(parseInt(arg, 10)); break;

        // ── Spot selection ──────────────────────────────
        case 'selectSpot':
          selectSpotFromInput(
            parseInt(target.dataset.id, 10),
            decodeURIComponent(target.dataset.name || ''),
            parseFloat(target.dataset.lat),
            parseFloat(target.dataset.lng),
            target.dataset.inputId
          );
          break;

        // ── Messages ───────────────────────────────────
        case 'openConversation': openConversation(parseInt(arg, 10)); break;
        case 'sendChatMessage': sendChatMessage(parseInt(arg, 10)); break;

        // ── Profile / referral ─────────────────────────
        case 'copyReferralLink': copyReferralLink(arg); break;
        case 'shareReferralLink':
          if (args.length >= 2) shareReferralLink(args[0], args[1]); break;

        // ── Review ─────────────────────────────────────
        case 'pickStar': pickStar(parseInt(arg, 10)); break;
        case 'toggleCriteria': toggleCriteria(target); break;
        case 'submitReview': submitReview(); break;

        // ── Photo management ────────────────────────────
        case 'removeEditPhoto': removeEditPhoto(); break;
        case 'removeEditPhotoR': removeEditPhotoR(); break;
        case 'jumpToLightbox': jumpToLightbox(parseInt(arg, 10)); break;

        // ── Wizard ─────────────────────────────────────
        case 'wizRemovePhoto': {
          const idx = parseInt(arg, 10);
          wizState.photoFiles.splice(idx, 1);
          wizRenderPhotos();
          break;
        }

        // ── KYC ────────────────────────────────────────
        case 'kycNextStep': kycNextStep(parseInt(arg, 10)); break;
        case 'kycPrevStep': kycPrevStep(parseInt(arg, 10)); break;
        case 'kycSubmit': kycSubmit(); break;
        case 'kycRetry': kycRetry(); break;
        case 'kyc-trigger-front': document.getElementById('kyc-front-input').click(); break;
        case 'kyc-trigger-back': document.getElementById('kyc-back-input').click(); break;

        // ── Lightbox ───────────────────────────────────
        case 'open-lightbox':
          if (args.length >= 2) openLightbox(args[0], args[1]); break;

        // ── Consent / banner ───────────────────────────
        case 'consent-deny': window.__swellDenyConsent && window.__swellDenyConsent(); break;
        case 'consent-accept': window.__swellAcceptConsent && window.__swellAcceptConsent(); break;
        case 'dismiss-ref-banner': document.getElementById('ref-banner').style.display = 'none'; break;

        // ── PWA ────────────────────────────────────────
        case 'pwa-install': {
          const pi = document.getElementById('pwa-install');
          if (pi && pi.__install) pi.__install(); break;
        }
        case 'pwa-dismiss': target.parentElement && target.parentElement.remove(); break;

        // ── Shield ─────────────────────────────────────
        case 'click-waiver-checkbox': {
          const cb = document.getElementById('waiver-checkbox');
          if (cb) cb.click(); break;
        }

        default: console.warn('[data-action] unknown action:', action);
      }
    });

    // ==================== BUTTON RIPPLE ====================
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px;`;
      btn.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });


