// What this module owns: /spots/:slug server-rendered spot landing pages.
// Rich guides with hero copy, boards by level, local FAQ, tides/parking, full SEO markup.
// Does NOT own spot API, board CRUD, or /spot/:slug (which is spot-pages.js).
const express = require('express');
const router = express.Router();
const { getBoardsByLevel } = require('../db/spots');

const BASE_URL = 'https://swell.polsia.app';

const OG_IMAGE = '/og-image.svg';

// Strip any hotlinked photo URLs that Swell doesn't own.
const BLOCKED_PHOTO_HOSTS = ['unsplash.com', 'images.unsplash.com', 'picsum.photos', 'googleusercontent.com'];
function sanitizePhotoUrl(url) {
  if (!url || typeof url !== 'string') return OG_IMAGE;
  try {
    const host = new URL(url).hostname;
    return BLOCKED_PHOTO_HOSTS.includes(host) ? OG_IMAGE : url;
  } catch {
    return url; // local path — keep it
  }
}

// ─── Spot metadata ──────────────────────────────────────────────────────────
const SPOT_META = {
  hossegor: {
    displayName: 'Hossegor',
    region: 'Landes',
    heroHeadline: 'Loue une planche de surf à Hossegor cet été',
    heroSub: 'Planches par des surfeurs locaux, livrées sur le spot. De la Gravière à La Nord.',
    spots: [
      { name: 'La Gravière', level: 'advanced', desc: 'Le pipeline européen. Beach break puissant, tubes creux. Accueille le Quiksilver Pro chaque année.' },
      { name: 'Les Culs Nus', level: 'advanced', desc: 'Nord de La Gravière. Bancs redoutables, vagues creuses et rapides. Confirmés uniquement.' },
      { name: 'La Nord', level: 'intermediate', desc: 'La plage nord. Plus régulière que La Gravière, idéale pour progresser en sécurité.' },
      { name: 'Plage Centrale', level: 'intermediate', desc: 'Le centre d\u2019Hossegor. Vagues polyvalentes, bonne option quand La Gravière est trop grosse.' },
    ],
    conditions: {
      bestSeason: 'Septembre \u2013 Novembre (grosses houles atlantiques)',
      waterTemp: '16\u00b0C (hiver) \u2013 23\u00b0C (\u00e9t\u00e9)',
      bestWind: 'Offshore Est / Sud-Est',
      bestTide: 'Mi-mar\u00e9e montante \u00e0 mar\u00e9e haute',
      waveHeight: '1m \u2013 4m selon les bancs et les houles',
    },
    faq: [
      { q: 'Quelle mar\u00e9e pour surfer \u00e0 Hossegor ?', a: 'Mi-mar\u00e9e montante \u00e0 mar\u00e9e haute pour La Gravi\u00e8re et Les Culs Nus \u2014 le sable se creuse et forme les meilleurs tubes. La Nord et la Plage Centrale sont plus polyvalentes.' },
      { q: 'O\u00f9 garer sa voiture \u00e0 Hossegor ?', a: 'Parking plage sud (payant, \u20ac4/jour) ou parking du casino (gratuit 1h). Le matin, places \u00e0 7h00. En \u00e9t\u00e9, arrive avant 9h pour avoir une place correcte. Pr\u00e9vois 15 min \u00e0 pied jusqu\u2019au lineup.' },
      { q: 'La Gravi\u00e8re est trop grosse, o\u00f9 aller ?', a: 'Capbreton (La Piste, 10 min au sud) est abrit\u00e9 et plus doux. Seignosse (Le Penon, 15 min au nord) capte les petits swells. La Nord est aussi une bonne option.' },
      { q: 'Faut-il une combinaison en \u00e9t\u00e9 ?', a: 'Oui \u2014 3/2mm ou shorty recommand\u00e9 m\u00eame en ao\u00fbt. L\u2019Atlantique reste frais (19-22\u00b0C). Sans combinaison, tu risques une hypothermie apr\u00e8s 2h.' },
      { q: 'Quel niveau pour surfer \u00e0 Hossegor ?', a: 'La Gravi\u00e8re et Les Culs Nus : interm\u00e9diaire \u00e0 confirm\u00e9. La Nord et Plage Centrale : d\u00e9butant \u00e0 interm\u00e9diaire. Loue une board adapt\u00e9e sur Swell \u2014 les locaux te conseillent directement.' },
    ],
    metaTitle: 'Louer une planche de surf \u00e0 Hossegor | Swell \u2014 Location entre surfeurs',
    metaDesc: 'Location de planche de surf \u00e0 Hossegor entre particuliers. Shortboards, longboards, fish \u2014 boards v\u00e9rifi\u00e9es, livr\u00e9es sur le spot. De la Gravi\u00e8re \u00e0 La Nord.',
    keywords: 'location surf Hossegor, louer planche Hossegor, surfboard rental Hossegor, La Gravi\u00e8re, Les Culs Nus, La Nord, Hossegor surf hire',
  },
  guethary: {
    displayName: 'Guéthary',
    region: 'Pays Basque',
    heroHeadline: 'Loue une planche à Guéthary cet été',
    heroSub: 'Le village de surf le plus authentique du Pays Basque. Parlementia, Les Alcyons, Avalanche — quand le swell est là, ça envoie.',
    spots: [
      { name: 'Parlementia', level: 'advanced', desc: 'Le joyau de Guéthary. Beach break puissant qui produit des tubes spectaculaires. Réputation mythique dans tout le sud-ouest.' },
      { name: 'Les Alcyons', level: 'advanced', desc: 'Adjacent à Parlementia, moins connu mais tout aussi puissant par bonne houle. Réservé aux surfeurs confirés.' },
      { name: 'Avalanche', level: 'advanced', desc: 'Le spots le plus exigeant du coin. Vagues creuses, courants forts. Experts uniquement — ce nest pas uneMetaphore.' },
    ],
    conditions: {
      bestSeason: 'Septembre \u2013 Novembre (grosses houles atlantiques)',
      waterTemp: '17\u00b0C (hiver) \u2013 23\u00b0C (\u00e9t\u00e9)',
      bestWind: 'Offshore Nord-Est / Est',
      bestTide: 'Mi-mar\u00e9e \u00e0 mar\u00e9e haute',
      waveHeight: '1m \u2013 3.5m selon la direction du swell',
    },
    faq: [
      { q: 'Gu\u00e9thary, c\u2019est adapt\u00e9 pour d\u00e9buter ?', a: 'Non \u2014 Gu\u00e9thary est un spot de surf avanc\u00e9. Parlementia, Les Alcyons et Avalanche sont tous r\u00e9serv\u00e9s aux surfeurs confir\u00e9s. Pour d\u00e9buter, direction Hossegor La Nord ou Seignosse Le Penon.' },
      { q: 'Faut-il un peu de fran\u00e7ais pour surfer \u00e0 Gu\u00e9thary ?', a: 'Le village est tr\u00e8s cosmopolite. Les locaux sont sympas mais le lineup est souvent serr\u00e9. Observe d\u2019abord le spot avant de te lancer, et reste \u00e9quidistant des autres.' },
      { q: 'O\u00f9 garer \u00e0 Gu\u00e9thary ?', a: 'Parking communal face \u00e0 la plage (gratuit mais vite plein en \u00e9t\u00e9). Arrive avant 8h en plein saison pour avoir une place. En giorn\u00e9e, utilise le parking de la place du village, \u00e0 5 min \u00e0 pied.' },
      { q: 'Quelle combinaison \u00e0 Gu\u00e9thary ?', a: '3/2mm recommand\u00e9 toute l\u2019ann\u00e9e. En \u00e9t\u00e9, un shorty 2mm peut suffire les jours de klein swell. En hiver, 4/3mm obligatoire.' },
      { q: 'Gu\u00e9thary vs Lafitenia, quel spot choisir ?', a: 'Gu\u00e9thary (Parlementia) offre des beach breaks puissants avec tubes. Lafitenia (point break) donne des vagues pluslongues et moins creuses. Les deux sont avanc\u00e9s, mais Lafitenia pardonne un peu plus.' },
    ],
    metaTitle: 'Louer une planche de surf \u00e0 Gu\u00e9thary | Swell \u2014 Location entre surfeurs',
    metaDesc: 'Location de planche de surf \u00e0 Gu\u00e9thary entre particuliers. Parlementia, Les Alcyons, Avalanche \u2014 boards performantes par des surfeurs locaux.',
    keywords: 'location surf Gu\u00e9thary, louer planche Gu\u00e9thary, Parlementia, Les Alcyons, Avalanche, surfboard rental Gu\u00e9thary',
  },
  'saint-jean-de-luz': {
    displayName: 'Saint-Jean-de-Luz',
    region: 'Pays Basque',
    heroHeadline: 'Loue une planche \u00e0 Saint-Jean-de-Luz cet \u00e9t\u00e9',
    heroSub: 'De Lafitenia \u00e0 C\u00e9nitz \u2014 le Pays Basque offre des vagues pour tous les niveaux, avec un cadre inoubliable.',
    spots: [
      { name: 'Lafitenia', level: 'advanced', desc: 'Le point break le plus c\u00e9l\u00e8bre du Pays Basque. Vagues longues et puissantes, qui tournent \u00e0 gauche. Mythique depuis des d\u00e9cennies.' },
      { name: 'C\u00e9nitz', level: 'intermediate', desc: 'Plage au sud de Saint-Jean-de-Luz, moins fr\u00e9quent\u00e9e que Lafitenia. Bon pour progresser en s\u00e9curit\u00e9 avec des vagues r\u00e9guli\u00e8res.' },
    ],
    conditions: {
      bestSeason: 'Septembre \u2013 Novembre',
      waterTemp: '17\u00b0C (hiver) \u2013 24\u00b0C (\u00e9t\u00e9)',
      bestWind: 'Offshore Est / Nord-Est',
      bestTide: 'Mi-mar\u00e9e montante \u00e0 haute',
      waveHeight: '0.8m \u2013 3m',
    },
    faq: [
      { q: 'Lafitenia, c\u2019est accessible aux interm\u00e9diaires ?', a: 'Non \u2014 Lafitenia est un point break puissant r\u00e9serv\u00e9 aux surfeurs interm\u00e9diaires confirm\u00e9s et avanc\u00e9s. Les vagues peuvent \u00eatre creuses et la lineup serr\u00e9e. C\u00e9nitz est mieux adapt\u00e9 pour les interm\u00e9diaires.' },
      { q: 'Saint-Jean-de-Luz, c\u2019est trop touristique pour le surf ?', a: 'Le centre-ville est tr\u00e8s touristique mais les spots de surf restent authentiques. Lafitenia attire des surfeurs du monde entier \u2014 mais tu as toujours ton espace. Le cadre entre les deux bays est magnifique.' },
      { q: 'O\u00f9 garer \u00e0 Lafitenia ?', a: 'Parking en altitude au-dessus du spot (5\u20ac/jour environ). En \u00e9t\u00e9, arrive t\u00f4t \u2014 Lafitenia se remplit vite et la marche depuis le parking peut \u00eatre longue.' },
      { q: 'Faut-il une combinaison \u00e0 Saint-Jean-de-Luz ?', a: 'M\u00eame r\u00e8gle que le reste du Pays Basque : 3/2mm toute l\u2019ann\u00e9e, 4/3mm en hiver. L\u2019Oc\u00e9an reste frais m\u00eame en ao\u00fbt.' },
      { q: 'Saint-Jean-de-Luz vs Gu\u00e9thary ?', a: 'Gu\u00e9thary est plus authentique et moins tourist\u00e9, mais plus exigeant. Saint-Jean-de-Luz offre un meilleur compromis interm\u00e9diaire \u2014 Lafitenia pour les confir\u00e9s, C\u00e9nitz pour progresser.' },
    ],
    metaTitle: 'Louer une planche de surf \u00e0 Saint-Jean-de-Luz | Swell \u2014 Location entre surfeurs',
    metaDesc: 'Location de planche de surf \u00e0 Saint-Jean-de-Luz entre particuliers. Lafitenia point break, C\u00e9nitz plage \u2014 boards performantes par des surfeurs basques.',
    keywords: 'location surf Saint-Jean-de-Luz, louer planche Saint-Jean-de-Luz, Lafitenia, C\u00e9nitz, surfboard rental Saint-Jean-de-Luz, surf Pays Basque',
  },
  capbreton: {
    displayName: 'Capbreton',
    region: 'Landes',
    heroHeadline: 'Loue une planche \u00e0 Capbreton cet \u00e9t\u00e9',
    heroSub: 'Moins tourist\u00e9 qu\u2019Hossegor, tout aussi puissant. Santocha et La Piste \u2014 le secret partag\u00e9 des Landes.',
    spots: [
      { name: 'Santocha', level: 'intermediate', desc: 'Au sud de Capbreton, juste avant le port. Beach break r\u00e9gulier avec des vagues structur\u00e9es. Bon terrain de progression entre Hossegor et les spots basques.' },
      { name: 'La Piste', level: 'advanced', desc: 'Le spot star de Capbreton. Beach break puissant par bonne houle, tubes possibles. Fran\u00e7ais et \u00e9trangers se croisent dans le lineup.' },
    ],
    conditions: {
      bestSeason: 'Octobre \u2013 Novembre (swell atlantique)',
      waterTemp: '16\u00b0C (hiver) \u2013 22\u00b0C (\u00e9t\u00e9)',
      bestWind: 'Offshore Est / Sud-Est',
      bestTide: 'Mi-mar\u00e9e montante',
      waveHeight: '1m \u2013 3.5m',
    },
    faq: [
      { q: 'Capbreton est-il moins cher qu\u2019Hossegor ?', a: 'Capbreton est plus familial et moins orient\u00e9 tourisme de surf qu\u2019Hossegor. Les prix des locations ne sont pas plus bas pour autant \u2014 mais tu as moins de monde dans le lineup.' },
      { q: 'La Piste est-elle aussi grosse que La Gravi\u00e8re ?', a: 'Moins puissante que La Gravi\u00e8re \u00e0 swell \u00e9gal, mais La Piste peut quand m\u00eame envoyer fort. Par grosses houles, les vagues peuvent d\u00e9passer les 2m et restent creuses. Interm\u00e9diaires confirm\u00e9s et avanc\u00e9s recommand\u00e9s.' },
      { q: 'Santocha est-il adapt\u00e9 aux interm\u00e9diaires ?', a: 'Oui \u2014 Santocha est l\u2019un des meilleurs spots pour progresser dans le coin. Les vagues sont moins intimidantes qu\u2019\u00e0 La Piste ou La Gravi\u00e8re, et le lineup est g\u00e9n\u00e9ralement moins serr\u00e9.' },
      { q: 'O\u00f9 garer \u00e0 Capbreton ?', a: 'Parking de la plage de Santocha (payant en saison) ou parking municipal au centre. Pour La Piste, le parking de la plage sud fonctionne. Arrive le matin pour avoir de la place.' },
      { q: 'Capbreton vs Seignosse ?', a: 'Seignosse (Le Penon) a un meilleur esprit surf community et plus de choix de boards. Capbreton est plus calme, moins tourist\u00e9, et La Piste a plus de puissance. Les deux sont interm\u00e9diaire \u00e0 avanc\u00e9.' },
    ],
    metaTitle: 'Louer une planche de surf \u00e0 Capbreton | Swell \u2014 Location entre surfeurs',
    metaDesc: 'Location de planche de surf \u00e0 Capbreton entre particuliers. Santocha, La Piste \u2014 boards performantes par des surfeurs locaux des Landes, moins tourist\u00e9s qu\u2019Hossegor.',
    keywords: 'location surf Capbreton, louer planche Capbreton, La Piste Capbreton, Santocha, surfboard rental Capbreton, Hossegor alternative',
  },
};

