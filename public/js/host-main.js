    // CSRF — inject X-CSRF-Token header on mutating requests
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

    let currentUser = null;

    // ── CHECK AUTH ──
    async function init() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        currentUser = data.user;
      } catch(_) {}

      if (!currentUser) {
        document.getElementById('unauth-state').style.display = 'block';
        return;
      }

      // Update nav
      const navArea = document.getElementById('nav-user-area');
      navArea.innerHTML = `
        <span style="font-size:0.85rem;color:var(--text-secondary);margin-right:0.5rem;">${currentUser.name.split(' ')[0]}</span>
        <a href="/app.html" class="btn btn-outline" style="font-size:0.78rem;padding:0.4rem 0.8rem;">Dashboard complet</a>
      `;

      // Show hub
      document.getElementById('host-hub').style.display = 'block';
      document.getElementById('hub-greeting').textContent = `Salut, ${currentUser.name.split(' ')[0]} 🤙`;

      // Check KYC
      try {
        const identityRes = await fetch('/api/identity/status');
        if (identityRes.ok) {
          const idData = await identityRes.json();
          const status = idData.identity?.identity_status;
          if (status !== 'verified') {
            document.getElementById('kyc-banner').style.display = 'flex';
          }
        }
      } catch(_) {}

      // Check payment status — show urgent banner if Stripe not configured
      try {
        const stripeRes = await fetch('/api/stripe-connect/status');
        if (stripeRes.ok) {
          const stripeData = await stripeRes.json();
          if (!stripeData.chargesEnabled) {
            const banner = document.getElementById('payment-banner');
            banner.style.display = 'flex';
            // Profile progress uses this too — re-render to show step correctly
            renderHostProgress(currentUser);
          }
        }
      } catch(_) {}

      // Load trust metrics (tier + trust score)
      try {
        const metricsRes = await fetch('/api/host-metrics/me');
        if (metricsRes.ok) {
          const { metrics } = await metricsRes.json();
          if (metrics) {
            const trustCard = document.getElementById('trust-stat-card');
            trustCard.style.display = 'block';
            document.getElementById('stat-trust-score').textContent = Math.round(metrics.trust_score || 0);
            const tierLabel = document.getElementById('stat-tier-label');
            const tierConfig = {
              ALPHA_SHAPER: 'Alpha Shaper ✦',
              LOCAL_ICON: 'Local Icon ◆',
              PREMIUM_HOST: 'Premium Host ★',
              GROWTH_HOST: 'Croissant ↗',
              AT_RISK: 'Attention ⚠'
            };
            tierLabel.textContent = tierConfig[metrics.tier] || 'Hôte';
            const trendEl = document.getElementById('stat-trend');
            if (metrics.evolution_trend === 'rising') trendEl.textContent = '↗ En progression';
            else if (metrics.evolution_trend === 'declining') trendEl.textContent = '↘ En déclin';
            else trendEl.textContent = '→ Stable';
          }
        }
      } catch(_) {}

      // Profile completion progress — initial render (board step unresolved yet)
      renderHostProgress(currentUser, null, null);

      // Load boards + bookings
      await Promise.all([loadBoards(), loadBookings()]);
      // Refresh progress now that board count is known
      renderHostProgress(currentUser);
    }

    // Renders host profile progress bar; called after board load to finalize board step
    async function renderHostProgress(user, idStatus, stripeStatus) {
      try {
        const [idRes, stripeRes] = await Promise.all([
          fetch('/api/identity/status').catch(() => null),
          fetch(API.stripeStatus).catch(() => null)
        ]);
        const idData = idRes?.ok ? await idRes.json() : {};
        const stripeData = stripeRes?.ok ? await stripeRes.json() : {};
        const idDone = idData.identity?.identity_status === 'verified';
        const stripeDone = !!(stripeData.stripe_onboarding_completed_at || stripeData.charges_enabled);
        const hasPhoto = !!(user?.avatar_url);
        const statEl = document.getElementById('stat-boards-count');
        const hasBoards = statEl ? parseInt(statEl.textContent) > 0 : false;
        const steps = [
          { label: 'Photo de profil', done: hasPhoto },
          { label: 'Vérification identité', done: idDone },
          { label: 'Coordonnées bancaires', done: stripeDone },
          { label: 'Première planche', done: hasBoards }
        ];
        const done = steps.filter(s => s.done).length;
        const pct = Math.round((done / steps.length) * 100);
        document.getElementById('profile-progress').style.display = 'block';
        document.getElementById('progress-pct').textContent = pct + '%';
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-steps').innerHTML = steps.map(s =>
          `<span class="progress-step ${s.done ? 'done' : 'pending'}">${s.done ? '✓' : '○'} ${s.label}</span>`
        ).join('');
      } catch(_) {}
    }

    async function loadBoards() {
      const container = document.getElementById('boards-list-container');
      try {
        const res = await fetch('/api/boards/my');
        if (!res.ok) throw new Error();
        const data = await res.json();
        const boards = data.boards || [];

        // Update stat
        const listed = boards.filter(b => b.is_listed).length;
        document.getElementById('stat-boards-count').textContent = listed;

        if (boards.length === 0) {
          container.innerHTML = `
            <div class="empty">
              <div class="empty-icon">🏄</div>
              <h3>Aucune planche listée</h3>
              <p>Ajoute ta première planche et commence à gagner de l'argent.</p>
              <a href="/app.html" class="btn btn-primary" style="margin-top:1rem;" onclick="openWizardFromHub(event)">Créer mon annonce →</a>
            </div>`;
          return;
        }

        container.innerHTML = `<div class="boards-list">${boards.map(b => {
          const photo = b.photos?.[0];
          const dailyPrice = (b.daily_price_cents / 100).toFixed(0);
          const hourlyPrice = b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : null;
          const isListed = b.is_listed;
          return `<div class="board-item">
            <div class="board-thumb">${photo ? `<img src="${photo}" alt="${escHtml(b.title)}" loading="lazy">` : '🏄'}</div>
            <div class="board-info" style="cursor:pointer;" onclick="openBoardCalendar(${b.id}, '${b.title.replace(/'/g, "\\'")}')">
              <div class="board-name">${escHtml(b.title)}</div>
              <div class="board-meta-row">
                <span><span class="board-status-dot ${isListed ? 'listed' : 'unlisted'}"></span> ${isListed ? 'Visible' : 'Masquée'}</span>
                ${b.board_type ? `<span>${escHtml(b.board_type)}</span>` : ''}
                ${parseFloat(b.avg_rating) > 0 ? `<span>⭐ ${b.avg_rating}</span>` : ''}
                ${parseInt(b.total_bookings) > 0 ? `<span>📋 ${b.total_bookings} loc.</span>` : ''}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;flex-shrink:0;">
              <div class="board-price">€${hourlyPrice ? hourlyPrice + '/h' : dailyPrice + '/j'}</div>
              <button type="button" class="btn btn-outline" style="font-size:0.68rem;padding:0.3rem 0.65rem;" onclick="openEditModal(event, ${b.id})">✏️ Modifier</button>
            </div>
          </div>`;
        }).join('')}</div>`;
      } catch(_) {
        container.innerHTML = `<div class="empty"><p style="color:var(--red);">Impossible de charger tes planches.</p></div>`;
      }
    }

    async function loadBookings() {
      const container = document.getElementById('bookings-list-container');
      try {
        const res = await fetch('/api/bookings/host');
        if (!res.ok) throw new Error();
        const data = await res.json();
        const bookings = data.bookings || [];

        // Update stats
        document.getElementById('stat-bookings-count').textContent = bookings.length;

        // Revenue = sum of confirmed + completed bookings (before Swell fee)
        const revenue = bookings
          .filter(b => b.status === 'confirmed' || b.status === 'completed')
          .reduce((sum, b) => sum + (b.total_cents || 0), 0);
        const hostRevenue = Math.round(revenue * 0.85); // host gets 85%
        document.getElementById('stat-revenue').textContent = hostRevenue > 0 ? `€${(hostRevenue / 100).toFixed(0)}` : '€0';

        if (bookings.length === 0) {
          container.innerHTML = `
            <div class="empty">
              <div class="empty-icon">📋</div>
              <h3>Aucune demande pour l'instant</h3>
              <p>Les réservations de tes planches apparaîtront ici.</p>
            </div>`;
          return;
        }

        const statusLabels = { pending: 'en attente', confirmed: 'confirmé', completed: 'terminé', cancelled: 'annulé' };
        const statusColors = { pending: '#fbbf24', confirmed: '#4ade80', completed: '#60a5fa', cancelled: '#ff6b6b' };

        container.innerHTML = `<div style="display:flex;flex-direction:column;gap:0.75rem;">${bookings.map(b => {
          const sc = statusColors[b.status] || '#aaa';
          const sl = statusLabels[b.status] || b.status;
          const startDate = new Date(b.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          const isHourly = !!(b.start_time && b.end_time);
          const startTime = b.start_time ? b.start_time.slice(0,5) : '';
          const endTime = b.end_time ? b.end_time.slice(0,5) : '';
          const durationStr = isHourly && b.duration_hours ? `${b.duration_hours}h` : '';
          const endDateStr = isHourly ? startDate : new Date(b.end_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
          const earnings = Math.round((b.total_cents || 0) * 0.85 / 100);
          const totalEur = ((b.total_cents || 0) / 100).toFixed(2);
          const hourlyRate = b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : null;
          return `<div class="booking-item" style="cursor:default;">
            <div class="booking-info">
              <div class="booking-board">${b.board_title || '—'}
                ${durationStr ? ` <span style="font-size:0.72rem;background:var(--primary-soft);color:var(--primary);padding:0.1rem 0.35rem;border-radius:4px;margin-left:0.3rem;">⏱ ${durationStr}</span>` : ''}
                ${isHourly && hourlyRate ? ` <span style="font-size:0.65rem;color:var(--text-muted);">€${hourlyRate}/h</span>` : ''}
              </div>
              <div class="booking-details">
                ${b.renter_name ? `<strong>${b.renter_name}</strong>` : ''}
                ${isHourly
                  ? `<span style="display:inline-flex;align-items:center;gap:0.3rem;margin-top:0.25rem;font-size:0.8rem;">
                       <span style="font-size:0.75rem;">🕐</span> ${startDate} · ${startTime}–${endTime}
                     </span>`
                  : `<span>${startDate} – ${endDateStr}</span>`
                }
                <span style="color:var(--text-muted);font-size:0.68rem;display:block;margin-top:0.15rem;">Client: €${totalEur} · Tu reçois: <strong style="color:var(--green);">€${earnings}</strong></span>
                ${b.promo_code ? `<span style="display:inline-block;margin-top:0.25rem;font-size:0.65rem;background:rgba(255,107,53,0.1);color:var(--sunset);border:1px solid rgba(255,107,53,0.25);border-radius:100px;padding:0.15rem 0.5rem;">🎁 Code de bienvenue utilisé · votre paiement n'est pas impacté</span>` : ''}
              </div>
            </div>
            <div class="booking-amount">
              +€${earnings}
              <div class="booking-status" style="background:${sc}18;color:${sc};border:1px solid ${sc}30;">${sl}</div>
            </div>
            ${b.board_id ? `<button class="btn btn-outline" style="font-size:0.68rem;padding:0.25rem 0.6rem;margin-left:0.5rem;align-self:center;flex-shrink:0;" onclick="openBoardCalendar(${b.board_id}, '${(b.board_title||'').replace(/'/g,"\\'")}')" title="Voir le calendrier">📅</button>` : ''}
          </div>`;
        }).join('')}</div>`;
      } catch(_) {
        container.innerHTML = `<div class="empty"><p style="color:var(--red);">Impossible de charger les réservations.</p></div>`;
      }
    }

    // Open listing wizard in app.html
    function openWizardFromHub(e) {
      e.preventDefault();
      sessionStorage.setItem('swell_host_source', '1');
      window.location.href = '/app.html?source=host';
    }

    // Open Stripe payment setup panel
    function openStripeSetup() {
      // Navigate to app.html with a hash to open the payments tab
      window.location.href = '/app.html?source=host#paiements';
    }

    // ── BOARD CALENDAR (HOURLY SLOT VIEW) ──────────────────────────
    let calState = { boardId: null, boardTitle: '', year: null, month: null, slotsByDate: {} };

    function openBoardCalendar(boardId, boardTitle) {
      calState.boardId = boardId;
      calState.boardTitle = boardTitle;
      const now = new Date();
      calState.year = now.getFullYear();
      calState.month = now.getMonth();
      calState.slotsByDate = {};
      document.getElementById('cal-modal-title').textContent = boardTitle;
      document.getElementById('board-cal-modal').classList.add('open');
      loadCalData();
    }

    function closeCalModal() {
      document.getElementById('board-cal-modal').classList.remove('open');
    }

    // Close on backdrop click
    document.getElementById('board-cal-modal')?.addEventListener('click', function(e) {
      if (e.target === this) closeCalModal();
    });
    // Close on Escape
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeCalModal(); });

    async function loadCalData() {
      const { year, month, boardId } = calState;
      const from = `${year}-${String(month+1).padStart(2,'0')}-01`;
      const last = new Date(year, month+1, 0).getDate();
      const to = `${year}-${String(month+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
      try {
        const res = await fetch(`/api/availability/${boardId}/slots-by-date?from=${from}&to=${to}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        calState.slotsByDate = data.slotsByDate || {};
        renderCal();
      } catch(_) {
        document.getElementById('cal-modal-body').innerHTML = '<p style="color:var(--red);text-align:center;padding:1rem;">Erreur de chargement. Réessaie.</p>';
      }
    }

    function prevCalMonth() {
      if (calState.month === 0) { calState.month = 11; calState.year--; }
      else calState.month--;
      renderCal();
      loadCalData();
    }

    function nextCalMonth() {
      if (calState.month === 11) { calState.month = 0; calState.year++; }
      else calState.month++;
      renderCal();
      loadCalData();
    }

    function renderCal() {
      const { year, month } = calState;
      const FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
      const FR_DAYS = ['Lu','Ma','Me','Je','Ve','Sa','Di'];
      const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
      const daysInMonth = new Date(year, month+1, 0).getDate();
      const today = new Date().toISOString().slice(0,10);
      const todayYear = new Date().getFullYear();
      const todayMonth = new Date().getMonth();

      // Build 4-slot grid: 08:00–12:00, 12:00–16:00, 16:00–20:00, 20:00–22:00
      const SLOT_RANGES = [[8,12],[12,16],[16,20],[20,22]];

      let html = `
        <div class="cal-month-nav">
          <button onclick="prevCalMonth()">← Préc.</button>
          <span class="cal-month-label">${FR_MONTHS[month]} ${year}</span>
          <button onclick="nextCalMonth()">Suiv. →</button>
        </div>
        <div class="cal-hint">Clique sur un créneau vert pour le bloquer — et inversement</div>
        <div class="day-slots-grid">
          <div class="slot-h"></div>
          ${['08–12h','12–16h','16–20h','20–22h'].map(s => `<div class="slot-h">${s}</div>`).join('')}
        </div>`;

      // Generate weeks (Mon–Sun)
      let date = 1;
      const rows = [];
      for (let w = 0; w < 6 && date <= daysInMonth; w++) {
        const weekCells = [];
        for (let d = 0; d < 7; d++) {
          if ((w === 0 && d < firstDay) || date > daysInMonth) {
            weekCells.push(null);
          } else {
            weekCells.push(date++);
          }
        }
        rows.push(weekCells);
      }

      for (const row of rows) {
        if (!row.some(d => d !== null)) continue;
        html += `<div class="slot-day-row">`;
        for (let d = 0; d < 7; d++) {
          const dayNum = row[d];
          if (dayNum === null) {
            html += `<div></div><div></div><div></div><div></div><div></div>`;
          } else {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
            const isPast = dateStr < today;
            const dowLabel = FR_DAYS[d];
            html += `<div class="slot-day-label">${dowLabel} ${dayNum}</div>`;
            for (const [sStart, sEnd] of SLOT_RANGES) {
              const slots = calState.slotsByDate[dateStr] || [];
              // Check if this 4h block overlaps with any available slot (≥2h)
              const isAvailable = slots.some(s => s.start < sEnd && s.end > sStart);
              // For booked/host-blocked: we use the "all occupied" info from slots-by-date
              // A slot range is "booked" if it has no available sub-slot
              const hasConflict = !isAvailable && !isPast;

              const cls = isPast ? 'partial' : (isAvailable ? 'available' : 'booked');
              const label = isPast ? '—' : (isAvailable ? `${sStart}h` : '✕');
              html += `<div class="slot-cell ${cls}"
                data-board="${calState.boardId}"
                data-date="${dateStr}"
                data-start="${sStart}"
                data-end="${sEnd}"
                title="${isPast ? 'Passé' : (isAvailable ? `Libre ${sStart}h–${sEnd}h — clic pour bloquer` : `Occupé — clic pour libérer`)}"
                onclick="${isPast ? '' : `toggleHostSlot(this, ${calState.boardId}, '${dateStr}', ${sStart}, ${sEnd})`}"
              >${label}</div>`;
            }
          }
        }
        html += `</div>`;
      }

      html += `
        <div class="slot-legend">
          <div class="slot-legend-item"><div class="slot-legend-dot available"></div> Libre</div>
          <div class="slot-legend-item"><div class="slot-legend-dot booked"></div> Occupé / Réservé</div>
          <div class="slot-legend-item"><div class="slot-legend-dot blocked"></div> Blocage host</div>
        </div>`;

      document.getElementById('cal-modal-body').innerHTML = html;
    }

    async function toggleHostSlot(el, boardId, date, startHour, endHour) {
      el.style.opacity = '0.5';
      try {
        const res = await fetch(`/api/availability/${boardId}/toggle-slot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, startHour, endHour })
        });
        if (!res.ok) throw new Error();
        const result = await res.json();
        // Refresh data then re-render
        await loadCalData();
        toast(result.blocked ? 'Créneau bloqué' : 'Créneau libéré', 'success');
      } catch(_) {
        el.style.opacity = '';
        toast('Erreur — réessaie', 'error');
      }
    }

    // Toast helper
    function toast(msg, type) {
      const existing = document.getElementById('host-toast');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = 'host-toast';
      const bg = type === 'success' ? 'var(--green)' : (type === 'info' ? 'var(--primary)' : 'var(--red)');
      el.style.cssText = `position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:${bg};color:white;padding:0.55rem 1.2rem;border-radius:100px;font-size:0.82rem;font-weight:600;z-index:2000;box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:opacity 0.3s`;
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2200);
    }

    // ── EDIT BOARD MODAL ──────────────────────────────────────────────────────
    let editState = {
      boardId: null,
      photos: [],       // URLs to keep
      newPhotoFiles: [], // File objects to upload
      loading: false
    };

    const BOARD_TYPES = ['shortboard','longboard','mid-length','fish','funboard','foam','sup','bodyboard'];
    const BOARD_TYPE_LABELS = { shortboard:'Shortboard', longboard:'Longboard', 'mid-length':'Mid-length', fish:'Fish', funboard:'Funboard', foam:'Mousse', sup:'SUP', bodyboard:'Bodyboard' };
    const CONDITIONS = ['like_new','good','fair'];
    const CONDITION_LABELS = { like_new:'Comme neuf', good:'Bon état', fair:'Correct' };

    function openEditModal(e, boardId) {
      e.stopPropagation();
      editState = { boardId, photos: [], newPhotoFiles: [], loading: false };
      document.getElementById('edit-modal-body').innerHTML = '<div class="loading"><div class="spinner"></div> Chargement...</div>';
      document.getElementById('edit-board-modal').classList.add('open');
      loadEditData(boardId);
    }

    function closeEditModal() {
      document.getElementById('edit-board-modal').classList.remove('open');
    }

    document.getElementById('edit-board-modal')?.addEventListener('click', function(e) {
      if (e.target === this) closeEditModal();
    });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeEditModal(); });

    async function loadEditData(boardId) {
      try {
        const res = await fetch(`/api/boards/${boardId}`);
        if (!res.ok) throw new Error();
        const { board } = await res.json();
        editState.photos = board.photos || [];
        editState.boardId = boardId;
        renderEditForm(board);
      } catch(_) {
        document.getElementById('edit-modal-body').innerHTML = '<p style="color:var(--red);text-align:center;padding:2rem;">Erreur de chargement. <button onclick="closeEditModal()" style="display:block;margin:1rem auto;background:none;border:none;color:var(--primary);cursor:pointer;">Fermer</button></p>';
      }
    }

    function renderEditForm(board) {
      const photos = editState.photos;
      const hourlyRate = board.hourly_rate_cents ? (board.hourly_rate_cents / 100) : 8;
      const estimatedVal = board.estimated_value_cents ? (board.estimated_value_cents / 100) : '';

      document.getElementById('edit-modal-body').innerHTML = `
        <form id="edit-board-form" onsubmit="submitEditBoard(event)" novalidate>
          <input type="hidden" name="boardId" value="${board.id}">

          <div class="edit-form-group">
            <label class="edit-label">Titre de l'annonce</label>
            <input type="text" name="title" class="edit-input" value="${escHtml(board.title || '')}" maxlength="80" required placeholder="ex: Fish 5'10 — Hossegor">
          </div>

          <div class="edit-form-group">
            <label class="edit-label">Description</label>
            <textarea name="description" class="edit-input edit-textarea" placeholder="Décris ta planche, son comportement, ce qui la rend unique...">${escHtml(board.description || '')}</textarea>
          </div>

          <div class="edit-row">
            <div class="edit-form-group">
              <label class="edit-label">Type de planche</label>
              <select name="boardType" class="edit-select">
                ${BOARD_TYPES.map(t => `<option value="${t}" ${board.board_type === t ? 'selected' : ''}>${BOARD_TYPE_LABELS[t]}</option>`).join('')}
              </select>
            </div>
            <div class="edit-form-group">
              <label class="edit-label">État</label>
              <select name="condition" class="edit-select">
                ${CONDITIONS.map(c => `<option value="${c}" ${board.condition === c ? 'selected' : ''}>${CONDITION_LABELS[c]}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="edit-row">
            <div class="edit-form-group">
              <label class="edit-label">Taille (pieds)</label>
              <input type="text" name="lengthFt" class="edit-input" value="${escHtml(board.length_ft || '')}" placeholder="ex: 6'2">
            </div>
            <div class="edit-form-group">
              <label class="edit-label">Niveau requis</label>
              <select name="skillLevel" class="edit-select">
                <option value="all" ${(board.skill_level || 'all') === 'all' ? 'selected' : ''}>Tous niveaux</option>
                <option value="beginner" ${board.skill_level === 'beginner' ? 'selected' : ''}>Débutants</option>
                <option value="intermediate" ${board.skill_level === 'intermediate' ? 'selected' : ''}>Intermédiaires</option>
                <option value="advanced" ${board.skill_level === 'advanced' ? 'selected' : ''}>Confirmés</option>
              </select>
            </div>
          </div>

          <div class="edit-section-label">Prix</div>

          <div class="edit-form-group">
            <label class="edit-label">Tarif horaire (€/h)</label>
            <div class="edit-slider-wrap">
              <div class="edit-slider-row">
                <input type="range" name="hourlyRateSlider" id="edit-hourly-slider" min="3" max="30" step="1" value="${Math.round(hourlyRate)}"
                  class="edit-slider"
                  oninput="document.getElementById('edit-hourly-val').textContent = this.value; document.getElementById('edit-hourly-input').value = this.value;">
                <span class="edit-slider-val" id="edit-hourly-val">${Math.round(hourlyRate)}</span>
              </div>
              <input type="hidden" name="hourlyRate" id="edit-hourly-input" value="${Math.round(hourlyRate)}">
              <div class="edit-slider-presets">
                ${[3,5,8,10,15,20].map(v => `<button type="button" class="edit-preset-btn" onclick="document.getElementById('edit-hourly-slider').value=${v};document.getElementById('edit-hourly-val').textContent=${v};document.getElementById('edit-hourly-input').value=${v};">${v}€/h</button>`).join('')}
              </div>
            </div>
          </div>

          <div class="edit-form-group">
            <label class="edit-label">Localisation</label>
            <input type="text" name="location" class="edit-input" value="${escHtml(board.location || '')}" placeholder="Hossegor, France" list="edit-location-list">
            <datalist id="edit-location-list">
              <option value="Hossegor, France"><option value="Seignosse, France"><option value="Capbreton, France">
              <option value="Biarritz, France"><option value="Anglet, France"><option value="Lacanau, France">
              <option value="Montalivet, France"><option value="Biscarrosse, France">
            </datalist>
          </div>

          <div class="edit-section-label">Photos <span style="color:var(--text-muted);font-weight:400;">(min. 3)</span></div>
          <p class="edit-photo-hint">Les photos existantes sont conservées. Ajoute de nouvelles ou supprime celles que tu veux remplacer.</p>
          <div class="edit-photo-grid" id="edit-photo-grid">
            ${photos.map((url, i) => `
              <div class="edit-photo-thumb">
                <img src="${escHtml(url)}" alt="Photo ${i+1}">
                <button type="button" class="edit-photo-remove" onclick="removeEditPhoto(${i})" title="Supprimer">×</button>
              </div>`).join('')}
            <label class="edit-photo-add">
              <span style="font-size:1.2rem;">+</span>
              <span>Ajouter</span>
              <input type="file" accept="image/*" multiple onchange="addEditPhotos(this.files)">
            </label>
          </div>
          <div id="edit-photo-error" class="edit-error"></div>

          <div class="edit-section-label">Accessoires inclus</div>
          <div class="edit-accessories">
            <label class="edit-accessory-btn ${board.fins_included ? 'active' : ''}" onclick="this.classList.toggle('active');this.querySelector('input').checked = !this.querySelector('input').checked">
              <input type="checkbox" name="finsIncluded" value="true" ${board.fins_included ? 'checked' : ''}> Dérives
            </label>
            <label class="edit-accessory-btn ${board.leash_included ? 'active' : ''}" onclick="this.classList.toggle('active');this.querySelector('input').checked = !this.querySelector('input').checked">
              <input type="checkbox" name="leashIncluded" value="true" ${board.leash_included ? 'checked' : ''}> Leash
            </label>
            <label class="edit-accessory-btn ${board.bag_included ? 'active' : ''}" onclick="this.classList.toggle('active');this.querySelector('input').checked = !this.querySelector('input').checked">
              <input type="checkbox" name="bagIncluded" value="true" ${board.bag_included ? 'checked' : ''}> Housse
            </label>
          </div>

          <div class="edit-waiver-row">
            <div>
              <div class="edit-waiver-label">🛡️ Protection dommages</div>
              <div class="edit-waiver-sub">0.50€/h ajouté à la réservation</div>
            </div>
            <label class="edit-toggle">
              <input type="checkbox" name="damageWaiverEnabled" value="true" ${board.damage_waiver_enabled !== false ? 'checked' : ''}>
              <span class="edit-toggle-track"><span class="edit-toggle-thumb"></span></span>
            </label>
          </div>

          <div id="edit-error" class="edit-error"></div>
          <button type="submit" class="edit-submit-btn" id="edit-submit-btn">Sauvegarder les modifications ✅</button>
          <button type="button" class="edit-cancel-btn" onclick="closeEditModal()">Annuler</button>
        </form>`;
    }

    function escHtml(str) {
      return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function removeEditPhoto(index) {
      editState.photos.splice(index, 1);
      renderEditPhotoGrid();
    }

    function addEditPhotos(files) {
      for (const f of files) {
        if (editState.newPhotoFiles.length >= 8 - editState.photos.length) break;
        editState.newPhotoFiles.push(f);
      }
      renderEditPhotoGrid();
    }

    function renderEditPhotoGrid() {
      const grid = document.getElementById('edit-photo-grid');
      if (!grid) return;
      let html = '';
      editState.photos.forEach((url, i) => {
        html += `<div class="edit-photo-thumb"><img src="${escHtml(url)}" alt="Photo ${i+1}"><button type="button" class="edit-photo-remove" onclick="removeEditPhoto(${i})" title="Supprimer">×</button></div>`;
      });
      const maxNew = Math.max(0, 8 - editState.photos.length - editState.newPhotoFiles.length);
      if (editState.photos.length + editState.newPhotoFiles.length < 8) {
        html += `<label class="edit-photo-add"><span style="font-size:1.2rem;">+</span><span>Ajouter</span><input type="file" accept="image/*" multiple onchange="addEditPhotos(this.files)"></label>`;
      }
      grid.innerHTML = html;
    }

    async function submitEditBoard(e) {
      e.preventDefault();
      const form = e.target;
      const errEl = document.getElementById('edit-error');
      const btn = document.getElementById('edit-submit-btn');
      const overlay = document.getElementById('edit-submitting-overlay');
      errEl.textContent = '';

      // Validate min photos
      const totalPhotos = editState.photos.length + editState.newPhotoFiles.length;
      if (totalPhotos < 3) {
        errEl.textContent = 'Minimum 3 photos requises — ajoute au moins ' + (3 - totalPhotos) + ' photo(s).';
        return;
      }

      btn.disabled = true;
      if (overlay) overlay.classList.add('active');

      try {
        const formData = new FormData();
        formData.set('title', form.title.value.trim());
        formData.set('description', form.description.value.trim());
        formData.set('board_type', form.boardType.value);
        formData.set('condition', form.condition.value);
        formData.set('length_ft', form.lengthFt.value.trim());
        formData.set('skill_level', form.skillLevel.value);
        formData.set('hourlyRate', form.hourlyRate.value);
        formData.set('location', form.location.value.trim());
        formData.set('damageWaiverEnabled', form.damageWaiverEnabled.checked ? 'true' : 'false');
        formData.set('finsIncluded', form.finsIncluded.checked ? 'true' : 'false');
        formData.set('leashIncluded', form.leashIncluded.checked ? 'true' : 'false');
        formData.set('bagIncluded', form.bagIncluded.checked ? 'true' : 'false');
        formData.set('existingPhotos', JSON.stringify(editState.photos));
        for (const f of editState.newPhotoFiles) formData.append('photos', f);

        const res = await fetch(`/api/boards/${editState.boardId}`, { method: 'PUT', body: formData });
        const data = await res.json();

        if (!res.ok) {
          errEl.textContent = data.error || 'Erreur lors de la sauvegarde.';
          return;
        }

        closeEditModal();
        toast('Annonce mise à jour ✅', 'success');
        loadBoards(); // refresh the list

      } catch(_) {
        errEl.textContent = 'Impossible de sauvegarder — réessaie.';
      } finally {
        btn.disabled = false;
        if (overlay) overlay.classList.remove('active');
      }
    }

    // ── TAB NAVIGATION ─────────────────────────────────────────────────────────
    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('tab-' + tabName + '-btn').classList.add('active');
      document.getElementById('tab-panel-' + tabName).classList.add('active');
      if (tabName === 'genome') loadGenome();
    }

    // ── GENOME TAB ──────────────────────────────────────────────────────────────
    async function loadGenome() {
      const container = document.getElementById('genome-container');
      try {
        const res = await fetch(API.genomeHostMe);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const genomes = data.genomes || [];

        if (genomes.length === 0) {
          container.innerHTML = `
            <div class="empty">
              <div class="empty-icon">🧬</div>
              <h3>Aucune donnée génome</h3>
              <p>Ton intelligence Swell sera populated automatiquement à mesure que tes planches sont louées.</p>
            </div>`;
          return;
        }

        container.innerHTML = `<div class="genome-grid">${genomes.map(g => {
          const score = g.survival_score || 0;
          const scoreColor = score < 60 ? 'var(--red)' : score >= 85 ? 'var(--green)' : 'var(--yellow)';
          const barColor = score < 60 ? 'linear-gradient(90deg,#ff6b6b,#ff8e8e)' : score >= 85 ? 'linear-gradient(90deg,#4ade80,#86efac)' : 'linear-gradient(90deg,#fbbf24,#fcd34d)';
          const roiClass = g.roi_class || '';
          const isAp = roiClass === 'A+';
          const isWarn = score < 60;
          const badge = isAp ? '<span class="genome-badge gold">★ A+</span>' : (isWarn ? '<span class="genome-badge warn">⚠️ Attention</span>' : '<span class="genome-badge ok">A+ à C</span>');
          return `<div class="genome-card">
            <div class="genome-card-head">
              <div>
                <div class="genome-id">${escHtml(g.genome_id || '')}</div>
                <div class="genome-board-name">${escHtml(g.board_title || g.title || 'Planche')}</div>
              </div>
              ${badge}
            </div>
            <div class="genome-score-row">
              <span class="genome-score-label">Survival Score</span>
              <div class="genome-bar-wrap">
                <div class="genome-bar-fill" style="width:${score}%;background:${barColor};"></div>
              </div>
              <span class="genome-score-val" style="color:${scoreColor};">${score}</span>
            </div>
            <div class="genome-meta">
              <span class="genome-meta-item">📊 ${escHtml(roiClass || '—')}</span>
              <span class="genome-meta-item">📍 ${g.location_count || g.locations || 0} location${(g.location_count || g.locations || 0) !== 1 ? 's' : ''}</span>
              ${g.rental_count ? `<span class="genome-meta-item">🏄 ${g.rental_count} location${g.rental_count !== 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>`;
        }).join('')}</div>`;
      } catch(_) {
        container.innerHTML = `<div class="empty"><p style="color:var(--red);">Impossible de charger les données génome.</p></div>`;
      }
    }

    init();

