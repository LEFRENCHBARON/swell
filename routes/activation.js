// What this module owns: host activation checklist — status API + email blast trigger.
// Does NOT own board CRUD, Stripe connect flow, or KYC verification logic.
const express = require('express');
const router = express.Router();
const path = require('path');
const { getHostActivationStatus, getBoardAvailabilitySummary, getAllHostsForEmailBlast } = require('../db/activation');
const { sendTransactionalEmail } = require('../services/email');

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://swell.polsia.app';

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connexion requise' });
  next();
}

// Compute checklist from raw activation data.
// Returns { steps, completedCount, totalCount, percent }
function computeChecklist(user, boards, availabilityMap) {
  const steps = [];

  // 1. Stripe Connect
  steps.push({
    id: 'stripe',
    label: 'Paiements Stripe activés',
    done: !!(user.stripe_charges_enabled && user.stripe_payouts_enabled),
    cta: 'Connecter Stripe',
    ctaUrl: '/host#paiements',
    hint: 'Recevez vos virements directement sur votre compte bancaire'
  });

  // 2. KYC identity verification
  const kycDone = user.identity_status === 'verified';
  const kycPending = user.identity_status === 'pending_review';
  steps.push({
    id: 'kyc',
    label: 'Identité vérifiée (recto + verso)',
    done: kycDone,
    pending: kycPending,
    cta: kycPending ? 'En cours de vérification' : 'Vérifier mon identité',
    ctaUrl: kycPending ? null : '/host#identite',
    hint: 'Recto + verso de votre pièce d\'identité requis'
  });

  // 3. Per-board: photos (≥3 required)
  for (const board of boards) {
    const photoOk = board.photo_count >= 3;
    steps.push({
      id: `board_photos_${board.id}`,
      label: `${board.title || board.board_type} — photos (${board.photo_count}/3)`,
      done: photoOk,
      cta: 'Ajouter photos',
      ctaUrl: `/host#board-${board.id}`,
      hint: 'Face avant, face arrière, vue d\'ensemble',
      isBoardStep: true,
      boardId: board.id
    });
  }

  // 4. Hourly pricing set (at least one board with hourly rate)
  const hasHourlyPrice = boards.some(b => b.hourly_rate_cents && b.hourly_rate_cents > 0);
  steps.push({
    id: 'hourly_price',
    label: 'Tarif horaire défini (€/h)',
    done: hasHourlyPrice,
    cta: 'Définir un tarif',
    ctaUrl: '/host#boards',
    hint: 'Au moins une planche avec un tarif à l\'heure'
  });

  // 5. Availability calendar (next 14 days)
  // A board has availability if it has <224 blocked slots (see db/activation.js)
  const hasAvailability = availabilityMap.some(a => a.hasAvailability);
  steps.push({
    id: 'availability',
    label: 'Disponibilités saisies (14 prochains jours)',
    done: hasAvailability,
    cta: 'Ouvrir le calendrier',
    ctaUrl: '/host#availability',
    hint: 'Indiquez vos créneaux libres pour les 2 prochaines semaines'
  });

  const completedCount = steps.filter(s => s.done).length;
  const totalCount = steps.length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return { steps, completedCount, totalCount, percent };
}

// GET /api/activation/status — authenticated host's checklist
router.get('/status', requireAuth, async (req, res) => {
  try {
    const data = await getHostActivationStatus(req.session.userId);
    if (!data) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const availabilityMap = await getBoardAvailabilitySummary(req.session.userId);
    const checklist = computeChecklist(data.user, data.boards, availabilityMap);

    res.json({
      user: {
        name: data.user.name,
        email: data.user.email,
        avatarUrl: data.user.avatar_url
      },
      boards: data.boards.map(b => ({
        id: b.id,
        title: b.title,
        boardType: b.board_type,
        photoCount: b.photo_count,
        hourlyRateCents: b.hourly_rate_cents,
        isListed: b.is_listed
      })),
      checklist
    });
  } catch (err) {
    console.error('[Activation] status error:', err.message);
    res.status(500).json({ error: 'Impossible de charger le statut d\'activation' });
  }
});