// ─── HTML escape ──────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Board card ───────────────────────────────────────────────────────────────
const TYPES = { shortboard: 'Shortboard', longboard: 'Longboard', midlength: 'Mid-Length', fish: 'Fish', funboard: 'Funboard', foam: 'Mousse', gun: 'Gun' };
const LEVEL_LABELS = { beginner: 'D\u00e9butant', intermediate: 'Interm\u00e9diaire', advanced: 'Avanc\u00e9' };

function renderBoardCard(board, forceLevel) {
  const photos = Array.isArray(board.photos) ? board.photos : [];
  const rawPhoto = photos[0] || OG_IMAGE;
  const photo = sanitizePhotoUrl(rawPhoto);
  const daily = (board.daily_price_cents / 100).toFixed(0);
  const hourly = board.hourly_rate_cents ? (board.hourly_rate_cents / 100).toFixed(0) : null;
  const rating = parseFloat(board.avg_rating || 0);
  const reviews = parseInt(board.review_count || 0, 10);
  const level = LEVEL_LABELS[board.skill_level] || board.skill_level;
  const boardType = TYPES[board.board_type] || board.board_type;
  const levelClass = board.skill_level || forceLevel || 'beginner';

  return `<a href="/board/${board.id}" class="board-card">
    <div class="board-card-img" style="background-image:url('${esc(photo)}')" alt="Planche ${esc(board.title)} \u00e0 Hossegor"></div>
    <div class="board-card-body">
      <span class="board-card-type">${esc(boardType)}</span>
      <span class="board-card-level level-${esc(levelClass)}">${esc(level)}</span>
      <h3 class="board-card-title">${esc(board.title)}</h3>
      <div class="board-card-meta">
        ${board.length_ft ? `<span>\ud83d\udd0f ${board.length_ft}ft</span>` : ''}
        ${board.condition ? `<span>\u2728 ${esc(board.condition)}</span>` : ''}
      </div>
      <div class="board-card-bottom">
        <span class="board-card-price">${hourly ? `${hourly}\u20ac<small>/h</small>` : `${daily}\u20ac<small>/jour</small>`}</span>
        ${rating > 0 ? `<span class="board-card-rating">\u2605 ${rating.toFixed(1)} <small>(${reviews})</small></span>` : ''}
      </div>
    </div>
  </a>`;
}

