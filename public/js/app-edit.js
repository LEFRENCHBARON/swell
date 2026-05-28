  // ── EDIT BOARD MODAL ──
  let editState = { boardId: null, photos: [], newPhotoFiles: [], loading: false };

  function openEditModal(boardId) {
    event.stopPropagation();
    editState = { boardId, photos: [], newPhotoFiles: [], loading: false };
    document.getElementById('edit-modal-body').innerHTML = '<div style="text-align:center;padding:2rem;"><div class="spinner"></div> Chargement...</div>';
    document.getElementById('edit-board-modal').style.display = 'flex';
    loadEditData(boardId);
  }

  function closeEditModal() {
    document.getElementById('edit-board-modal').style.display = 'none';
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
    const dailyRate = board.daily_price_cents ? (board.daily_price_cents / 100) : '';
    document.getElementById('edit-modal-body').innerHTML = `
      <form id="edit-board-form" onsubmit="submitEditBoard(event)" novalidate>
        <input type="hidden" name="boardId" value="${board.id}">
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Titre</label>
          <input type="text" name="title" value="${escHtml(board.title||'')}" maxlength="80" required placeholder="ex: Fish 5'10 — Hossegor" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Description</label>
          <textarea name="description" placeholder="Décris ta planche..." style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;min-height:80px;resize:vertical;">${escHtml(board.description||'')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Prix horaire (€/h)</label>
            <input type="number" name="hourly_rate_cents" value="${hourlyRate}" min="3" max="100" step="0.5" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Prix journalier (€/j)</label>
            <input type="number" name="daily_price_cents" value="${dailyRate}" min="10" max="500" step="1" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Taille (pieds)</label>
            <input type="text" name="length_ft" value="${escHtml(board.length_ft||'')}" placeholder="ex: 6'2" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Niveau</label>
            <select name="skill_level" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
              <option value="all" ${(board.skill_level||'all')==='all'?'selected':''}>Tous niveaux</option>
              <option value="beginner" ${board.skill_level==='beginner'?'selected':''}>Débutants</option>
              <option value="intermediate" ${board.skill_level==='intermediate'?'selected':''}>Intermédiaires</option>
              <option value="advanced" ${board.skill_level==='advanced'?'selected':''}>Confirmés</option>
            </select>
          </div>
        </div>
        ${photos.length > 0 ? `
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.5rem;">Photos actuelles</label>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
            ${photos.map((url, i) => `<div style="position:relative;width:72px;height:72px;">
              <img src="${url}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">
              <button type="button" onclick="removeEditPhoto(${i})" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--red);color:white;border:none;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>
            </div>`).join('')}
          </div>
        </div>` : ''}
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Ajouter des photos</label>
          <input type="file" accept="image/*" multiple onchange="handleEditNewPhotos(this)" style="font-size:0.85rem;">
        </div>
        <div id="edit-new-photos" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1rem;"></div>
        <button type="submit" style="width:100%;background:var(--primary);color:white;border:none;border-radius:10px;padding:0.75rem;font-weight:700;font-size:0.95rem;cursor:pointer;">Enregistrer les modifications</button>
      </form>`;
  }

  function removeEditPhoto(index) {
    editState.photos.splice(index, 1);
    renderEditFormRaw({});
  }

  function renderEditFormRaw(data) {
    const photos = editState.photos;
    const hourlyRate = data.hourly_rate_cents ? (data.hourly_rate_cents / 100) : 8;
    const dailyRate = data.daily_price_cents ? (data.daily_price_cents / 100) : '';
    const title = typeof data === 'string' ? data : (data.title || '');
    const desc = typeof data === 'string' ? data : (data.description || '');
    const length = typeof data === 'string' ? data : (data.length_ft || '');
    const skill = typeof data === 'string' ? data : (data.skill_level || 'all');
    document.getElementById('edit-modal-body').innerHTML = `
      <form id="edit-board-form" onsubmit="submitEditBoard(event)" novalidate>
        <input type="hidden" name="boardId" value="${editState.boardId}">
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Titre</label>
          <input type="text" name="title" value="${escHtml(title)}" maxlength="80" required placeholder="ex: Fish 5'10 — Hossegor" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Description</label>
          <textarea name="description" placeholder="Décris ta planche..." style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;min-height:80px;resize:vertical;">${escHtml(desc)}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Prix horaire (€/h)</label>
            <input type="number" name="hourly_rate_cents" value="${hourlyRate}" min="3" max="100" step="0.5" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Prix journalier (€/j)</label>
            <input type="number" name="daily_price_cents" value="${dailyRate}" min="10" max="500" step="1" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Taille (pieds)</label>
            <input type="text" name="length_ft" value="${escHtml(length)}" placeholder="ex: 6'2" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Niveau</label>
            <select name="skill_level" style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;background:var(--bg);box-sizing:border-box;">
              <option value="all" ${skill==='all'?'selected':''}>Tous niveaux</option>
              <option value="beginner" ${skill==='beginner'?'selected':''}>Débutants</option>
              <option value="intermediate" ${skill==='intermediate'?'selected':''}>Intermédiaires</option>
              <option value="advanced" ${skill==='advanced'?'selected':''}>Confirmés</option>
            </select>
          </div>
        </div>
        ${photos.length > 0 ? `
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.5rem;">Photos actuelles (${photos.length})</label>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
            ${photos.map((url, i) => `<div style="position:relative;width:72px;height:72px;">
              <img src="${url}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">
              <button type="button" onclick="removeEditPhotoR(${i})" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--red);color:white;border:none;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>
            </div>`).join('')}
          </div>
        </div>` : ''}
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.3rem;">Ajouter des photos</label>
          <input type="file" accept="image/*" multiple onchange="handleEditNewPhotos(this)" style="font-size:0.85rem;">
        </div>
        <div id="edit-new-photos" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1rem;"></div>
        <button type="submit" style="width:100%;background:var(--primary);color:white;border:none;border-radius:10px;padding:0.75rem;font-weight:700;font-size:0.95rem;cursor:pointer;">Enregistrer les modifications</button>
      </form>`;
  }

  function removeEditPhotoR(index) {
    editState.photos.splice(index, 1);
    const form = document.getElementById('edit-board-form');
    const fd = form ? new FormData(form) : null;
    const title = fd ? (fd.get('title') || '') : '';
    const desc = fd ? (fd.get('description') || '') : '';
    const hourly = fd ? parseFloat(fd.get('hourly_rate_cents') || '8') : 8;
    const daily = fd ? parseFloat(fd.get('daily_price_cents') || '0') : 0;
    const length = fd ? (fd.get('length_ft') || '') : '';
    const skill = fd ? (fd.get('skill_level') || 'all') : 'all';
    renderEditFormRaw({ title, description: desc, hourly_rate_cents: hourly*100, daily_price_cents: daily*100, length_ft: length, skill_level: skill });
  }

  function handleEditNewPhotos(input) {
    const container = document.getElementById('edit-new-photos');
    Array.from(input.files).forEach(f => {
      if (editState.photos.length + editState.newPhotoFiles.length >= 8) return;
      editState.newPhotoFiles.push(f);
    });
    if (container) {
      container.innerHTML = editState.newPhotoFiles.map((f, i) => `<span style="font-size:0.75rem;background:var(--primary-soft);color:var(--primary);padding:0.2rem 0.5rem;border-radius:6px;">${f.name}</span>`).join('');
    }
  }

  async function submitEditBoard(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('[type=submit]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sauvegarde...';
    try {
      const fd = new FormData(form);
      fd.set('existingPhotos', JSON.stringify(editState.photos));
      for (const f of editState.newPhotoFiles) fd.append('photos', f);
      const res = await fetch(`/api/boards/${editState.boardId}`, { method: 'PUT', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      toast('Annonce mise à jour ✅');
      closeEditModal();
      loadBoards();
    } catch(err) {
      toast(err.message || 'Erreur de sauvegarde', 'error');
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function handleNewsletterSignup(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    const input = form.querySelector('input');
    btn.textContent = 'Dans le lineup ✓';
    btn.style.background = '#1b7a4e';
    input.value = '';
    input.disabled = true;
    btn.disabled = true;
  }