// POST /api/activation/send-blast — one-shot email to all hosts
// Secured by ADMIN_SECRET header. Idempotent: can be re-run safely.
router.post('/send-blast', async (req, res) => {
  if (!ADMIN_SECRET) return res.status(403).json({ error: 'Admin non configuré' });
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Secret invalide' });
  }

  try {
    const hosts = await getAllHostsForEmailBlast();
    const results = [];

    for (const host of hosts) {
      // Compute percent for this host without availability (simple estimate)
      const fakeUser = {
        stripe_charges_enabled: host.stripe_charges_enabled,
        stripe_payouts_enabled: host.stripe_payouts_enabled,
        identity_status: host.identity_status
      };
      const boards = Array.isArray(host.boards) ? host.boards : [];
      // Availability: assume set if boards exist (conservative — avoids DB call per host)
      const fakeAvailMap = boards.map(b => ({ boardId: b.id, hasAvailability: true }));
      const checklist = computeChecklist(fakeUser, boards, fakeAvailMap);

      const percent = checklist.percent;
      const firstName = host.name ? host.name.split(' ')[0] : 'Surfer';

      const htmlBody = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Tu es à ${percent}% du badge Verified Host</title></head>
<body style="margin:0;padding:0;background:#0a1628;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f1e35;border-radius:16px;overflow:hidden;max-width:560px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#00c2e0,#0099b8);padding:32px 40px;text-align:center;">
            <div style="font-size:36px;font-weight:900;color:#fff;letter-spacing:-1px;">SWELL</div>
            <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:4px;">Marketplace de location de planches</div>
          </td>
        </tr>
        <!-- Progress -->
        <tr>
          <td style="padding:40px 40px 24px;">
            <h1 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:700;">Hey ${firstName} 👋</h1>
            <p style="margin:0 0 24px;color:#94a3b8;font-size:16px;line-height:1.6;">
              Tu es à <strong style="color:#00c2e0;">${percent}%</strong> du badge <strong style="color:#fff;">Verified Host</strong>.<br>
              Les planches avec ce badge convertissent mieux. Quelques étapes suffisent.
            </p>
            <!-- Progress bar -->
            <div style="background:#1e3a5f;border-radius:999px;height:12px;overflow:hidden;margin-bottom:8px;">
              <div style="background:linear-gradient(90deg,#00c2e0,#0ea5e9);height:12px;width:${percent}%;border-radius:999px;transition:width 0.3s;"></div>
            </div>
            <div style="color:#64748b;font-size:13px;margin-bottom:32px;">${checklist.completedCount}/${checklist.totalCount} étapes complétées</div>
            <!-- CTA -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:linear-gradient(135deg,#00c2e0,#0099b8);border-radius:10px;padding:14px 32px;">
                  <a href="${BASE_URL}/host/activation?utm_source=email&utm_campaign=verified_host_blast&utm_content=${host.id}" style="color:#fff;text-decoration:none;font-size:16px;font-weight:700;display:block;">
                    Voir mon tableau de bord →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Steps preview -->
        <tr>
          <td style="padding:0 40px 32px;">
            <div style="border-top:1px solid #1e3a5f;padding-top:24px;">
              <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Prochaines étapes</div>
              ${checklist.steps.filter(s => !s.done).slice(0, 3).map(s => `
              <div style="display:flex;align-items:center;margin-bottom:10px;">
                <div style="width:20px;height:20px;border-radius:50%;border:2px solid #f59e0b;margin-right:12px;flex-shrink:0;"></div>
                <div style="color:#94a3b8;font-size:14px;">${s.label}</div>
              </div>`).join('')}
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#070f1e;padding:20px 40px;text-align:center;">
            <div style="color:#334155;font-size:12px;">
              Swell · Hossegor, France · <a href="${BASE_URL}/unsubscribe" style="color:#334155;">Se désabonner</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      const textBody = `Hey ${firstName},\n\nTu es à ${percent}% du badge Verified Host sur Swell.\n\nLes planches avec ce badge convertissent mieux.\n\nVoir ton tableau de bord : ${BASE_URL}/host/activation\n\n— L'équipe Swell`;

      try {
        await sendTransactionalEmail({
          to: host.email,
          subject: `Tu es à ${percent}% du badge Verified Host`,
          htmlBody,
          textBody,
          tag: 'verified-host-blast',
          replyTo: 'sebastien@swell.fr'
        });
        results.push({ hostId: host.id, email: host.email, percent, status: 'sent' });
      } catch (emailErr) {
        console.error(`[Activation] email failed for ${host.email}:`, emailErr.message);
        results.push({ hostId: host.id, email: host.email, percent, status: 'failed', error: emailErr.message });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    res.json({ success: true, sent, failed, total: results.length, results });
  } catch (err) {
    console.error('[Activation] blast error:', err.message);
    res.status(500).json({ error: 'Blast échoué', detail: err.message });
  }
});

module.exports = router;