// ─── Main render ──────────────────────────────────────────────────────────────
function renderSpotPage(slug, meta, boards) {
  const byLevel = {
    beginner: boards.filter(b => b.skill_level === 'beginner'),
    intermediate: boards.filter(b => b.skill_level === 'intermediate'),
    advanced: boards.filter(b => b.skill_level === 'advanced'),
  };
  const total = boards.length;

  const sportsActivityLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: `Location surf ${meta.displayName}`,
    description: meta.heroSub,
    url: `${BASE_URL}/spots/${slug}`,
    address: { '@type': 'PostalAddress', addressLocality: meta.displayName, addressRegion: meta.region, addressCountry: 'FR' },
    ...(total > 0 ? {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: `Planches disponibles \u00e0 ${meta.displayName}`,
        itemListElement: boards.slice(0, 5).map((b, i) => ({
          '@type': 'Offer',
          position: i + 1,
          name: b.title,
          description: `${TYPES[b.board_type] || b.board_type} \u2014 ${b.length_ft || ''}`,
          priceCurrency: 'EUR',
          price: b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(2) : (b.daily_price_cents / 800).toFixed(2),
          unitCode: 'HUR',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            priceCurrency: 'EUR',
            unitCode: 'HUR',
            description: 'per hour',
          },
          availability: 'https://schema.org/InStock',
          url: `${BASE_URL}/board/${b.id}`,
        })),
      }
    } : {}),
  });

  const localBusinessLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: `Swell \u2014 Location surf ${meta.displayName}`,
    description: meta.metaDesc,
    url: BASE_URL,
    image: `${BASE_URL}${OG_IMAGE}`,
    geo: { '@type': 'GeoCoordinates', addressLocality: meta.displayName, addressRegion: meta.region },
    priceRange: '\u20ac\u20ac',
  });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(meta.metaTitle)}</title>
  <meta name="description" content="${esc(meta.metaDesc)}">
  <meta name="keywords" content="${esc(meta.keywords)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE_URL}/spots/${slug}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Swell">
  <meta property="og:url" content="${BASE_URL}/spots/${slug}">
  <meta property="og:title" content="${esc(meta.heroHeadline)}">
  <meta property="og:description" content="${esc(meta.metaDesc)}">
  <meta property="og:image" content="${BASE_URL}${OG_IMAGE}">
  <meta property="og:locale" content="fr_FR">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(meta.metaTitle)}">
  <meta name="twitter:description" content="${esc(meta.metaDesc)}">

  <script type="application/ld+json">${sportsActivityLd}</script>
  <script type="application/ld+json">${localBusinessLd}</script>

  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0e1e36">
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
  <noscript><link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet"></noscript>

  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--night:#0e1e36;--night-deep:#09152a;--dusk:#142540;--deep:#101c32;--surface:#1f3560;--white:#fff;--white-80:rgba(255,255,255,0.88);--white-55:rgba(255,255,255,0.62);--white-30:rgba(255,255,255,0.38);--coral:#ff6b35;--coral-glow:rgba(255,107,53,0.18);--coral-light:#ff8c5a;--ocean:#1a90d8;--ocean-deep:#0066aa;--ocean-glow:rgba(26,144,216,0.2);--green:#4ade80;--gold:#f0c870;--green-bg:rgba(74,222,128,0.08);--green-border:rgba(74,222,128,0.3);--border:rgba(255,255,255,0.08);--primary:#00c2e0;--radius:16px;--radius-sm:10px}
    html{scroll-behavior:smooth}
    body{font-family:'DM Sans','Space Grotesk',system-ui,sans-serif;background:var(--night);color:var(--white);line-height:1.6;-webkit-font-smoothing:antialiased}
    .nav{position:sticky;top:0;z-index:200;padding:1rem 5%;display:flex;align-items:center;justify-content:space-between;background:rgba(14,30,54,0.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
    .nav-logo{font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:800;color:var(--white);text-decoration:none}
    .nav-logo em{font-style:normal;color:var(--coral)}
    .nav-links{display:flex;gap:0.25rem;align-items:center}
    .nav-link{color:var(--white-55);font-size:0.9rem;text-decoration:none;padding:0.5rem 0.8rem;border-radius:8px;transition:color 0.2s}
    .nav-link:hover{color:var(--white)}
    .nav-cta{background:var(--coral);color:white;padding:0.55rem 1.3rem;border-radius:100px;font-weight:700;font-size:0.85rem;text-decoration:none;margin-left:0.5rem;box-shadow:0 4px 16px rgba(255,107,53,0.3);transition:transform 0.2s,box-shadow 0.2s}
    .nav-cta:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(255,107,53,0.45)}
    .breadcrumb{max-width:1100px;margin:1.5rem auto 0;padding:0 1.5rem;font-size:0.82rem;color:var(--white-30)}
    .breadcrumb a{color:var(--primary);text-decoration:none}
    .breadcrumb a:hover{text-decoration:underline}
    .spot-hero{max-width:1100px;margin:0 auto;padding:2.5rem 1.5rem 1.5rem;display:grid;grid-template-columns:1fr auto;gap:2rem;align-items:start}
    .spot-hero-text h1{font-family:'Syne',sans-serif;font-size:clamp(1.8rem,4.5vw,2.8rem);font-weight:800;line-height:1.15;margin-bottom:0.75rem}
    .spot-hero-text h1 em{font-style:normal;color:var(--coral)}
    .spot-hero-text .hero-sub{font-size:1.05rem;color:var(--white-55);max-width:540px;margin-bottom:1.5rem}
    .spot-hero-stats{display:flex;gap:1rem;flex-wrap:wrap}
    .stat-pill{display:flex;align-items:center;gap:0.4rem;background:var(--dusk);border:1px solid var(--border);border-radius:100px;padding:0.4rem 1rem;font-size:0.85rem;color:var(--white-80)}
    .stat-pill strong{color:var(--white)}
    .hero-cta{display:flex;flex-direction:column;gap:0.75rem;min-width:220px}
    .btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;background:var(--coral);color:white;padding:0.9rem 2rem;border-radius:100px;font-weight:700;font-size:1rem;text-decoration:none;text-align:center;box-shadow:0 4px 20px rgba(255,107,53,0.35);transition:transform 0.2s,box-shadow 0.2s}
    .btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(255,107,53,0.5)}
    .btn-secondary{display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;background:var(--dusk);color:var(--white-80);padding:0.75rem 1.5rem;border-radius:100px;font-weight:600;font-size:0.88rem;text-decoration:none;text-align:center;border:1px solid var(--border);transition:background 0.2s,border-color 0.2s}
    .btn-secondary:hover{background:var(--surface);border-color:rgba(0,194,224,0.3)}
    .container{max-width:1100px;margin:0 auto;padding:0 1.5rem}
    .section{margin-top:3rem}
    .section-header{display:flex;align-items:center;gap:0.6rem;margin-bottom:1.25rem}
    .section-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
    .section-icon.spots{background:rgba(26,144,216,0.15)}
    .section-icon.boards{background:var(--ocean-glow)}
    .section-icon.conditions{background:rgba(240,200,112,0.12)}
    .section-icon.faq{background:rgba(139,92,246,0.12)}
    .section-title{font-family:'Space Grotesk',sans-serif;font-size:1.3rem;font-weight:700}
    .spots-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem}
    .spot-card{background:var(--dusk);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1.25rem;transition:border-color 0.2s,transform 0.2s}
    .spot-card:hover{border-color:rgba(0,194,224,0.3);transform:translateY(-2px)}
    .spot-card h3{font-size:1rem;font-weight:700;margin-bottom:0.5rem}
    .spot-card-tags{display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.6rem}
    .spot-tag{font-size:0.72rem;font-weight:600;padding:0.2rem 0.6rem;border-radius:100px;border:1px solid}
    .tag-wave{color:var(--ocean);border-color:rgba(26,144,216,0.35);background:rgba(26,144,216,0.08)}
    .tag-beginner{color:var(--green);border-color:var(--green-border);background:var(--green-bg)}
    .tag-inter{color:#f59e0b;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.08)}
    .tag-advanced{color:var(--coral);border-color:rgba(255,107,53,0.3);background:rgba(255,107,53,0.08)}
    .spot-card p{font-size:0.85rem;color:var(--white-55);line-height:1.5}
    .level-section{margin-top:2rem}
    .level-header{display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--border)}
    .level-badge{display:inline-flex;align-items:center;gap:0.4rem;padding:0.35rem 0.9rem;border-radius:100px;font-size:0.8rem;font-weight:700}
    .level-badge.beginner{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
    .level-badge.intermediate{background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.25)}
    .level-badge.advanced{background:rgba(255,107,53,0.1);color:var(--coral-light);border:1px solid rgba(255,107,53,0.25)}
    .level-label{font-size:0.9rem;color:var(--white-55)}
    .boards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem}
    .board-card{background:var(--dusk);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;text-decoration:none;color:var(--white);transition:transform 0.2s,box-shadow 0.2s,border-color 0.2s}
    .board-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,0.3);border-color:rgba(0,194,224,0.25)}
    .board-card-img{width:100%;height:180px;background-size:cover;background-position:center;background-color:var(--surface)}
    .board-card-body{padding:1rem}
    .board-card-type{display:inline-block;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--primary);background:rgba(0,194,224,0.1);border:1px solid rgba(0,194,224,0.2);border-radius:100px;padding:0.15rem 0.5rem;margin-bottom:0.35rem}
    .board-card-level{display:inline-block;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;border-radius:100px;padding:0.15rem 0.5rem;margin-left:0.4rem}
    .board-card-level.level-beginner{color:var(--green);background:var(--green-bg);border:1px solid var(--green-border)}
    .board-card-level.level-intermediate{color:#f59e0b;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25)}
    .board-card-level.level-advanced{color:var(--coral-light);background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.25)}
    .board-card-title{font-size:0.95rem;font-weight:700;margin-bottom:0.4rem;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .board-card-meta{display:flex;gap:0.75rem;font-size:0.78rem;color:var(--white-55);margin-bottom:0.6rem}
    .board-card-bottom{display:flex;justify-content:space-between;align-items:center}
    .board-card-price{font-size:1.1rem;font-weight:800}
    .board-card-price small{font-size:0.75rem;font-weight:500;color:var(--white-55)}
    .board-card-rating{font-size:0.82rem;color:var(--gold)}
    .board-card-rating small{color:var(--white-30)}
    .boards-empty{background:var(--dusk);border:1px dashed var(--border);border-radius:var(--radius);padding:2.5rem;text-align:center;color:var(--white-55)}
    .boards-empty strong{color:var(--white);display:block;margin-bottom:0.5rem;font-size:1.1rem}
    .conditions-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem}
    .condition-item{background:var(--dusk);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem}
    .condition-item .label{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-30);font-weight:600;margin-bottom:0.35rem}
    .condition-item .value{font-size:0.9rem;font-weight:600;color:var(--white-80)}
    .faq-list{display:flex;flex-direction:column;gap:0.75rem}
    .faq-item{background:var(--dusk);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1.25rem}
    .faq-item h4{font-size:0.95rem;font-weight:700;margin-bottom:0.4rem;color:var(--white)}
    .faq-item p{font-size:0.88rem;color:var(--white-55);line-height:1.6}
    .cta-dual{margin-top:3.5rem;margin-bottom:3rem;display:grid;grid-template-columns:1fr 1fr;gap:1.25rem}
    .cta-card{border-radius:var(--radius);padding:2rem;text-align:center}
    .cta-card.host{background:linear-gradient(135deg,var(--coral),#ff8c42);color:white}
    .cta-card.rider{background:linear-gradient(135deg,var(--ocean),#0088cc);color:white}
    .cta-card h2{font-size:1.3rem;font-weight:800;margin-bottom:0.5rem}
    .cta-card p{font-size:0.9rem;opacity:0.9;margin-bottom:1.25rem}
    .cta-btn{display:inline-block;background:white;padding:0.75rem 2rem;border-radius:100px;font-weight:800;font-size:0.95rem;text-decoration:none;transition:transform 0.2s}
    .cta-card.host .cta-btn{color:var(--coral)}
    .cta-card.rider .cta-btn{color:var(--ocean-deep)}
    .cta-btn:hover{transform:translateY(-2px)}
    .promo-strip{background:linear-gradient(135deg,rgba(255,107,53,0.13) 0%,rgba(240,200,112,0.09) 100%);border:1px solid rgba(255,107,53,0.22);border-radius:var(--radius-sm);padding:0.8rem 1.25rem;margin:1.5rem 0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem}
    .promo-strip-left{display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap}
    .promo-strip-text{font-size:0.92rem;font-weight:600;color:var(--white-80)}
    .promo-strip-text strong{color:var(--white)}
    .promo-strip-code{display:inline-flex;align-items:center;background:rgba(255,107,53,0.18);border:1.5px dashed rgba(255,107,53,0.6);border-radius:6px;padding:0.25rem 0.65rem;font-family:monospace;font-weight:800;font-size:0.95rem;color:var(--coral);letter-spacing:0.06em;cursor:pointer;user-select:all}
    .promo-strip-sub{font-size:0.72rem;color:var(--white-30)}
    .promo-strip-cta{display:inline-flex;align-items:center;gap:0.3rem;background:var(--coral);color:white;padding:0.4rem 1rem;border-radius:100px;font-size:0.8rem;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0}
    /* footer */
    .site-footer{position:relative;background:linear-gradient(180deg,#060d18 0%,#040a12 100%);color:rgba(255,255,255,0.5);padding:0;margin-top:2rem;overflow:hidden}
    .site-footer::before{content:'';position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:800px;height:400px;border-radius:50%;background:radial-gradient(ellipse,rgba(255,107,53,0.04) 0%,transparent 70%);pointer-events:none}
    .footer-nl-band{position:relative;background:linear-gradient(135deg,rgba(255,107,53,0.06) 0%,rgba(255,107,53,0.02) 100%);border-bottom:1px solid rgba(255,255,255,0.04)}
    .footer-nl-band-inner{max-width:1100px;margin:0 auto;padding:3.5rem 2.5rem;display:flex;align-items:center;gap:3rem}
    .footer-nl-text{flex:1;min-width:0}
    .footer-nl-text h3{font-family:'Syne',sans-serif;font-weight:700;font-size:1.35rem;color:rgba(255,255,255,0.92);margin-bottom:0.6rem;letter-spacing:-0.02em}
    .footer-nl-text h3 span{color:var(--coral)}
    .footer-nl-text p{font-size:0.88rem;color:rgba(255,255,255,0.35);font-family:'DM Sans',sans-serif;line-height:1.6;max-width:380px}
    .footer-newsletter-form{display:flex;gap:0.65rem;flex-shrink:0;width:380px}
    .footer-newsletter-form input[type="email"]{flex:1;padding:0.9rem 1.1rem;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.04);color:#fff;font-size:0.88rem;outline:none;font-family:'DM Sans',sans-serif;transition:all 0.3s;box-sizing:border-box;min-width:0;backdrop-filter:blur(8px)}
    .footer-newsletter-form input[type="email"]:focus{border-color:rgba(255,107,53,0.5);box-shadow:0 0 0 3px rgba(255,107,53,0.1);background:rgba(255,255,255,0.06)}
    .footer-newsletter-form input[type="email"]::placeholder{color:rgba(255,255,255,0.22)}
    .footer-newsletter-form button{padding:0.9rem 1.8rem;border:none;cursor:pointer;background:linear-gradient(135deg,#ff6b35 0%,#ff8a5c 100%);color:#fff;font-size:0.82rem;font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:0.04em;white-space:nowrap;border-radius:12px;transition:all 0.3s;box-shadow:0 2px 12px rgba(255,107,53,0.2)}
    .footer-newsletter-form button:hover{background:linear-gradient(135deg,#e8602f 0%,#ff7a48 100%);box-shadow:0 6px 28px rgba(255,107,53,0.3);transform:translateY(-2px)}
    .footer-accent-line{height:1px;background:linear-gradient(90deg,transparent,rgba(255,107,53,0.25) 20%,rgba(255,107,53,0.45) 50%,rgba(255,107,53,0.25) 80%,transparent)}
    .site-footer-inner{max-width:1100px;margin:0 auto;padding:5rem 2.5rem 0;position:relative}
    .footer-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:4rem;padding-bottom:4rem}
    .footer-brand .footer-logo{font-family:'Syne',sans-serif;font-weight:800;font-size:2.2rem;color:#fff;display:inline-block;text-decoration:none;letter-spacing:-0.04em;margin-bottom:1.4rem;transition:opacity 0.4s}
    .footer-brand .footer-logo:hover{opacity:0.7}
    .footer-brand .footer-logo em{font-style:normal;color:var(--coral)}
    .footer-brand .footer-tagline{font-size:0.88rem;line-height:1.8;color:rgba(255,255,255,0.28);font-family:'DM Sans',sans-serif;margin-bottom:2.25rem;max-width:280px}
    .footer-socials{display:flex;gap:0.7rem}
    .footer-social-btn{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);text-decoration:none;transition:all 0.3s}
    .footer-social-btn:hover{background:rgba(255,107,53,0.08);border-color:rgba(255,107,53,0.2);color:#ff6b35;transform:translateY(-3px)}
    .footer-social-btn svg{width:17px;height:17px}
    .footer-col h4{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.5);margin-bottom:1.8rem}
    .footer-col ul{list-style:none}
    .footer-col ul li{margin-bottom:0.9rem}
    .footer-col ul li a{font-size:0.88rem;color:rgba(255,255,255,0.35);text-decoration:none;display:inline-block;transition:color 0.25s;padding-bottom:1px}
    .footer-col ul li a:hover{color:rgba(255,255,255,0.9)}
    .footer-spot-tag{position:relative;padding-left:1.2rem}
    .footer-spot-tag::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:50%;background:var(--coral);opacity:0.3;transition:opacity 0.3s}
    .footer-spot-tag:hover::before{opacity:1}
    .footer-divider{height:1px;max-width:1100px;margin:0 auto;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.05) 20%,rgba(255,255,255,0.07) 50%,rgba(255,255,255,0.05) 80%,transparent)}
    .footer-trust-bar{display:flex;align-items:center;justify-content:center;gap:1.25rem;padding:2.5rem;max-width:1100px;margin:0 auto}
    .footer-trust-pill{display:flex;align-items:center;gap:0.6rem;padding:0.6rem 1.15rem;border-radius:100px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);font-size:0.78rem;color:rgba(255,255,255,0.4);font-family:'DM Sans',sans-serif;font-weight:500;transition:all 0.3s}
    .footer-trust-pill:hover{border-color:rgba(255,255,255,0.1);color:rgba(255,255,255,0.65);background:rgba(255,255,255,0.04);transform:translateY(-1px)}
    .footer-trust-pill svg{width:14px;height:14px;flex-shrink:0}
    .footer-trust-pill .trust-icon-lock{color:rgba(72,187,120,0.6)}
    .footer-trust-pill .trust-icon-check{color:rgba(99,179,237,0.6)}
    .footer-trust-pill .trust-icon-shield{color:rgba(255,107,53,0.6)}
    .footer-trust-pill:hover .trust-icon-lock{color:rgba(72,187,120,0.9)}
    .footer-trust-pill:hover .trust-icon-check{color:rgba(99,179,237,0.9)}
    .footer-trust-pill:hover .trust-icon-shield{color:rgba(255,107,53,0.9)}
    .footer-bottom{padding:2rem 2.5rem;display:flex;align-items:center;justify-content:space-between;max-width:1100px;margin:0 auto}
    .footer-bottom-copy{font-size:0.76rem;color:rgba(255,255,255,0.18);font-family:'DM Sans',sans-serif}
    .footer-bottom-links{display:flex;gap:2rem}
    .footer-bottom-links a{font-size:0.76rem;color:rgba(255,255,255,0.18);text-decoration:none;font-family:'DM Sans',sans-serif;transition:color 0.25s}
    .footer-bottom-links a:hover{color:rgba(255,255,255,0.5)}
    @media(max-width:700px){.spot-hero{grid-template-columns:1fr;gap:1.5rem}.hero-cta{min-width:unset}.cta-dual{grid-template-columns:1fr}.boards-grid{grid-template-columns:1fr}.conditions-grid{grid-template-columns:1fr 1fr}.nav-links{display:none}.footer-nl-band-inner{flex-direction:column;gap:1.5rem;padding:2.5rem 1.5rem;text-align:center}.footer-nl-text p{max-width:100%}.footer-newsletter-form{width:100%;max-width:400px;margin:0 auto}.footer-grid{grid-template-columns:1fr 1fr;gap:2.5rem}.footer-trust-bar{gap:0.75rem;flex-wrap:wrap;justify-content:flex-start;padding:2rem 1.5rem}.site-footer-inner{padding:3.5rem 1.5rem 0}.footer-bottom{padding:1.5rem 1.5rem;flex-direction:column;align-items:flex-start;gap:0.7rem}.footer-bottom-links{gap:1.25rem;flex-wrap:wrap}}
    @media(max-width:480px){.footer-newsletter-form{flex-direction:column;width:100%}.footer-newsletter-form button{width:100%}.footer-grid{grid-template-columns:1fr;gap:2rem}}
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-logo">Qiv<em>er</em></a>
    <div class="nav-links">
      <a href="/" class="nav-link">Accueil</a>
      <a href="/app.html" class="nav-link">Planches</a>
      <a href="/blog" class="nav-link">Blog</a>
      <a href="/partner" class="nav-link">Partenaires</a>
    </div>
    <a href="/app.html" class="nav-cta">\ud83e\udd97 Louer une board</a>
  </nav>

  <div class="breadcrumb"><a href="/">Swell</a> \u203a <a href="/app.html">Spots</a> \u203a ${esc(meta.displayName)}</div>

  <div class="spot-hero">
    <div class="spot-hero-text">
      <h1>${esc(meta.heroHeadline)}</h1>
      <p class="hero-sub">${esc(meta.heroSub)}</p>
      <div class="spot-hero-stats">
        <div class="stat-pill">\ud83e\udd97 <strong>${total}</strong> board${total !== 1 ? 's' : ''} dispo</div>
        <div class="stat-pill">\ud83d\udccd <strong>${meta.spots.length}</strong> spots</div>
        <div class="stat-pill">\ud83c\udf0d ${esc(meta.region)}</div>
      </div>
    </div>
    <div class="hero-cta">
      <a href="/app.html?spot=${slug}" class="btn-primary">\ud83e\udd97 Voir les boards \u2192</a>
      <a href="/app.html#list" class="btn-secondary">Lister ma planche \u2192</a>
    </div>
  </div>

  <div class="container">

    <div class="promo-strip">
      <div class="promo-strip-left">
        <span class="promo-strip-text">\ud83c\udf89 Ta premi\u00e8re session \u00e0 <strong>-50%</strong></span>
        <span class="promo-strip-code" onclick="navigator.clipboard?.writeText('FIRSTSESSION50').then(()=>{this.textContent='\u2713 Copi\u00e9!';setTimeout(()=>this.textContent='FIRSTSESSION50',1500)}).catch(()=>{})" title="Copier le code">FIRSTSESSION50</span>
        <span class="promo-strip-sub">Max. \u20ac15 \u00b7 1\u00e8re r\u00e9sa \u00e0 l'heure</span>
      </div>
      <a href="/app.html" class="promo-strip-cta">R\u00e9server \u2192</a>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-icon spots">\ud83d\udccd</div><h2 class="section-title">Les spots \u00e0 ${esc(meta.displayName)}</h2></div>
      <div class="spots-grid">
        ${meta.spots.map(s => {
          const lc = s.level === 'beginner' ? 'tag-beginner' : s.level === 'advanced' ? 'tag-advanced' : 'tag-inter';
          return `<div class="spot-card"><h3>${esc(s.name)}</h3><div class="spot-card-tags"><span class="spot-tag tag-wave">\ud83c\udf0a Beach Break</span><span class="spot-tag ${lc}">${esc(LEVEL_LABELS[s.level] || s.level)}</span></div><p>${esc(s.desc)}</p></div>`;
        }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-icon boards">\ud83e\udd97</div><h2 class="section-title">Boards disponibles \u2014 par niveau</h2></div>
      ${total === 0 ? `<div class="boards-empty"><strong>Pas encore de boards ici</strong>Sois le premier \u00e0 lister ta planche \u00e0 ${esc(meta.displayName)} \u2014 c'est gratuit et \u00e7a prend 10 min.<br><br><a href="/app.html#list" class="btn-primary" style="display:inline-block;">Lister ma board \u2192</a></div>` : ''}
      ${byLevel.beginner.length > 0 ? `<div class="level-section"><div class="level-header"><span class="level-badge beginner">\ud83c\udf0a D\u00e9butant</span><span class="level-label">Vagues molles et longues, parfaites pour progresser. Location \u00e0 partir de ${byLevel.beginner.find(x => x.hourly_rate_cents) ? `\u20ac${(byLevel.beginner.find(x => x.hourly_rate_cents).hourly_rate_cents / 100).toFixed(0)}/h` : ''}.</span></div><div class="boards-grid">${byLevel.beginner.map(b => renderBoardCard(b, 'beginner')).join('')}</div></div>` : ''}
      ${byLevel.intermediate.length > 0 ? `<div class="level-section"><div class="level-header"><span class="level-badge intermediate">\ud83e\udd97 Interm\u00e9diaire</span><span class="level-label">Vagues structur\u00e9es et puissantes. Pr\u00eat pour La Nord ou la Plage Centrale.</span></div><div class="boards-grid">${byLevel.intermediate.map(b => renderBoardCard(b, 'intermediate')).join('')}</div></div>` : ''}
      ${byLevel.advanced.length > 0 ? `<div class="level-section"><div class="level-header"><span class="level-badge advanced">\ud83d\udd25 Avanc\u00e9</span><span class="level-label">Puissance, tubes, speed. La Gravi\u00e8re et Les Culs Nus n\u2019attendent que toi.</span></div><div class="boards-grid">${byLevel.advanced.map(b => renderBoardCard(b, 'advanced')).join('')}</div></div>` : ''}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-icon conditions">\ud83c\udf24\ufe0f</div><h2 class="section-title">Conditions de surf \u00e0 ${esc(meta.displayName)}</h2></div>
      <div class="conditions-grid">
        <div class="condition-item"><div class="label">Meilleure saison</div><div class="value">${esc(meta.conditions.bestSeason)}</div></div>
        <div class="condition-item"><div class="label">Temp\u00e9rature eau</div><div class="value">${esc(meta.conditions.waterTemp)}</div></div>
        <div class="condition-item"><div class="label">Vent id\u00e9al</div><div class="value">${esc(meta.conditions.bestWind)}</div></div>
        <div class="condition-item"><div class="label">Mar\u00e9e id\u00e9ale</div><div class="value">${esc(meta.conditions.bestTide)}</div></div>
        <div class="condition-item"><div class="label">Taille des vagues</div><div class="value">${esc(meta.conditions.waveHeight)}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-icon faq">\u2753</div><h2 class="section-title">FAQ \u2014 ${esc(meta.displayName)}</h2></div>
      <div class="faq-list">${meta.faq.map(f => `<div class="faq-item"><h4>${esc(f.q)}</h4><p>${esc(f.a)}</p></div>`).join('')}</div>
    </div>

    <div class="cta-dual">
      <div class="cta-card host"><h2>Tu as une board ici ?</h2><p>Liste ta planche \u00e0 ${esc(meta.displayName)} \u2014 c'est gratuit, garantie par Swell Shield.</p><a href="/app.html#list" class="cta-btn">Lister ma board \u2192</a></div>
      <div class="cta-card rider"><h2>Tu cherches une board ?</h2><p>Trouve la planche parfaite lou\u00e9e par des surfeurs locaux.</p><a href="/app.html?spot=${slug}" class="cta-btn">Voir les boards \u2192</a></div>
    </div>
  </div>

  <footer class="site-footer">
    <div class="footer-accent-line"></div>
    <div class="footer-nl-band">
      <div class="footer-nl-band-inner">
        <div class="footer-nl-text"><h3>Reste dans le <span>lineup</span></h3><p>Spots, boards rares, nouveaux riders &mdash; dans ta bo\u00eete, pas ton feed.</p></div>
        <form class="footer-newsletter-form" onsubmit="event.preventDefault();const b=this.querySelector('button');b.textContent='\u2713 Inscrit !';b.style.opacity='0.7';setTimeout(()=>{b.textContent='S\u2019inscrire \u2192';b.style.opacity='1';},2000);">
          <input type="email" placeholder="ton@email.com" required autocomplete="email">
          <button type="submit">S&rsquo;inscrire &rarr;</button>
        </form>
      </div>
    </div>
    <div class="site-footer-inner">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="footer-logo">qi<em>v</em>er</a>
          <p class="footer-tagline">Arrive l\u00e9ger. Surfe local.<br>Location de planches entre surfeurs &mdash; sans shop, sans interm\u00e9diaire.</p>
          <div class="footer-socials">
            <a href="mailto:swell@polsia.app" class="footer-social-btn" aria-label="Email"><svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M22 6l-10 7L2 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
            <a href="https://instagram.com/swell_surf" target="_blank" rel="noopener noreferrer" class="footer-social-btn" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg></a>
            <a href="https://tiktok.com/@swell_surf" target="_blank" rel="noopener noreferrer" class="footer-social-btn" aria-label="TikTok"><svg viewBox="0 0 24 24" fill="none"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
          </div>
        </div>
        <div class="footer-col"><h4>Navigation</h4><ul><li><a href="/">Accueil</a></li><li><a href="/app.html">Marketplace</a></li><li><a href="/blog">Blog</a></li><li><a href="/partner">Partenaires</a></li></ul></div>
        <div class="footer-col"><h4>Spots</h4><ul><li><a href="/spots/hossegor" class="footer-spot-tag">Hossegor</a></li><li><a href="/spot/seignosse" class="footer-spot-tag">Seignosse</a></li><li><a href="/spot/capbreton" class="footer-spot-tag">Capbreton</a></li><li><a href="/spot/cote-des-basques" class="footer-spot-tag">C\u00f4te des Basques</a></li><li><a href="/spot/lafitenia" class="footer-spot-tag">Lafitenia</a></li></ul></div>
      </div>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-trust-bar">
      <span class="footer-trust-pill"><svg class="trust-icon-lock" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Paiement s\u00e9curis\u00e9</span>
      <span class="footer-trust-pill"><svg class="trust-icon-check" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Identit\u00e9 v\u00e9rifi\u00e9e</span>
      <span class="footer-trust-pill"><svg class="trust-icon-shield" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Garantie dommages</span>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-bottom">
      <span class="footer-bottom-copy">&copy; 2026 Swell &mdash; Made in Hossegor \ud83e\udd19</span>
      <div class="footer-bottom-links"><a href="/cgv">CGU / CGV</a><a href="/confidentialite">Confidentialit\u00e9</a><a href="mailto:swell@polsia.app">Contact</a></div>
    </div>
  </footer>
</body>
</html>`;
}

// ─── Route ────────────────────────────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const meta = SPOT_META[slug];

  if (!meta) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>Spot non trouv\u00e9 | Swell</title></head>
      <body style="background:#0e1e36;color:#fff;font-family:sans-serif;text-align:center;padding:4rem;">
        <h1>Spot non trouv\u00e9</h1>
        <p>Essaie : <a href="/spots/hossegor" style="color:#00c2e0;">Hossegor</a></p>
        <br><a href="/" style="color:#ff6b35;">\u2190 Retour \u00e0 Swell</a>
      </body></html>`);
  }

  try {
    const boards = await getBoardsByLevel(slug);
    const html = renderSpotPage(slug, meta, boards);
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(html);
  } catch (err) {
    console.error(`GET /spots/${slug} error:`, err);
    res.status(500).send('Erreur serveur \u2014 r\u00e9essayez plus tard.');
  }
});

module.exports = router;