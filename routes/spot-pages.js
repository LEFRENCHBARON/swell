// What this module owns: server-rendered /spot/:slug landing pages.
// Each page is a mini-marketplace: live boards, spot guide, conditions, FAQ, reviews.
// Does NOT own the surf_spots API or board CRUD — those are in routes/spots.js and routes/boards.js.
const express = require('express');
const router = express.Router();
const { getSpotPageData, getSpotAvailableTodayCount, getNearbySpots, getPartnersByLocation } = require('../db/spotPages');

const BASE_URL = 'https://swell.polsia.app';

// Absolute fallback — social scrapers require absolute OG image URLs to render previews.
const OG_IMAGE = `${BASE_URL}/og-image.svg`;

const BLOCKED_PHOTO_HOSTS = ['unsplash.com', 'images.unsplash.com', 'picsum.photos', 'googleusercontent.com'];
function sanitizePhotoUrl(url) {
  if (!url || typeof url !== 'string') return OG_IMAGE;
  try {
    const { hostname, href } = new URL(url);
    return BLOCKED_PHOTO_HOSTS.includes(hostname) ? OG_IMAGE : href;
  } catch {
    return url.startsWith('/') ? `${BASE_URL}${url}` : url;
  }
}

// ─── Spot metadata: rich local content for each supported spot page ─────────
const SPOT_META = {
  hossegor: {
    displayName: 'Hossegor',
    emoji: '🌊',
    region: 'Landes',
    heroHeadline: 'Loue une planche de surf à Hossegor',
    heroSubtext: 'La Gravière, Les Culs Nus, Plage Centrale — beach breaks de classe mondiale',
    tagline: 'Le pipeline européen — beach breaks de classe mondiale',
    bestSeason: 'Septembre à Novembre (grosses houles), Mai à Juillet (plus accessible)',
    typicalWaves: '1m à 3m+ selon les bancs. Creux, puissant, rapide.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée montante à marée haute',
    surfSchools: [
      { name: 'Tao Surf School', type: 'École', desc: 'Cours collectifs et privés, tous niveaux' },
      { name: 'Quiksilver Surf School Hossegor', type: 'École', desc: 'La référence — certifiée WQS' },
      { name: 'Jo Moraiz Surf School', type: 'École', desc: 'Coaching avancé et surf trips guidés' },
    ],
    shops: [
      { name: 'Boardriders Hossegor', type: 'Shop', desc: 'Shop Quiksilver/Roxy — achat, réparation' },
      { name: 'Natural Surf Shop', type: 'Shop', desc: 'Boards neuves et occasion, shapers locaux' },
    ],
    faq: [
      { q: 'Où loger à Hossegor ?', a: 'Le centre-ville est à 10 min à pied des spots. Airbnb ou camping Les Oyats pour le budget.' },
      { q: 'Où manger après le surf ?', a: 'Dick\'s Sand Bar (fish tacos), Jean Bart (fruits de mer), Le Surfing (burgers).' },
      { q: 'Où surfer si c\'est trop gros ?', a: 'Descends à Capbreton (La Piste) ou remonte à Seignosse (Le Penon) — plus abrité.' },
      { q: 'Faut-il une combinaison ?', a: 'Oui, toute l\'année. 4/3mm d\'octobre à mai, 3/2mm ou shorty en été.' },
    ],
    metaTitle: 'Louer une planche de surf à Hossegor 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Hossegor été 2026 entre particuliers. Shortboards, longboards, fish — livrés sur le spot. La Gravière, Les Culs Nus. Protection dommages incluse.',
  },
  seignosse: {
    displayName: 'Seignosse',
    emoji: '🏄',
    region: 'Landes',
    tagline: 'Les bancs de sable parfaits — le sweet spot landais',
    heroHeadline: 'Loue une planche à Seignosse cet été',
    heroSubtext: 'Estagnots, Le Penon, Les Bourdaines — vagues longues, niveau intermédiaire → avancé',
    bestSeason: 'Juin à Octobre (régulier), Mars à Mai (sessions quality)',
    typicalWaves: '0.8m à 2.5m. Beach breaks bien formés, plus réguliers qu\'Hossegor.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Toutes marées (selon les bancs)',
    surfSchools: [
      { name: 'Surf Seignosse School', type: 'École', desc: 'Cours sur Les Estagnots et Les Bourdaines' },
      { name: 'Ocean Adventure', type: 'École', desc: 'Stages semaine et coaching intermédiaire' },
    ],
    shops: [
      { name: 'Session Glisse', type: 'Shop', desc: 'Location et vente de matériel — shapers locaux' },
    ],
    faq: [
      { q: 'Où loger à Seignosse ?', a: 'Seignosse-Océan est le plus proche des spots. Camping ou location saisonnière.' },
      { q: 'Où manger ?', a: 'Le White (beach bar), Chez Manon (tapas locales), Sushi Maki pour changer.' },
      { q: 'Où surfer si c\'est petit ?', a: 'Les Estagnots capte le moindre swell. Sinon, check Les Bourdaines à marée basse.' },
      { q: 'C\'est adapté aux débutants ?', a: 'Oui ! Le Penon est un des meilleurs spots école des Landes.' },
    ],
    metaTitle: 'Louer une planche de surf à Seignosse 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Seignosse été 2026 entre particuliers. Estagnots, Le Penon, Bourdaines. Vagues parfaites, protection dommages incluse.',
  },
  capbreton: {
    displayName: 'Capbreton',
    emoji: '⛵',
    region: 'Landes',
    heroHeadline: 'Loue une planche de surf à Capbreton',
    heroSubtext: 'La Piste, Le Santocha — spots protégés, niveau débutant → intermédiaire',
    tagline: 'Le port qui surfe — spots protégés et vagues accessibles',
    bestSeason: 'Toute l\'année — protégé par la digue quand c\'est gros',
    typicalWaves: '0.5m à 1.5m. Plus petit et plus doux que les voisins.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Nord-Est',
    bestTide: 'Mi-marée à marée haute',
    surfSchools: [
      { name: 'Capbreton Surf Club', type: 'École', desc: 'Le club local — cours dès 6 ans' },
      { name: 'Ride & Slide', type: 'École', desc: 'Cours débutants et perfectionnement' },
    ],
    shops: [
      { name: 'Gliss\'Corner', type: 'Shop', desc: 'Vente et réparation boards' },
    ],
    faq: [
      { q: 'Où loger à Capbreton ?', a: 'Le port est super animé l\'été. Hôtel Océan ou camping Le Civelle.' },
      { q: 'Où manger ?', a: 'Le Regalty (port, poisson frais), La Bodega du Surfeur (tapas), Chez Tintin (pizza).' },
      { q: 'Où surfer si c\'est trop petit ?', a: 'Monte à Hossegor (5 min) — La Gravière capte tout.' },
      { q: 'C\'est bien pour les enfants ?', a: 'Parfait. Le Santocha est un des spots les plus safe de la côte.' },
    ],
    metaTitle: 'Louer une planche de surf à Capbreton 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Capbreton été 2026 entre particuliers. La Piste, Le Santocha — spots protégés, vagues accessibles. Idéal débutants et familles.',
  },
  'cote-des-basques': {
    displayName: 'Côte des Basques',
    emoji: '🏖️',
    region: 'Pays Basque',
    heroHeadline: 'Loue une planche de surf à la Côte des Basques',
    heroSubtext: 'Biarritz — longboard paradise, berceau du surf européen',
    tagline: 'Le berceau du surf européen — vagues douces, vue mythique',
    bestSeason: 'Juin à Septembre (meilleur combo vagues + météo)',
    typicalWaves: '0.5m à 1.5m. Longues et molles — paradis du longboard.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Marée basse à mi-marée montante',
    surfSchools: [
      { name: 'Hastea Surf School', type: 'École', desc: 'L\'école historique de la Côte des Basques' },
      { name: 'Jo Moraiz Biarritz', type: 'École', desc: 'Cours longboard et shortboard' },
    ],
    shops: [
      { name: 'Euroglass Biarritz', type: 'Shop', desc: 'Réparation et shape — le glassman de Biarritz' },
      { name: 'Radical Surf Shop', type: 'Shop', desc: 'Boards neuves, accessoires, wax' },
    ],
    faq: [
      { q: 'Où loger à Biarritz ?', a: 'Le quartier Port Vieux ou Beaurivage sont à 5 min à pied du spot.' },
      { q: 'Où manger ?', a: 'Le Comptoir du Foie Gras (tapas basques), Bar Jean (pintxos), Etxola Bibi (burgers).' },
      { q: 'Où surfer si c\'est flat ?', a: 'Grande Plage (plus exposée) ou descends à Bidart si besoin de plus de taille.' },
      { q: 'Pourquoi ce spot est spécial ?', a: 'C\'est ici que le surf est né en Europe en 1957. Ambiance longboard, vue sur les falaises.' },
    ],
    metaTitle: 'Louer une planche de surf à Côte des Basques, Biarritz 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Côte des Basques été 2026 entre particuliers. Biarritz, spot mythique du surf européen. Vagues longues, vue imprenable. Protection dommages.',
  },
  anglet: {
    displayName: 'Anglet',
    emoji: '🌅',
    region: 'Landes',
    tagline: "Le spot secret des Landes — moins de monde, vagues consistantes, entre Hossegor et Biarritz",
    heroHeadline: 'Loue une planche à Anglet cet été',
    heroSubtext: "Les Cavaliers, La Barre, Le Club — niveau intermédiaire → avancé, boards performantes",
    bestSeason: 'Juin à Octobre (meilleur ratio crowd/vagues), Avril-Mai pour sessions calmes',
    typicalWaves: '0.8m à 2.5m. Beach breaks puissants et réguliers, moins crowded qu’Hossegor.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée montante à marée haute',
    surfSchools: [
      { name: 'Anglet Surf Club', type: 'École', desc: "Le club local aux Cavaliers — tous niveaux, encadrement qualifié" },
      { name: 'Pacific Surf School', type: 'École', desc: 'Cours sur La Barre — petit groupe, coaching intermédiaire' },
    ],
    shops: [
      { name: 'Boardriders Anglet', type: 'Shop', desc: 'Shop partenaire — boards, combinaisons, réparation' },
    ],
    faq: [
      { q: 'Où loger à Anglet ?', a: "Le quartier des Cavaliers est à 5 min à pied de la plage. Résidences de bord de mer ou location saisonnière." },
      { q: 'C\u2019est plus calme qu\u2019Hossegor ?', a: "Oui, Anglet attire moins de monde. Les Cavaliers restent consistants même quand Hossegor est saturé." },
      { q: "Quelle board pour Les Cavaliers ?", a: "Une performante 6\u20198\u2019 à 7\u20196\u2019. Le spot capte bien les houles Atlantiques \u2014 besoin de drive et maniabilité." },
      { q: "Faut-il une combinaison ?", a: "Oui, toute l\u2019année \u2014 3/2mm d\u2019avril à octobre, 4/3mm en hiver. L\u2019eau reste froide sur la côte Basque." },
    ],
    metaTitle: 'Louer une planche de surf à Anglet 2026 | Swell — Particuliers à particuliers',
    metaDesc: "Location planche surf Anglet été 2026 entre particuliers. Les Cavaliers, La Barre — beach breaks puissants, moins de crowd. Protection dommages incluse.",
  },

  lafitenia: {
    displayName: 'Lafitenia',
    emoji: '🔥',
    region: 'Pays Basque',
    heroHeadline: 'Loue une planche de surf à Lafitenia',
    heroSubtext: 'Saint-Jean-de-Luz — point break de référence, droites interminables',
    tagline: 'Le point break de référence — droites interminables',
    bestSeason: 'Octobre à Mars (gros swells NO), Mai à Juin (sessions clean)',
    typicalWaves: '1m à 3m. Droites longues et puissantes sur reef/roche.',
    waterTemp: '13°C (hiver) — 20°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Mi-marée montante à marée haute',
    surfSchools: [
      { name: 'Uhaina Surf School', type: 'École', desc: 'Cours à Lafitenia et spots proches — encadrement pro' },
    ],
    shops: [
      { name: 'Lafitenia Surf Shop', type: 'Shop', desc: 'Le local shop — boards, combinaisons, réparation' },
    ],
    faq: [
      { q: 'Où loger près de Lafitenia ?', a: 'Saint-Jean-de-Luz (5 min en voiture). Hôtels de charme ou camping Itsas Mendi.' },
      { q: 'Où manger ?', a: 'Chez Pantxoa (fruits de mer), Olatua (tapas basques), Grillerie du Port.' },
      { q: 'Faut-il être expert pour surfer ici ?', a: 'Niveau intermédiaire+ minimum. Les jours de gros swell, confirmés uniquement.' },
      { q: 'Où surfer si c\'est trop gros ?', a: 'La Sauvage (beach break voisin) ou Hendaye (débutant friendly).' },
    ],
    metaTitle: 'Louer une planche de surf à Lafitenia, Saint-Jean-de-Luz 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Lafitenia été 2026 entre particuliers. Saint-Jean-de-Luz, meilleur point break du Pays Basque. Droites parfaites, protection dommages incluse.',
  },
  biarritz: {
    displayName: 'Biarritz',
    emoji: '🏖️',
    region: 'Pays Basque',
    tagline: 'Le berceau du surf européen — vagues douces pour tous, vue imprenable sur les Pyrénées',
    heroHeadline: 'Loue une planche de surf à Biarritz cet été',
    heroSubtext: 'Côte des Basques, Grande Plage, Milady — spots parfaits pour les débutants et intermédiaires',
    bestSeason: 'Juin à Septembre (meilleur combo vagues + météo, events et ambiance)',
    typicalWaves: '0.5m à 1.5m. Beach breaks doux, longues gauches à la Côte des Basques.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Marée basse à mi-marée montante',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Hastea Surf School', type: 'École', desc: "L'école historique de la Côte des Basques — tous niveaux" },
      { name: 'Jo Moraiz Biarritz', type: 'École', desc: 'Cours longboard et coaching intermédiaire' },
      { name: 'Biarritz Surf School', type: 'École', desc: 'École familiale sur la Grande Plage — dès 6 ans' },
    ],
    shops: [
      { name: 'Euroglass Biarritz', type: 'Shop', desc: 'Réparation et shape — le glassman de Biarritz depuis 1988' },
      { name: 'Radical Surf Shop', type: 'Shop', desc: 'Boards neuves, accessoires, wax et combinaisons' },
      { name: 'Le Surf Lodge', type: 'Shop', desc: 'Location quotidienne et vente boards d&#8217;occasion' },
    ],
    faq: [
      { q: 'Où loger à Biarritz ?', a: "Le quartier Port Vieux ou Beaurivage sont à 5 min à pied des spots. La Côte des Basques côté falaises offre des vues spectaculaires." },
      { q: 'Où manger après le surf ?', a: 'Le Comptoir du Foie Gras (tapas basques), Bar Jean (pintxos), Etxola Bibi (burgers). Food-truck du Port pour les petits budgets.' },
      { q: "Où surfer si c'est trop petit ?", a: 'Grande Plage capte mieux le swell. Sinon descends à Bidart ou Guéthary — plus de puissance, droites nickels.' },
      { q: "C'est adapté aux débutants ?", a: "Oui, Biarritz est parfait pour débuter. Côte des Basques et Milady sont les spots les plus doux. Évite la Grande Plage les jours de forte affluence." },
      { q: "Combien ça coûte de louer une planche ?", a: "Avec Swell, compte 8 à 15€/h selon la board. Paiement à l'heure, sans engagement — la flexibilité idéale pour les vacances." },
      { q: "Faut-il une combinaison en été ?", a: "Même en août, une 3/2mm ou shorty est recommandée. L'eau reste à 19-21°C en été. Les shops en prêtent aussi." },
    ],
    metaTitle: 'Louer une planche de surf à Biarritz 2026 | Swell — Particuliers à particuliers',
    metaDesc: "Location planche surf Biarritz été 2026 entre particuliers. Côte des Basques, Grande Plage — pour tous niveaux. Location de l'heure à la journée, protection dommages incluse.",
  },
  'sables-d-olonne': {
    displayName: 'Les Sables-d\u2019Olonne',
    emoji: '🏖️',
    region: 'Vendée',
    tagline: 'Le joyau atlantique de la Vendée — plage idéale familles et débutants',
    heroHeadline: 'Loue une planche aux Sables-d\u2019Olonne cet été',
    heroSubtext: 'Grande Plage, Olonna Surf Club, Surfzone — niveau débutant \u2192 intermédiaire',
    bestSeason: 'Juin à Septembre (vagues douces, météo stable, affluence familiale)',
    typicalWaves: '0.5m à 1.2m. Beach breaks doux et réguliers. Fond sableux, sécurité maximale.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Ouest / Nord-Ouest',
    bestTide: 'Marée basse à mi-marée (zones les plus sûres à marée haute)',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Olonna Surf Club', type: 'École', desc: 'Le club historique des Sables-d\u2019Olonne — cours collectifs et particuliers, tous niveaux' },
      { name: 'Ocean Ride Surf School', type: 'École', desc: 'École sur la Grande Plage — initiation, perfectionnement, stages été' },
    ],
    shops: [
      { name: 'Surfzone Les Sables', type: 'Shop', desc: 'Location quotidienne, vente de matériel, près de la plage' },
      { name: 'Aquatonic Surf Shop', type: 'Shop', desc: 'Boards, combinaisons, accessoires — rue du Marais' },
    ],
    faq: [
      { q: 'Où loger aux Sables-d\u2019Olonne ?', a: 'Le quartier plage est à 10 min du centre. Réservez tôt en juillet/août — la Vendée se remplit. Campings\u00a0+ Apparts pour budget.' },
      { q: 'Est-ce adapté aux enfants ?', a: 'Parfait. La Grande Plage est l\u2019un des spots Vendée les plus sûrs. Eaux peu profondes, fond sableux, rescue présents en saison.' },
      { q: 'Faut-il une combinaison ?', a: 'Oui même en été\u00a0: shorty ou 3/2mm recommandé. L\u2019eau monte à 19-21°C en août mais le vent peut rafraîchir.' },
      { q: 'C\u2019est bien pour les intermédiaires ?', a: 'La Surfzone au sud capte plus de swell quand ça monte. Bon compromis familles: adultes sur Grande Plage, plus costauds côté Surfzone.' },
    ],
    metaTitle: 'Louer une planche de surf aux Sables-d\u2019Olonne 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Sables-d\u2019Olonne été 2026 entre particuliers. Grande Plage, Olonna Surf Club — débutants et intermédiaires. Protection dommages incluse.',
  },
  'la-tranche-sur-mer': {
    displayName: 'La Tranche-sur-Mer',
    emoji: '🌊',
    region: 'Vendée',
    tagline: 'Le surf familial Vendée — spots doux, ambiance chill, spots pour tous niveaux',
    heroHeadline: 'Loue une planche à La Tranche-sur-Mer cet été',
    heroSubtext: 'La Terrière, Lobstore, Koa Surf School — 5 spots Vendée, tous niveaux',
    bestSeason: 'Juin à Septembre (meilleure affluence, vagues tendres, ambiance été)',
    typicalWaves: '0.4m à 1m. Beach breaks très doux, idéale pour progresser.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Nord / Nord-Est (vents thermiques)',
    bestTide: 'Marée basse à mi-marée (fond progressif, sécurité accrue)',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Koa Surf School La Tranche', type: 'École', desc: 'École de référence sur La Terrière — cours tous niveaux, équipement fourni' },
      { name: 'Lobstore Surf Club', type: 'École', desc: 'Club au nord de la plage — coaching intermédiaire, sessions matinales' },
      { name: 'La Tranche Surf Academy', type: 'École', desc: 'Stages été pour enfants et adultes — encadrés par moniteurs diplômés' },
    ],
    shops: [
      { name: 'Lobstore', type: 'Shop', desc: 'Le shop iconique de La Tranche — boards, combinaisons, réparation' },
      { name: 'Koa Surf Shop', type: 'Shop', desc: 'Location quotidienne, vente boards, près de la plage' },
      { name: 'Surf Club La Tranche', type: 'Shop', desc: 'Équipement, wax, accessoires, proche de la Terrière' },
    ],
    faq: [
      { q: 'Comment se rendre à La Tranche-sur-Mer ?', a: 'Depuis La Roche-sur-Yon (30 min) ou Nantes (1h15). Parking plage gratuit en dehors des pics + navette été.' },
      { q: 'C\u2019est adapté aux débutants complets ?', a: 'Absolument. La Terrière est l\u2019un des spots Vendée les plus accessibles. Fond progressif, vagues douces, écoles partout.' },
      { q: 'Quelle board choisir pour débuter ?', a: 'Une mousse ou longboard 8-9ft est idéal. Avec Swell, filtre par niveau « Débutant » et découvre les boards recommandées pour ta taille.' },
      { q: 'Y a-t-il des dangers ?', a: 'Peu de dangers côté water. Quelques baïnes possibles à marée haute — renseigne-toi sur les zones. Pas de reef ni de rochers sur les spots principaux.' },
      { q: 'Combien ça coûte de louer une planche ?', a: 'Avec Swell : 5 à 12\u20ac/h selon la board. Pas de minimum journée — tu paies uniquement ce que tu surfes.' },
    ],
    metaTitle: 'Louer une planche de surf à La Tranche-sur-Mer 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf La Tranche-sur-Mer été 2026 entre particuliers. La Terrière, Lobstore, Koa Surf School — tous niveaux. Protection dommages Vendée.',
  },

  'longeville-sur-mer': {
    displayName: 'Longeville-sur-Mer',
    emoji: '🏖️',
    region: 'Vendée',
    tagline: "Le spot Vendée de Bud Bud Contest — beach break puissant pour intermediates et confirmés",
    heroHeadline: 'Loue une planche à Longeville-sur-Mer cet été',
    heroSubtext: 'Bud Bud Contest, plage des Conches — niveau intermédiaire → avancé, boards performantes',
    bestSeason: 'Juin à Septembre (Bud Bud Contest août), Juillet pour sessions régulière',
    typicalWaves: '0.8m à 2m. Beach breaks puissante, creuse à marée haute. Capte les houles Atlantiques.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Est / Nord-Est',
    bestTide: 'Marée haute à mi-marée descendante (meilleures sections)',
    surfSchools: [
      { name: 'Bud Bud Surf School', type: 'École', desc: 'École locale sur la plage des Conches — tous niveaux, proximity au spot' },
      { name: 'Atlantic Surf Camp', type: 'École', desc: 'Stages été et coaching intermédiaire/avancé' },
    ],
    shops: [
      { name: 'Glisse Vendée', type: 'Shop', desc: 'Shop de proximité — boards, combinaisons, réparation' },
      { name: 'Aquatonic Longeville', type: 'Shop', desc: 'Location quotidienne, proche de la plage des Conches' },
    ],
    faq: [
      { q: 'Qu\u2019est-ce que le Bud Bud Contest ?', a: 'Compétition de surf annuelle à Longeville-sur-Mer — chaque année en août. Un événement local qui attire riders et families. Les vagues du spot sont adaptées aux niveaux intermédiaire et avancé.' },
      { q: 'La plage des Conches est-elle adaptée aux débutants ?', a: 'La plage des Conches offre des conditions plus douces au nord. Évitez la zone principale en marée haute si vous êtes débutant — le courant peut être puissant.' },
      { q: 'Quelle board pour Bud Bud ?', a: 'Une performante 6\u20194\u2019 à 7\u20196\u2019 est recommandée. Le spot capte la puissance — besoin de drive et maniabilité. Évitez les longues boards molles par journée creuse.' },
      { q: 'Comment se rendre à Longeville-sur-Mer ?', a: 'Depuis la Roche-sur-Yon (40 min) ou depuis Les Sables-d\u2019Olonne (20 min). Parking plage en été — arrivez tôt mi-juillet/août.' },
    ],
    metaTitle: 'Louer une planche de surf à Longeville-sur-Mer 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Longeville-sur-Mer été 2026 entre particuliers. Bud Bud Contest, plage des Conches — intermédiaires et avancés. Protection dommages Vendée.',
  },

  'saint-gilles-croix-de-vie': {
    displayName: 'Saint-Gilles-Croix-de-Vie',
    emoji: '🛟',
    region: 'Vendée',
    tagline: "Le port qui surfe en Vendée — spot familial, Grande Plage accessible à tous niveaux",
    heroHeadline: 'Loue une planche à Saint-Gilles-Croix-de-Vie cet été',
    heroSubtext: 'Grande Plage, Semvie Nautisme — niveau débutant → intermédiaire, boards mousse et évolutives',
    bestSeason: 'Juin à Septembre (vagues douces, ambiance portuaire, famille friendly)',
    typicalWaves: '0.4m à 1m. Beach breaks doux et accessible. Fond sableux, sécurité maximale.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Ouest / Nord-Ouest',
    bestTide: 'Marée basse à mi-marée (spots les plus sûrs en marée haute)',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Semvie Nautisme', type: 'École', desc: 'École historique du port — cours tous niveaux, proche de la Grande Plage' },
      { name: 'Saint-Gilles Surf School', type: 'École', desc: 'Cours collectifs et particuliers sur la Grande Plage — dès 6 ans' },
      { name: 'Atlantic Rider', type: 'École', desc: 'Coaching intermédiaire et stages semaine' },
    ],
    shops: [
      { name: 'Semvie Nautisme Shop', type: 'Shop', desc: 'Shop partenaire — location, vente boards, combinaisons' },
      { name: 'Glisse Côte Vendéenne', type: 'Shop', desc: 'Boards, accessoires, près de la plage' },
    ],
    faq: [
      { q: 'Saint-Gilles est-il adapté aux débutants ?', a: 'Absolument. La Grande Plage est l\u2019un des spots Vendée les plus accessibles. Fond sableux, vagues douces, rescue présents en saison. Idéals pour les familles.' },
      { q: 'Quelle board choisir à Saint-Gilles ?', a: 'Pour débuter : une board mousse 8-9ft ou longboard. Pour progresser : une fish ou funboard 7-8ft. Swell filtre par niveau — trouve la board adaptée.' },
      { q: 'Où se gare-t-on à Saint-Gilles ?', a: 'Parking plage au bout de la promenade (payant été). Parking centre pour le port — 10 min à pied de la Grande Plage.' },
      { q: "C'est différent des Sables-d\u2019Olonne ?", a: "Même ambiance Vendée familiale mais plus petit et plus authentique. Moins de monde en juillet. Les vagues sont similaires — douces et régulières." },
      { q: 'Faut-il une combinaison en été ?', a: 'Shorty ou 3/2mm recommandé même en août. L\u2019eau monte à 19-21°C mais le vent peut rafraîchir.' },
    ],
    metaTitle: 'Louer une planche de surf à Saint-Gilles-Croix-de-Vie 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Saint-Gilles-Croix-de-Vie été 2026 entre particuliers. Grande Plage, Semvie Nautisme — débutants et intermédiaires. Protection dommages Vendée.',
  },

  'noirmoutier': {
    displayName: 'Noirmoutier',
    emoji: '🏝️',
    region: 'Vendée',
    tagline: "L\u2019île en surf — spots variés entre plage et reef, ambiance unique",
    heroHeadline: 'Loue une planche à Noirmoutier cet été',
    heroSubtext: "Plage, reef, niveau intermédiaire — boards performantes recommandées pour l'île",
    bestSeason: 'Juin à Septembre (meilleure affluence, accès îlefacile)',
    typicalWaves: '0.6m à 1.5m. Mix beach breaks et reef. La Luire et le reef attirent les riders de niveau intermédiaire.',
    waterTemp: '18°C (été) — 11°C (hiver)',
    bestWind: 'Offshore Nord / Nord-Est',
    bestTide: 'Marée basse à mi-marée (reef exposé à marée basse)',
    surfSchools: [
      { name: 'Noirmoutier Surf School', type: 'École', desc: 'École sur la plage principale — cours tous niveaux, proximity spots' },
      { name: 'Île Surf Club', type: 'École', desc: 'Club local — coaching intermédiaire, sessions matinales' },
    ],
    shops: [
      { name: 'Glisse Island', type: 'Shop', desc: 'Le seul shop de l\u2019île — boards, combinaisons, réparation' },
      { name: 'Surf Location Noirmoutier', type: 'Shop', desc: 'Location quotidienne, près de la plage' },
    ],
    faq: [
      { q: 'Comment accéder à Noirmoutier ?', a: 'Par le pont (depuis Fromentine) ou par le passage du Gois (accessible à marée basse uniquement — vérifiez les horaires!). En été, le pont peut être saturé le matin.' },
      { q: 'Le surf à Noirmoutier est-il différent des autres spots Vendée ?', a: "L'île offre un mix unique : beach breaks accessibles et reef plus techniques. La Luire et le reef attirent des riders intermédiaires+. L'ambiance est plus calme que Les Sables-d\u2019Olonne." },
      { q: 'Quelle board pour Noirmoutier ?', a: 'Pour les beach breaks : une fish ou funboard 7\u20198\u2019. Pour le reef : une shortboard performante 6\u20196\u2019 à 6\u20198\u2019. Le reef capte la puissance — besoin de maniabilité.' },
      { q: 'Faut-il une combinaison ?', a: 'Oui, même en été : 3/2mm ou shorty. L\u2019eau reste fraîche même en août (18-20°C).' },
      { q: 'Où loger sur l\u2019île ?', a: 'Noirmoutier-en-l\u2019Île est le centre. Locations saisonnières très demandées en été — réservez tôt. Campings aussi disponibles.' },
    ],
    metaTitle: 'Louer une planche de surf à Noirmoutier 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Noirmoutier été 2026 entre particuliers. Spots plage et reef pour intermédiaires. Board livrée sur l\u2019île, protection dommages incluse.',
  },

  bidart: {
    displayName: 'Bidart',
    emoji: '🏄',
    region: 'Pays Basque',
    tagline: 'Le village surf du Pays Basque — plages sauvages entre Biarritz et Guéthary',
    heroHeadline: 'Loue une planche de surf à Bidart cet été',
    heroSubtext: 'Bidart Centre, Pavillon Royal — beach breaks accessibles, niveau intermédiaire',
    bestSeason: 'Juin à Octobre (régulier), Mars à Mai (sessions quality moins crowded)',
    typicalWaves: '0.8m à 2m. Beach breaks réguliers, moins crowded que Biarritz.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée à marée haute',
    surfSchools: [
      { name: 'Bidart Surf Club', type: 'École', desc: 'Le club local — cours tous niveaux, encadrement qualifié' },
      { name: 'Surf Attitude Bidart', type: 'École', desc: 'Cours sur Pavillon Royal — petits groupes, progression rapide' },
    ],
    shops: [
      { name: 'Nobile Surf Shop', type: 'Shop', desc: 'Shop local — boards, combinaisons, accessoires' },
      { name: 'Soöruz Bidart', type: 'Shop', desc: 'Marque locale Pays Basque, boards et combinaisons' },
    ],
    faq: [
      { q: 'Où loger à Bidart ?', a: 'Le village est à 5 min à pied des plages. Camping Ur Onea et Résidences Mer en pension complète.' },
      { q: 'C\'est moins bondé que Biarritz ?', a: 'Oui, Bidart attire moins de touristes. Les plages restent plus calmes même en plein été.' },
      { q: 'Combien coûte la location d\'une planche à Bidart ?', a: 'Avec Swell, comptez 8 à 15€/h selon la board. Shortboards, fish, longboards — loués par des surfeurs locaux.' },
      { q: 'Comment fonctionne la caution Swell Shield ?', a: 'Le Swell Shield est une garantie dommages optionnelle — quelques euros/session qui couvrent les chocs accidentels. Sans it, la caution standard s\'applique.' },
      { q: 'Quelles sont les meilleures conditions à Bidart ?', a: 'Vent offshore Est, houle NO/ONO 1-2m, mi-marée montante. Pavillon Royal tient mieux le gros swell que Bidart Centre.' },
    ],
    metaTitle: 'Louer une planche de surf à Bidart 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Bidart été 2026 entre particuliers. Bidart Centre, Pavillon Royal — beach breaks Pays Basque. À partir de 8€/h, protection dommages incluse.',
  },

  hendaye: {
    displayName: 'Hendaye',
    emoji: '🏖️',
    region: 'Pays Basque',
    tagline: 'La grande plage de la frontière — vagues douces, idéal débutants et familles',
    heroHeadline: 'Loue une planche de surf à Hendaye cet été',
    heroSubtext: 'Les Deux Jumeaux — 3km de beach break doux, parfait pour débuter',
    bestSeason: 'Juin à Septembre (vagues douces, ambiance familiale)',
    typicalWaves: '0.4m à 1.2m. Grande plage exposée Nord, vagues longues et molles.',
    waterTemp: '14°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Nord-Est',
    bestTide: 'Toutes marées — plus régulier à marée montante',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Hendaye Surf School', type: 'École', desc: 'École historique sur la grande plage — cours dès 6 ans' },
      { name: 'Surf & Sea Hendaye', type: 'École', desc: 'Stages semaine et cours collectifs tous niveaux' },
    ],
    shops: [
      { name: 'Hendaye Surf Shop', type: 'Shop', desc: 'Location et vente de matériel, à deux pas de la plage' },
    ],
    faq: [
      { q: 'Pourquoi choisir Hendaye pour débuter ?', a: 'Hendaye est le spot le plus doux du Pays Basque. Vagues longues, fond sableux, peu de courant — idéal pour progresser en sécurité.' },
      { q: 'Où loger à Hendaye ?', a: 'La ville est directement sur la plage. Camping Ametza ou appartements en bord de mer pour toutes les bourses.' },
      { q: 'Combien coûte la location d\'une planche à Hendaye ?', a: 'Avec Swell, comptez 6 à 12€/h. Mousse et longboards disponibles — parfaits pour débuter.' },
      { q: 'Comment fonctionne la caution Swell Shield ?', a: 'Garantie dommages optionnelle incluse dans la location. Quelques euros de plus pour surfer sans stress.' },
      { q: 'Quelles sont les meilleures conditions à Hendaye ?', a: 'Toute la journée par houle NO modérée (0.5-1.2m), vent offshore, marée montante. Conditions très régulières en été.' },
    ],
    metaTitle: 'Louer une planche de surf à Hendaye 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Hendaye été 2026 entre particuliers. Les Deux Jumeaux — spot débutant Pays Basque. Grande plage, vagues douces. À partir de 6€/h.',
  },

  guethary: {
    displayName: 'Guéthary',
    emoji: '🔥',
    region: 'Pays Basque',
    tagline: 'Le village mythique — reef d\'Avalanche et Parlementia pour les confirmés',
    heroHeadline: 'Loue une planche de surf à Guéthary cet été',
    heroSubtext: 'Avalanche, Parlementia — reef puissant, niveau avancé, boards performantes indispensables',
    bestSeason: 'Octobre à Mars (gros swells Atlantique), Juin à Août (sessions plus sereines)',
    typicalWaves: '1m à 4m+. Reef breaks longs et puissants. Avalanche capte les plus grosses houles NO.',
    waterTemp: '13°C (hiver) — 20°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Marée haute à mi-marée descendante (reef couvert)',
    surfSchools: [
      { name: 'Guéthary Surf Club', type: 'École', desc: 'Club local — coaching avancé et préparation reef' },
    ],
    shops: [
      { name: 'Local Motion Guéthary', type: 'Shop', desc: 'Shapes locaux, réparation, boards pour reef' },
      { name: 'Euroglass Pays Basque', type: 'Shop', desc: 'Réparation et stratification — spécialiste reef boards' },
    ],
    faq: [
      { q: 'Faut-il être expert pour surfer Avalanche ?', a: 'Oui. Avalanche est réservé aux surfeurs confirmés — reef rocher, vagues creuses et puissantes. Interdit aux débutants et intermédiaires.' },
      { q: 'Quelle board pour Guéthary ?', a: 'Une shortboard performante 6\'0 à 6\'6, narrow template, conçue pour les reef breaks. Les shapes locaux conseillent les meilleures options.' },
      { q: 'Où loger à Guéthary ?', a: 'Guéthary est un village de 1000 habitants — réservez tôt. Villa de surfeurs ou location saisonnière sur AirBnb. Saint-Jean-de-Luz est à 5 min.' },
      { q: 'Combien coûte la location d\'une planche à Guéthary ?', a: 'Les boards de reef performantes coûtent 12 à 20€/h sur Swell. Investissement justifié pour les sessions d\'exception.' },
      { q: 'Quelles sont les meilleures conditions à Guéthary ?', a: 'Houle NO/ONO 1.5-4m, vent offshore Est, marée haute. Parlementia se forme mieux en mi-marée, Avalanche à marée haute.' },
    ],
    metaTitle: 'Louer une planche de surf à Guéthary 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Guéthary été 2026 entre particuliers. Avalanche, Parlementia — reef avancé Pays Basque. Boards performantes, protection dommages incluse.',
  },

  'saint-jean-de-luz': {
    displayName: 'Saint-Jean-de-Luz',
    emoji: '⚓',
    region: 'Pays Basque',
    tagline: 'La ville basque qui surfe — spots accessibles et paysage exceptionnel',
    heroHeadline: 'Loue une planche à Saint-Jean-de-Luz cet été',
    heroSubtext: 'La Sauvage, Lafitenia (5 min) — beach break accessible + point break légendaire à proximité',
    bestSeason: 'Mai à Octobre (meilleur combo vagues + météo)',
    typicalWaves: '0.6m à 2m. Beach break La Sauvage + point break Lafitenia à 5 min.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Mi-marée à marée haute',
    surfSchools: [
      { name: 'Côte Basque Surf School', type: 'École', desc: 'Cours sur La Sauvage — tous niveaux, du débutant au confirmé' },
      { name: 'Uhaina Surf School', type: 'École', desc: 'École de référence — accès Lafitenia et spots proches' },
    ],
    shops: [
      { name: 'Lafitenia Surf Shop', type: 'Shop', desc: 'Le shop local — boards, combinaisons, réparation' },
      { name: 'Xtrem Surf Shop', type: 'Shop', desc: 'Vente et location — centre Saint-Jean-de-Luz' },
    ],
    faq: [
      { q: 'Quelle est la différence entre La Sauvage et Lafitenia ?', a: 'La Sauvage est un beach break accessible niveau intermédiaire. Lafitenia (5 min) est un point break pour confirmés — droites interminables sur reef.' },
      { q: 'Où loger à Saint-Jean-de-Luz ?', a: 'Le centre historique est magnifique. Hôtels de charme, gîtes basques ou location saisonnière — réservez tôt en juillet/août.' },
      { q: 'Combien coûte la location d\'une planche à Saint-Jean-de-Luz ?', a: 'Avec Swell, 8 à 15€/h selon la board. Beach break ou reef — les locaux ont la board qu\'il faut.' },
      { q: 'Comment fonctionne la caution Swell Shield ?', a: 'Garantie dommages optionnelle — quelques euros/session pour couvrir les chocs accidentels. Tous les boards Swell peuvent en bénéficier.' },
      { q: 'Quelles sont les meilleures conditions à La Sauvage ?', a: 'Houle NO 0.8-2m, vent offshore Sud, mi-marée. La Sauvage est exposée — même petite houle donne de bonnes vagues.' },
    ],
    metaTitle: 'Louer une planche de surf à Saint-Jean-de-Luz 2026 | Swell — Particuliers à particuliers',
    metaDesc: 'Location planche surf Saint-Jean-de-Luz été 2026 entre particuliers. La Sauvage, Lafitenia nearby — Pays Basque authentique. À partir de 8€/h, protection dommages.',
  },

  'la-graviere': {
    displayName: 'La Gravière',
    emoji: '🌊',
    region: 'Landes',
    tagline: 'Le pipeline européen — le tube le plus intense des Landes',
    heroHeadline: 'Loue une planche de surf à La Gravière',
    heroSubtext: 'Hossegor — tube redouté, niveau avancé uniquement, boards guns et shortboards performantes',
    bestSeason: 'Septembre à Novembre (swells de compétition), Avril à Juin (sessions qualité)',
    typicalWaves: '1.5m à 4m+. Beach break le plus puissant d\'Europe. Tubes creux sur banc de sable.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est (vent de terre)',
    bestTide: 'Mi-marée montante à marée haute (banc optimal)',
    surfSchools: [
      { name: 'Quiksilver Surf School Hossegor', type: 'École', desc: 'Coaching avancé et surf trips — La Gravière encadrée par des pros' },
    ],
    shops: [
      { name: 'Boardriders Hossegor', type: 'Shop', desc: 'Shop Quiksilver/Roxy — boards, réparation, conseils locaux' },
      { name: 'Natural Surf Shop', type: 'Shop', desc: 'Boards neuves et occasion, shapers locaux Hossegor' },
    ],
    faq: [
      { q: 'La Gravière est-elle accessible aux intermédiaires ?', a: 'Non. La Gravière est réservée aux surfeurs avancés. Les vagues sont creuses, puissantes et tub.ent — risque élevé pour les non-confirmés.' },
      { q: 'Quelle board pour La Gravière ?', a: 'Une shortboard performante 5\'10 à 6\'2, conçue pour les beach breaks puissants. Rocker prononcé, rails fins. Les shapers locaux Hossegor ont exactement ce qu\'il faut.' },
      { q: 'Combien coûte la location d\'une planche à La Gravière ?', a: 'Avec Swell, 10 à 18€/h pour une shortboard performante. Investissement justifié pour les sessions légendaires.' },
      { q: 'Comment fonctionne la caution Swell Shield ?', a: 'Le Swell Shield couvre les dommages accidentels — indispensable pour les sessions à La Gravière où les chocs sont fréquents.' },
      { q: 'Quelles sont les meilleures conditions à La Gravière ?', a: 'Houle NO/ONO 1.5-3m, vent Est (offshore), mi-marée montante. Les bancs changent chaque hiver — vérifiez les rapports locaux.' },
    ],
    metaTitle: 'Louer une planche de surf à La Gravière, Hossegor 2026 | Swell',
    metaDesc: 'Location planche surf La Gravière Hossegor 2026. Le tube européen — niveau avancé. Boards performantes 10-18€/h, Swell Shield inclus.',
  },

  'les-estagnots': {
    displayName: 'Les Estagnots',
    emoji: '🏄',
    region: 'Landes',
    tagline: 'Le sweet spot Seignosse — bancs réguliers, niveau intermédiaire idéal',
    heroHeadline: 'Loue une planche de surf aux Estagnots',
    heroSubtext: 'Seignosse — beach break régulier, parfait pour progresser',
    bestSeason: 'Juin à Octobre (bancs stables, vagues consistantes)',
    typicalWaves: '0.8m à 2.5m. Beach breaks réguliers, capte le moindre swell.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Toutes marées selon les bancs',
    surfSchools: [
      { name: 'Surf Seignosse School', type: 'École', desc: 'Cours sur Les Estagnots — tous niveaux, encadrement qualifié' },
    ],
    shops: [
      { name: 'Session Glisse', type: 'Shop', desc: 'Location et vente de matériel — shapers locaux Seignosse' },
    ],
    faq: [
      { q: 'Les Estagnots vs La Gravière — quelle différence ?', a: 'Les Estagnots est plus régulier et accessible que La Gravière. Parfait pour les intermédiaires qui veulent progresser sans les risques d\'Hossegor.' },
      { q: 'Quelle board pour Les Estagnots ?', a: 'Une fish ou shortboard évolutive 6\'4 à 7\'0. Le spot est polyvalent — les intermédiaires y trouvent leur compte.' },
      { q: 'Combien coûte la location à Les Estagnots ?', a: 'Avec Swell, 8 à 14€/h selon la board. Location à l\'heure, sans engagement.' },
      { q: 'Comment fonctionne la caution Swell Shield ?', a: 'Garantie dommages optionnelle — quelques euros/session. Toujours recommandé sur les spots actifs.' },
      { q: 'Quelles sont les meilleures conditions aux Estagnots ?', a: 'Houle NO 1-2m, vent offshore Est, marée montante. Le spot capte bien — même petite houle donne des vagues surfables.' },
    ],
    metaTitle: 'Louer une planche de surf aux Estagnots, Seignosse 2026 | Swell',
    metaDesc: 'Location planche surf Les Estagnots Seignosse 2026. Beach break régulier, niveau intermédiaire. Boards 8-14€/h, protection dommages Swell Shield.',
  },

  'le-penon': {
    displayName: 'Le Penon',
    emoji: '🌊',
    region: 'Landes',
    tagline: 'L\'école de surf des Landes — vagues douces, idéal débutants',
    heroHeadline: 'Loue une planche de surf au Penon',
    heroSubtext: 'Seignosse — beach break accessible, parfait pour apprendre',
    bestSeason: 'Avril à Septembre (vagues régulières, parfaites pour débuter)',
    typicalWaves: '0.5m à 1.5m. Beach break doux et régulier. Fond sableux sécurisé.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Marée montante — vagues les plus longues',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Surf Seignosse School', type: 'École', desc: 'École réputée au Penon — cours débutants et progression' },
      { name: 'Ocean Adventure', type: 'École', desc: 'Stages semaine, cours collectifs tous niveaux' },
    ],
    shops: [
      { name: 'Session Glisse', type: 'Shop', desc: 'Boards, combinaisons, wax — proche du Penon' },
    ],
    faq: [
      { q: 'Le Penon est-il adapté aux débutants ?', a: 'Oui — c\'est l\'un des spots les plus accessibles des Landes. Vagues douces, fond sableux, pas de courants forts. Idéal pour la première session.' },
      { q: 'Quelle board pour débuter au Penon ?', a: 'Une mousse ou longboard 8-9ft. Avec Swell, filtre par niveau « Débutant » et trouve la board parfaite.' },
      { q: 'Combien coûte la location d\'une planche au Penon ?', a: 'Boards débutant : 6 à 10€/h sur Swell. Pas de minimum journée — paie uniquement ce que tu surfes.' },
      { q: 'Comment fonctionne la caution Swell Shield ?', a: 'Garantie dommages optionnelle à quelques euros/session — idéale pour les débutants qui démarrent sur une board loaned.' },
      { q: 'Quelles sont les meilleures conditions au Penon ?', a: 'Houle NO modérée (0.5-1.2m), vent offshore, marée montante. Conditions très régulières de mai à septembre.' },
    ],
    metaTitle: 'Louer une planche de surf au Penon, Seignosse 2026 | Swell',
    metaDesc: 'Location planche surf Le Penon Seignosse 2026. Spot école — débutants et familles. Boards mousse et longboard 6-10€/h, protection dommages incluse.',
  },

  'les-bourdaines': {
    displayName: 'Les Bourdaines',
    emoji: '🌊',
    region: 'Landes',
    tagline: 'Beach break Seignosse — fonctionne à toutes les marées',
    heroHeadline: 'Loue une planche de surf aux Bourdaines',
    heroSubtext: 'Seignosse — beach break polyvalent, niveau intermédiaire',
    bestSeason: 'Avril à Octobre (régulier, toutes marées)',
    typicalWaves: '0.8m à 2m. Beach break polyvalent, bien formé.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Toutes marées',
    surfSchools: [
      { name: 'Surf Seignosse School', type: 'École', desc: 'Cours collectifs aux Bourdaines et Les Estagnots' },
    ],
    shops: [
      { name: 'Session Glisse', type: 'Shop', desc: 'Location boards et matériel à Seignosse-Océan' },
    ],
    faq: [
      { q: 'Les Bourdaines vs Estagnots — quelle différence ?', a: 'Bourdaines est légèrement plus au nord. Fonctionne mieux à marée basse quand Les Estagnots est trop creusé. Même qualité de sable.' },
      { q: 'C\'est adapté aux débutants ?', a: 'Niveau intermédiaire recommandé. Peut devenir puissant par bonne houle. Les débutants préfèrent Le Penon.' },
    ],
    metaTitle: 'Louer une planche de surf aux Bourdaines, Seignosse 2026 | Swell',
    metaDesc: 'Location planche surf Les Bourdaines Seignosse 2026. Beach break polyvalent, fonctionne à toutes les marées. Boards 8-14€/h, protection dommages.',
  },

  'la-piste-capbreton': {
    displayName: 'La Piste Capbreton',
    emoji: '⛵',
    region: 'Landes',
    tagline: 'Beach break protégé — capte tout quand ailleurs c\'est trop gros',
    heroHeadline: 'Loue une planche de surf à La Piste, Capbreton',
    heroSubtext: 'Capbreton — spot protégé par la digue, accessible tous niveaux',
    bestSeason: 'Toute l\'année — protégé quand c\'est gros',
    typicalWaves: '0.5m à 1.5m. Beach break doux, excellent par petits swells.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Nord-Est',
    bestTide: 'Mi-marée à marée haute',
    surfSchools: [
      { name: 'Capbreton Surf Club', type: 'École', desc: 'Le club local — cours dès 6 ans, tous niveaux' },
      { name: 'Ride & Slide', type: 'École', desc: 'Cours débutants et perfectionnement sur La Piste' },
    ],
    shops: [
      { name: 'Gliss\'Corner', type: 'Shop', desc: 'Vente et réparation boards près du port' },
    ],
    faq: [
      { q: 'La Piste est-elle vraiment protégée ?', a: 'Oui — la digue de Capbreton casse une partie des houles. Excellent spot quand Hossegor est insuflable (3m+).' },
      { q: 'Quelle board sur La Piste ?', a: 'Longboard ou fish par petite houle. Shortboard performante dès que ça monte à 1.5m+.' },
    ],
    metaTitle: 'Louer une planche de surf à La Piste Capbreton 2026 | Swell',
    metaDesc: 'Location planche surf La Piste Capbreton 2026. Spot protégé par la digue, accessible tous niveaux. Boards 8-14€/h, protection dommages incluse.',
  },

  'le-santocha': {
    displayName: 'Le Santocha',
    emoji: '⛵',
    region: 'Landes',
    tagline: 'Le spot le plus safe de Capbreton — idéal familles',
    heroHeadline: 'Loue une planche de surf au Santocha, Capbreton',
    heroSubtext: 'Capbreton — vagues douces, eau calme, parfait pour débuter',
    bestSeason: 'Toute l\'année — parfaitement protégé',
    typicalWaves: '0.3m à 1m. Vagues douces et régulières. Eau souvent calme côté port.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Toutes conditions — très abrité',
    bestTide: 'Toutes marées',
    surfSchools: [
      { name: 'Capbreton Surf Club', type: 'École', desc: 'École la plus proche — cours enfants et familles' },
    ],
    shops: [
      { name: 'Gliss\'Corner', type: 'Shop', desc: 'Shop à 5 min à pied du Santocha' },
    ],
    faq: [
      { q: 'Le Santocha est-il adapté aux enfants ?', a: 'Parfait pour les enfants. C\'est le spot le plus safe de Capbreton — eau peu profonde, vagues douces, fond sableux.' },
      { q: 'Quelle différence avec La Piste ?', a: 'Le Santocha est encore plus protégé, côté port. Idéal pour initiation. La Piste est légèrement plus exposée.' },
    ],
    metaTitle: 'Louer une planche de surf au Santocha Capbreton 2026 | Swell',
    metaDesc: 'Location planche surf Santocha Capbreton 2026. Le spot le plus sécurisé de la côte Landes. Familles et débutants. Boards 6-10€/h, protection dommages.',
  },

  'grande-plage-biarritz': {
    displayName: 'Grande Plage Biarritz',
    emoji: '🏖️',
    region: 'Pays Basque',
    tagline: 'La plage centrale de Biarritz — vagues accessibles, ambiance permanente',
    heroHeadline: 'Loue une planche à la Grande Plage de Biarritz',
    heroSubtext: 'Biarritz — beach break accessible, plage centrale, niveau intermédiaire',
    bestSeason: 'Juin à Septembre (meilleure météo), Octobre (swell automne)',
    typicalWaves: '0.5m à 1.5m. Beach break central, régulier.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Mi-marée',
    surfSchools: [
      { name: 'Biarritz Surf School', type: 'École', desc: 'École en front de Grande Plage — cours collectifs et privés' },
      { name: 'Hastea Surf School', type: 'École', desc: 'École historique Biarritz — encadrement pro, tous niveaux' },
    ],
    shops: [
      { name: 'Radical Surf Shop', type: 'Shop', desc: 'Boards, combinaisons, wax — face à la Grande Plage' },
    ],
    faq: [
      { q: 'Grande Plage vs Côte des Basques — laquelle choisir ?', a: 'Grande Plage capte plus de swell mais est plus crowdée. Côte des Basques est plus longue et doucement penchée — meilleure pour débuter.' },
      { q: 'Y a-t-il beaucoup de monde ?', a: 'L\'été, oui — surtout le week-end. Arriver à l\'aube ou en semaine pour des sessions plus calmes.' },
    ],
    metaTitle: 'Louer une planche de surf à la Grande Plage Biarritz 2026 | Swell',
    metaDesc: 'Location planche surf Grande Plage Biarritz 2026. Plage centrale, vagues accessibles. Boards 8-15€/h entre particuliers, protection dommages Swell Shield.',
  },

  'milady-biarritz': {
    displayName: 'Milady Biarritz',
    emoji: '🏖️',
    region: 'Pays Basque',
    tagline: 'La plage calme au sud de Biarritz — familles et longboard',
    heroHeadline: 'Loue une planche de surf à Milady, Biarritz',
    heroSubtext: 'Biarritz Sud — plage tranquille, vagues douces, idéal débutants',
    bestSeason: 'Juin à Août (familial, météo stable)',
    typicalWaves: '0.4m à 1.2m. Vagues douces, fond sableux progressif.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Marée basse à mi-marée',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Hastea Surf School', type: 'École', desc: 'Cours à Milady et Côte des Basques — environnement familial' },
    ],
    shops: [
      { name: 'Euroglass Biarritz', type: 'Shop', desc: 'Réparation et shape boards — Biarritz Sud' },
    ],
    faq: [
      { q: 'Milady est-elle adaptée aux enfants ?', a: 'Oui, parfaitement. Milady est une des plages les plus safe de Biarritz. Fond sableux progressif, peu de courants.' },
      { q: 'Quelle board pour Milady ?', a: 'Longboard (9ft+) ou mousse. Les vagues douces de Milady sont idéales pour apprendre la rame et le take-off.' },
    ],
    metaTitle: 'Louer une planche de surf à Milady Biarritz 2026 | Swell',
    metaDesc: 'Location planche surf Milady Biarritz 2026. Plage tranquille au sud de Biarritz, vagues douces. Familles et débutants. Boards 8-14€/h, protection dommages.',
  },

  'les-cavaliers': {
    displayName: 'Les Cavaliers',
    emoji: '🌅',
    region: 'Pays Basque',
    tagline: 'Le spot principal d\'Anglet — beach break exposé, vagues puissantes',
    heroHeadline: 'Loue une planche de surf aux Cavaliers, Anglet',
    heroSubtext: 'Anglet — beach break puissant, moins de crowd qu\'Hossegor',
    bestSeason: 'Juin à Octobre (meilleur ratio crowd/vagues)',
    typicalWaves: '0.8m à 2.5m. Beach break exposé, puissant par bonne houle.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée montante à marée haute',
    surfSchools: [
      { name: 'Anglet Surf Club', type: 'École', desc: 'Le club local aux Cavaliers — tous niveaux, encadrement qualifié' },
      { name: 'Pacific Surf School', type: 'École', desc: 'Cours intermédiaires et avancés sur le front de mer' },
    ],
    shops: [
      { name: 'Boardriders Anglet', type: 'Shop', desc: 'Shop partenaire — boards, combinaisons, réparation' },
    ],
    faq: [
      { q: 'Les Cavaliers vs Hossegor — laquelle préférer ?', a: 'Les Cavaliers est moins crowdée avec un niveau similaire. Parfait si tu veux de la qualité sans la foule du WQS.' },
      { q: 'Faut-il un niveau minimum ?', a: 'Niveau intermédiaire recommandé. Par gros swell, confirmés uniquement. La plage centrale Anglet est plus douce.' },
    ],
    metaTitle: 'Louer une planche de surf aux Cavaliers Anglet 2026 | Swell',
    metaDesc: 'Location planche surf Les Cavaliers Anglet 2026. Beach break puissant, moins de crowd qu\'Hossegor. Boards 8-14€/h, protection dommages Swell Shield.',
  },

  'la-barre-anglet': {
    displayName: 'La Barre',
    emoji: '🌅',
    region: 'Pays Basque',
    tagline: 'Embouchure de l\'Adour — vagues très puissantes pour experts',
    heroHeadline: 'Loue une planche de surf à La Barre, Anglet',
    heroSubtext: 'Anglet — embouchure de l\'Adour, beach break extrême',
    bestSeason: 'Automne-Hiver (gros swells NO), Printemps (sessions clean)',
    typicalWaves: '1m à 3m+. Vagues très puissantes et creuses. Courants forts par mauvais temps.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Nord-Est',
    bestTide: 'Mi-marée (éviter marée basse — bancs à découvert)',
    surfSchools: [
      { name: 'Anglet Surf Club', type: 'École', desc: 'Coaching experts sur La Barre — encadrement spécialisé' },
    ],
    shops: [
      { name: 'Boardriders Anglet', type: 'Shop', desc: 'Boards performantes, combinaisons hiver disponibles' },
    ],
    faq: [
      { q: 'La Barre est-elle dangereuse ?', a: 'Par gros swell et vive-eau, les courants sont très forts. Réservée aux surfeurs expérimentés connaissant bien l\'embouchure de l\'Adour.' },
      { q: 'Quelle board pour La Barre ?', a: 'Shortboard performante 5\'10\'-6\'4\'. Le spot est creux et puissant — pas de place pour les boards trop volumineuses.' },
    ],
    metaTitle: 'Louer une planche de surf à La Barre Anglet 2026 | Swell',
    metaDesc: 'Location planche surf La Barre Anglet 2026. Embouchure Adour — beach break extrême pour confirmés. Boards performantes 8-14€/h, protection dommages.',
  },

  'la-sauvage': {
    displayName: 'La Sauvage',
    emoji: '🔥',
    region: 'Pays Basque',
    tagline: 'Le beach break secret de Saint-Jean-de-Luz — qualité sans la foule de Lafitenia',
    heroHeadline: 'Loue une planche de surf à La Sauvage, Saint-Jean-de-Luz',
    heroSubtext: 'Saint-Jean-de-Luz — beach break de qualité, intermédiaire+',
    bestSeason: 'Septembre à Novembre, Avril à Juin (bons swells offshore)',
    typicalWaves: '0.8m à 2m. Beach break de qualité, moins connu mais souvent nickel.',
    waterTemp: '13°C (hiver) — 20°C (été)',
    bestWind: 'Offshore Nord-Est',
    bestTide: 'Mi-marée montante',
    surfSchools: [
      { name: 'Uhaina Surf School', type: 'École', desc: 'École de surf sur les spots SJL — coaching intermédiaire' },
    ],
    shops: [
      { name: 'Lafitenia Surf Shop', type: 'Shop', desc: 'Shop local Saint-Jean-de-Luz, boards et accessoires' },
    ],
    faq: [
      { q: 'La Sauvage vs Lafitenia — laquelle choisir ?', a: 'La Sauvage est un beach break (gauches et droites) vs point break à Lafitenia (droites uniquement). Plus accessible, moins de foule.' },
      { q: 'Niveau requis pour La Sauvage ?', a: 'Intermédiaire et plus. Le spot peut devenir puissant par bonne houle. Pas recommandé pour les débutants.' },
    ],
    metaTitle: 'Louer une planche de surf à La Sauvage Saint-Jean-de-Luz 2026 | Swell',
    metaDesc: 'Location planche surf La Sauvage Saint-Jean-de-Luz 2026. Beach break secret, qualité Lafitenia sans la foule. Boards 8-14€/h, protection dommages.',
  },

  parlementia: {
    displayName: 'Parlementia',
    emoji: '🔥',
    region: 'Pays Basque',
    tagline: 'Le reef le plus puissant du Pays Basque — experts uniquement',
    heroHeadline: 'Loue une planche de surf à Parlementia, Guéthary',
    heroSubtext: 'Guéthary — reef break de classe mondiale, confirmés uniquement',
    bestSeason: 'Octobre à Mars (gros swells NO), Mai-Juin (sessions clean)',
    typicalWaves: '1.5m à 5m+. Reef break sur roche, vagues longues et puissantes. Se réveille par gros swell.',
    waterTemp: '13°C (hiver) — 20°C (été)',
    bestWind: 'Offshore Sud-Est (crucial sur reef)',
    bestTide: 'Marée haute à mi-marée descendante',
    surfSchools: [
      { name: 'Uhaina Surf School Guéthary', type: 'École', desc: 'Coaching avancé reef breaks — ne pas tenter sans guide local' },
    ],
    shops: [
      { name: 'Euroglass Biarritz', type: 'Shop', desc: 'Réparation boards post-reef — Biarritz à 10 min' },
    ],
    faq: [
      { q: 'Parlementia est-il dangereux ?', a: 'Oui pour les non-initiés. Reef en roche, vagues de grande taille, courants forts. Réservé aux surfeurs expérimentés connaissant le spot.' },
      { q: 'Quelle board pour Parlementia ?', a: 'Gun (7\'0\' à 8\'6\') ou shortboard à gros volume par taille modérée. Le reef demande une board avec du drive et de la stabilité.' },
    ],
    metaTitle: 'Louer une planche de surf à Parlementia Guéthary 2026 | Swell',
    metaDesc: 'Location planche surf Parlementia Guéthary 2026. Reef break de classe mondiale, experts uniquement. Boards performantes 10-18€/h, protection dommages Swell Shield.',
  },

  'bidart-centre': {
    displayName: 'Bidart Centre',
    emoji: '🏄',
    region: 'Pays Basque',
    tagline: 'Le beach break de Bidart — accessible et bien formé',
    heroHeadline: 'Loue une planche de surf à Bidart Centre',
    heroSubtext: 'Bidart — beach break polyvalent, accessible, niveau intermédiaire',
    bestSeason: 'Mai à Octobre (régulier, bon ratio monde/qualité)',
    typicalWaves: '0.5m à 1.8m. Beach break polyvalent, accessible à tous les niveaux.',
    waterTemp: '13°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Toutes marées',
    surfSchools: [
      { name: 'Bidart Surf School', type: 'École', desc: 'École sur la plage centrale — cours tous niveaux' },
    ],
    shops: [
      { name: 'Radical Surf Shop', type: 'Shop', desc: 'Boards et combinaisons à 5 min de Bidart' },
    ],
    faq: [
      { q: 'Bidart vs Biarritz — laquelle préférer ?', a: 'Bidart est moins crowdée que Biarritz avec une qualité similaire. Les plages de Bidart sont plus intimes et souvent meilleures qualité.' },
      { q: 'Y a-t-il des parkings ?', a: 'Oui, parkings gratuits et payants à Bidart-Plage. Arriver tôt en saison pour éviter la fosse à voitures.' },
    ],
    metaTitle: 'Louer une planche de surf à Bidart Centre 2026 | Swell',
    metaDesc: 'Location planche surf Bidart Centre 2026. Beach break accessible, polyvalent. Moins crowdé que Biarritz. Boards 8-14€/h, protection dommages incluse.',
  },

  'deux-jumeaux-hendaye': {
    displayName: 'Les Deux Jumeaux',
    emoji: '🏖️',
    region: 'Pays Basque',
    tagline: 'La plage la plus protégée du Pays Basque — idéal familles et débutants',
    heroHeadline: 'Loue une planche de surf aux Deux Jumeaux, Hendaye',
    heroSubtext: 'Hendaye — beach break face aux rochers jumeaux, niveau débutant',
    bestSeason: 'Juin à Août (conditions parfaites débutants)',
    typicalWaves: '0.3m à 1m. Vagues douces et régulières. La plage la plus sécurisée du Pays Basque.',
    waterTemp: '13°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Nord / Est',
    bestTide: 'Marée montante (meilleures vagues, moins de courant)',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Hendaye Surf School', type: 'École', desc: 'Cours débutants face aux Deux Jumeaux — cadre exceptionnel' },
      { name: 'Surf Club Hendaye', type: 'École', desc: 'Le club historique d\'Hendaye — cours enfants et adultes' },
    ],
    shops: [
      { name: 'Txingudi Surf Shop', type: 'Shop', desc: 'Le shop de la plage d\'Hendaye — location et vente' },
    ],
    faq: [
      { q: 'Les Deux Jumeaux est-il adapté aux débutants ?', a: 'C\'est le meilleur spot débutant du Pays Basque. La plage est grande, les vagues sont douces et régulières, fond sableux.' },
      { q: 'Pourquoi ce nom "Deux Jumeaux" ?', a: 'Deux rochers emblématiques (Los Dos Hermanos) se dressent face à la plage et créent un cadre unique. Ils offrent aussi une protection naturelle contre les grosses houles.' },
    ],
    metaTitle: 'Louer une planche de surf aux Deux Jumeaux Hendaye 2026 | Swell',
    metaDesc: 'Location planche surf Deux Jumeaux Hendaye 2026. La plage la plus protégée du Pays Basque. Débutants et familles. Boards 6-10€/h, protection dommages.',
  },

  'avalanche-guethary': {
    displayName: 'Avalanche Guéthary',
    emoji: '🔥',
    region: 'Pays Basque',
    tagline: 'Reef break XXL de Guéthary — quand la houle arrive vraiment',
    heroHeadline: 'Loue une planche de surf à Avalanche, Guéthary',
    heroSubtext: 'Guéthary — reef break extrême, experts confirmés uniquement',
    bestSeason: 'Novembre à Février (swells géants), conditions très rares',
    typicalWaves: '2m à 6m+. Reef break impressionnant. Ne se réveille que par très gros swell.',
    waterTemp: '13°C (hiver) — 20°C (été)',
    bestWind: 'Offshore parfait Sud-Est (crucial)',
    bestTide: 'Marée haute uniquement (dangereux bas)',
    surfSchools: [
      { name: 'Uhaina Surf School Guéthary', type: 'École', desc: 'Guide local obligatoire — reef technique et dangereux' },
    ],
    shops: [
      { name: 'Euroglass Biarritz', type: 'Shop', desc: 'Réparation boards spécialisée reef breaks' },
    ],
    faq: [
      { q: 'Avalanche vs Parlementia — lequel est plus gros ?', a: 'Avalanche est encore plus exposé et plus gros que Parlementia par gros swell. C\'est un des spots les plus extrêmes du Pays Basque.' },
      { q: 'Comment accéder à Avalanche ?', a: 'Vue depuis les falaises de Guéthary. Accès à l\'eau complexe — ne jamais y aller seul ou sans connaissance du spot par swell.' },
    ],
    metaTitle: 'Louer une planche de surf à Avalanche Guéthary 2026 | Swell',
    metaDesc: 'Location planche surf Avalanche Guéthary 2026. Reef break XXL, experts uniquement. Boards gun et performantes 12-20€/h, protection dommages Swell Shield.',
  },

  'la-nord': {
    displayName: 'La Nord',
    emoji: '🌊',
    region: 'Landes',
    heroHeadline: 'Loue une planche de surf à La Nord, Hossegor',
    heroSubtext: 'Hossegor — beach break nord, moins crowdé que La Gravière',
    tagline: 'Le beach break nord de Hossegor — qualité et moins de monde',
    bestSeason: 'Septembre à Novembre (swells automne), Avril à Juin',
    typicalWaves: '0.8m à 2.5m. Beach break de qualité, moins fréquenté que La Gravière.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée montante à marée haute',
    surfSchools: [
      { name: 'Quiksilver Surf School Hossegor', type: 'École', desc: 'Coaching avancé — Hossegor et spots proches' },
    ],
    shops: [
      { name: 'Boardriders Hossegor', type: 'Shop', desc: 'Shop Quiksilver/Roxy — boards performantes, conseils locaux' },
    ],
    faq: [
      { q: 'La Nord vs La Gravière — laquelle choisir ?', a: 'La Nord est moins crowdée que La Gravière avec une qualité comparable. Parfait quand La Gravière est saturée ou trop grosse.' },
      { q: 'Quel niveau pour La Nord ?', a: 'Intermédiaire à avancé. Le spot peut devenir puissant par gros swell. Shortboard performante recommandée.' },
    ],
    metaTitle: 'Louer une planche de surf à La Nord Hossegor 2026 | Swell',
    metaDesc: 'Location planche surf La Nord Hossegor 2026. Beach break Hossegor, moins crowdé. Boards 10-18€/h, protection dommages Swell Shield.',
  },

  'les-culs-nus': {
    displayName: 'Les Culs Nus',
    emoji: '🌊',
    region: 'Landes',
    heroHeadline: 'Loue une planche de surf aux Culs Nus, Hossegor',
    heroSubtext: 'Hossegor — beach break local, ambiance authentique',
    tagline: 'Le spot local d\'Hossegor — beach break puissant, moins connu',
    bestSeason: 'Septembre à Novembre (swells), Avril à Juillet',
    typicalWaves: '1m à 3m. Beach break puissant — voisin de La Gravière.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est',
    bestTide: 'Mi-marée montante',
    surfSchools: [
      { name: 'Tao Surf School', type: 'École', desc: 'Cours collectifs et privés, tous niveaux Hossegor' },
    ],
    shops: [
      { name: 'Natural Surf Shop', type: 'Shop', desc: 'Boards neuves et occasion, shapers locaux' },
    ],
    faq: [
      { q: 'Les Culs Nus est-il pour les confirmés ?', a: 'Oui — niveau intermédiaire+ recommandé. Le spot est puissant et creux par bonne houle.' },
      { q: 'Quelle board pour Les Culs Nus ?', a: 'Shortboard performante 5\'10 à 6\'2. Le spot se rapproche de La Gravière en termes d\'intensité.' },
    ],
    metaTitle: 'Louer une planche de surf aux Culs Nus Hossegor 2026 | Swell',
    metaDesc: 'Location planche surf Les Culs Nus Hossegor 2026. Beach break puissant et local. Boards performantes 10-16€/h, protection dommages.',
  },

  'plage-centrale-hossegor': {
    displayName: 'Plage Centrale Hossegor',
    emoji: '🌊',
    region: 'Landes',
    heroHeadline: 'Loue une planche de surf à la Plage Centrale, Hossegor',
    heroSubtext: 'Hossegor — beach break central, accessible niveau intermédiaire',
    tagline: 'Le beach break central d\'Hossegor — polyvalent et accessible',
    bestSeason: 'Juin à Octobre (régulier, accessible)',
    typicalWaves: '0.8m à 2m. Beach break central, bon pour progresser.',
    waterTemp: '15°C (hiver) — 22°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée',
    surfSchools: [
      { name: 'Jo Moraiz Surf School', type: 'École', desc: 'Coaching avancé et surf trips guidés — Hossegor' },
    ],
    shops: [
      { name: 'Boardriders Hossegor', type: 'Shop', desc: 'Le shop de référence — boards, réparation, conseils' },
    ],
    faq: [
      { q: 'La Plage Centrale vs La Gravière — laquelle pour débuter ?', a: 'La Plage Centrale est plus accessible que La Gravière. Idéale pour les intermédiaires souhaitant rider les vagues d\'Hossegor sans l\'intensité de La Gravière.' },
      { q: 'Quelle board à la Plage Centrale ?', a: 'Un fish ou mid-length 7ft pour les intermédiaires. Shortboard performante quand ça grossit.' },
    ],
    metaTitle: 'Louer une planche de surf à la Plage Centrale Hossegor 2026 | Swell',
    metaDesc: 'Location planche surf Plage Centrale Hossegor 2026. Beach break accessible, idéal intermédiaires. Boards 8-14€/h, protection dommages.',
  },

  'pavillon-royal': {
    displayName: 'Pavillon Royal',
    emoji: '🏄',
    region: 'Pays Basque',
    heroHeadline: 'Loue une planche de surf au Pavillon Royal, Bidart',
    heroSubtext: 'Bidart — beach break qualité, intermédiaire → avancé',
    tagline: 'Le beach break premium de Bidart — moins crowdé, vagues régulières',
    bestSeason: 'Juin à Octobre (régulier), Septembre-Octobre (houles automne)',
    typicalWaves: '0.8m à 2.5m. Beach break de qualité, capte bien les swells.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Est / Sud-Est',
    bestTide: 'Mi-marée montante à marée haute',
    surfSchools: [
      { name: 'Surf Attitude Bidart', type: 'École', desc: 'Cours sur Pavillon Royal — petits groupes, progression rapide' },
    ],
    shops: [
      { name: 'Nobile Surf Shop', type: 'Shop', desc: 'Shop local Bidart — boards, combinaisons, accessoires' },
    ],
    faq: [
      { q: 'Pavillon Royal vs Bidart Centre — laquelle choisir ?', a: 'Pavillon Royal capte mieux les grosses houles et offre des vagues plus longues. Bidart Centre est plus accessible par petite houle.' },
      { q: 'Faut-il un niveau minimum ?', a: 'Intermédiaire recommandé. Par bonne houle, shortboard performante et maîtrise du take-off en vagues creuses nécessaires.' },
    ],
    metaTitle: 'Louer une planche de surf au Pavillon Royal Bidart 2026 | Swell',
    metaDesc: 'Location planche surf Pavillon Royal Bidart 2026. Beach break qualité, moins crowdé. Boards 8-14€/h entre particuliers, protection dommages Swell Shield.',
  },

  'miramar-biarritz': {
    displayName: 'Miramar Biarritz',
    emoji: '🏖️',
    region: 'Pays Basque',
    heroHeadline: 'Loue une planche de surf à Miramar, Biarritz',
    heroSubtext: 'Biarritz Nord — beach break entre Grande Plage et Anglet',
    tagline: 'La plage nord de Biarritz — beach break accessible, peu de monde',
    bestSeason: 'Juin à Septembre (meilleur combo vagues + météo)',
    typicalWaves: '0.5m à 1.5m. Beach break accessible, régulier.',
    waterTemp: '14°C (hiver) — 21°C (été)',
    bestWind: 'Offshore Sud / Sud-Est',
    bestTide: 'Mi-marée',
    surfSchools: [
      { name: 'Biarritz Surf School', type: 'École', desc: 'École Biarritz — cours tous niveaux, Miramar et Grande Plage' },
    ],
    shops: [
      { name: 'Radical Surf Shop', type: 'Shop', desc: 'Boards, combinaisons — face à la Grande Plage, proche Miramar' },
    ],
    faq: [
      { q: 'Miramar vs Grande Plage — laquelle préférer ?', a: 'Miramar est moins fréquentée que la Grande Plage tout en offrant des conditions similaires. Idéale pour éviter la foule en été.' },
      { q: 'Quel niveau pour Miramar ?', a: 'Tous niveaux, idéal intermédiaires. Par petite houle, parfait pour progresser en shortboard ou fish.' },
    ],
    metaTitle: 'Louer une planche de surf à Miramar Biarritz 2026 | Swell',
    metaDesc: 'Location planche surf Miramar Biarritz 2026. Plage nord de Biarritz, peu fréquentée. Boards 8-14€/h entre particuliers, protection dommages.',
  },

  'grande-plage-sables-d-olonne': {
    displayName: 'Grande Plage des Sables',
    emoji: '🏖️',
    region: 'Vendée',
    heroHeadline: 'Loue une planche de surf aux Sables-d\'Olonne',
    heroSubtext: 'Grande Plage, Sables-d\'Olonne — débutants et familles Vendée',
    tagline: 'La plage principale des Sables-d\'Olonne — surf familial et accessible',
    bestSeason: 'Juin à Septembre (vagues douces, météo stable)',
    typicalWaves: '0.5m à 1.2m. Beach break central des Sables, fond sableux.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Ouest / Nord-Ouest',
    bestTide: 'Marée basse à mi-marée',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Olonna Surf Club', type: 'École', desc: 'Le club historique des Sables — cours dès 6 ans, Grande Plage' },
    ],
    shops: [
      { name: 'Aquatonic Surf Shop', type: 'Shop', desc: 'Boards, combinaisons, accessoires — proche de la plage' },
    ],
    faq: [
      { q: 'La Grande Plage est-elle adaptée aux débutants ?', a: 'Oui, c\'est l\'un des spots les plus accessibles de Vendée. Fond sableux, vagues douces, rescue en saison.' },
      { q: 'Quelle board pour débuter aux Sables ?', a: 'Une mousse ou longboard 8-9ft. Avec Swell, filtre par niveau « Débutant ».' },
    ],
    metaTitle: 'Louer une planche de surf à la Grande Plage des Sables-d\'Olonne 2026 | Swell',
    metaDesc: 'Location planche surf Grande Plage Sables-d\'Olonne 2026. Plage principale, débutants et familles. Boards 6-10€/h, protection dommages.',
  },

  'surfzone-sables-d-olonne': {
    displayName: 'Surfzone Les Sables',
    emoji: '🏄',
    region: 'Vendée',
    heroHeadline: 'Loue une planche au spot Surfzone des Sables-d\'Olonne',
    heroSubtext: 'Sables-d\'Olonne — beach break plus technique, intermédiaires',
    tagline: 'Le spot technique des Sables — plus de puissance que la Grande Plage',
    bestSeason: 'Juin à Septembre, Automne (swells plus costauds)',
    typicalWaves: '0.5m à 1.5m. Plus de puissance que la Grande Plage par bonne houle.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Ouest / Nord-Ouest',
    bestTide: 'Mi-marée descendante',
    surfSchools: [
      { name: 'Ocean Ride Surf School', type: 'École', desc: 'Cours intermédiaires et avancés sur la Surfzone' },
    ],
    shops: [
      { name: 'Surfzone Les Sables', type: 'Shop', desc: 'Le shop de la zone — location quotidienne, vente matériel' },
    ],
    faq: [
      { q: 'Surfzone vs Grande Plage — laquelle pour moi ?', a: 'La Surfzone offre plus de puissance quand ça monte. La Grande Plage est plus safe pour les débutants. Intermédiaires peuvent alterner.' },
    ],
    metaTitle: 'Louer une planche de surf à la Surfzone Sables-d\'Olonne 2026 | Swell',
    metaDesc: 'Location planche surf Surfzone Les Sables-d\'Olonne 2026. Beach break technique pour intermédiaires. Boards 8-12€/h, protection dommages Vendée.',
  },

  'la-tranche-centre': {
    displayName: 'La Tranche Centre',
    emoji: '🌊',
    region: 'Vendée',
    heroHeadline: 'Loue une planche de surf à La Tranche-sur-Mer',
    heroSubtext: 'La Tranche Centre — beach break doux, parfait pour débuter',
    tagline: 'La plage centrale de La Tranche — vagues accessibles, Vendée familiale',
    bestSeason: 'Juin à Septembre (vagues douces, familles)',
    typicalWaves: '0.4m à 1m. Beach break très doux, fond sableux progressif.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Nord / Nord-Est',
    bestTide: 'Marée basse à mi-marée',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Koa Surf School La Tranche', type: 'École', desc: 'École de référence — cours tous niveaux, équipement fourni' },
    ],
    shops: [
      { name: 'Lobstore', type: 'Shop', desc: 'Le shop iconique de La Tranche — boards, combinaisons, réparation' },
    ],
    faq: [
      { q: 'La Tranche Centre est-elle pour les débutants ?', a: 'Absolument. La plage centrale de La Tranche est douce et sécurisée. Fond progressif, peu de courants, idéal pour la première session.' },
    ],
    metaTitle: 'Louer une planche de surf à La Tranche-sur-Mer Centre 2026 | Swell',
    metaDesc: 'Location planche surf La Tranche Centre 2026. Beach break très doux, parfait débutants et familles. Boards 5-10€/h, protection dommages Vendée.',
  },

  'la-terriere-tranche': {
    displayName: 'Plage de La Terrière',
    emoji: '🌊',
    region: 'Vendée',
    heroHeadline: 'Loue une planche de surf à La Terrière, La Tranche',
    heroSubtext: 'La Tranche-sur-Mer — spot École de référence, niveau débutant',
    tagline: 'La Terrière — le meilleur spot école de La Tranche-sur-Mer',
    bestSeason: 'Juin à Septembre (conditions idéales débutants)',
    typicalWaves: '0.4m à 1m. Beach break très accessible. Recommandé par Koa Surf School.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Nord / Nord-Est',
    bestTide: 'Marée basse à mi-marée',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Koa Surf School La Tranche', type: 'École', desc: 'École sur la Terrière — LA référence pour débuter à La Tranche' },
      { name: 'La Tranche Surf Academy', type: 'École', desc: 'Stages été pour enfants et adultes — encadrés' },
    ],
    shops: [
      { name: 'Koa Surf Shop', type: 'Shop', desc: 'Location quotidienne, vente boards, proche de la Terrière' },
    ],
    faq: [
      { q: 'Pourquoi La Terrière est recommandée pour débuter ?', a: 'La Terrière est le spot le plus plat et accessible de La Tranche. Vagues longues et molles, fond progressif — idéal pour le premier stand-up.' },
    ],
    metaTitle: 'Louer une planche de surf à La Terrière La Tranche-sur-Mer 2026 | Swell',
    metaDesc: 'Location planche surf La Terrière La Tranche 2026. Spot école Vendée, débutants et enfants. Boards mousse 5-10€/h, protection dommages.',
  },

  'koa-surf-school-tranche': {
    displayName: 'Zone Koa Surf School',
    emoji: '🏄',
    region: 'Vendée',
    heroHeadline: 'Loue une planche de surf à la zone Koa, La Tranche',
    heroSubtext: 'La Tranche-sur-Mer — zone Koa Surf School, niveau intermédiaire',
    tagline: 'La zone d\'entraînement de Koa Surf School — vagues pour progresser',
    bestSeason: 'Juin à Septembre (formations régulières)',
    typicalWaves: '0.5m à 1.2m. Beach break polyvalent pour progression.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Nord / Nord-Est',
    bestTide: 'Mi-marée',
    surfSchools: [
      { name: 'Koa Surf School La Tranche', type: 'École', desc: 'Coaching intermédiaire — stages semaine, suivi de progression' },
    ],
    shops: [
      { name: 'Koa Surf Shop', type: 'Shop', desc: 'Boards, location, accessoires' },
    ],
    faq: [
      { q: 'Quel niveau pour la zone Koa ?', a: 'Débutant à intermédiaire. La zone Koa est organisée pour une progression rapide — de la mousse au shortboard.' },
    ],
    metaTitle: 'Louer une planche de surf à la zone Koa Surf School La Tranche 2026 | Swell',
    metaDesc: 'Location planche surf zone Koa La Tranche-sur-Mer 2026. École de référence Vendée. Boards 6-12€/h, protection dommages.',
  },

  'lobstore-tranche': {
    displayName: 'Zone Lobstore',
    emoji: '🏄',
    region: 'Vendée',
    heroHeadline: 'Loue une planche de surf à la zone Lobstore, La Tranche',
    heroSubtext: 'La Tranche-sur-Mer — beach break nord, niveau intermédiaire',
    tagline: 'La zone nord de La Tranche — less crowd, waves consistantes',
    bestSeason: 'Juin à Septembre (sessions matinales)',
    typicalWaves: '0.5m à 1.5m. Beach break légèrement plus puissant que le centre.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Nord / Nord-Est',
    bestTide: 'Mi-marée',
    surfSchools: [
      { name: 'Lobstore Surf Club', type: 'École', desc: 'Club au nord de la plage — coaching intermédiaire, sessions matinales' },
    ],
    shops: [
      { name: 'Lobstore', type: 'Shop', desc: 'Le shop iconique de La Tranche — boards, combinaisons, réparation' },
    ],
    faq: [
      { q: 'Zone Lobstore vs centre de La Tranche ?', a: 'La zone Lobstore est légèrement plus exposée et offre des vagues plus consistantes. Parfait pour les intermédiaires qui veulent progresser.' },
    ],
    metaTitle: 'Louer une planche de surf zone Lobstore La Tranche-sur-Mer 2026 | Swell',
    metaDesc: 'Location planche surf zone Lobstore La Tranche 2026. Beach break intermédiaire, club local. Boards 6-12€/h, protection dommages Vendée.',
  },

  'olonna-surf-club-sables': {
    displayName: 'Zone Olonna Surf Club',
    emoji: '🏄',
    region: 'Vendée',
    heroHeadline: 'Loue une planche au spot Olonna Surf Club, Sables-d\'Olonne',
    heroSubtext: 'Sables-d\'Olonne — zone du club historique, tous niveaux',
    tagline: 'La zone du club historique des Sables — surf en communauté locale',
    bestSeason: 'Juin à Septembre (ambiance club, familles)',
    typicalWaves: '0.4m à 1.2m. Beach break accessible, communauté active.',
    waterTemp: '18°C (été) — 12°C (hiver)',
    bestWind: 'Offshore Ouest / Nord-Ouest',
    bestTide: 'Marée basse à mi-marée',
    beginnerFriendly: true,
    surfSchools: [
      { name: 'Olonna Surf Club', type: 'École', desc: 'Le club historique des Sables — cours collectifs, tous niveaux, ambiance familiale' },
    ],
    shops: [
      { name: 'Aquatonic Surf Shop', type: 'Shop', desc: 'Boards, combinaisons, accessoires — proche du club' },
    ],
    faq: [
      { q: 'Qu\'est-ce que le Olonna Surf Club ?', a: 'Le Olonna Surf Club est le club historique des Sables-d\'Olonne. Ambiance familiale, tous niveaux, coaches diplômés. Ideal pour débuter en communauté.' },
    ],
    metaTitle: 'Louer une planche de surf zone Olonna Surf Club Sables-d\'Olonne 2026 | Swell',
    metaDesc: 'Location planche surf zone Olonna Surf Club Sables 2026. Club historique Vendée, tous niveaux. Boards 6-10€/h, protection dommages.',
  },
};

// ─── HTML escape helper ─────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Module-level constants (accessible in all render functions) ─────────────
const TYPES = { shortboard: 'Shortboard', longboard: 'Longboard', midlength: 'Mid-Length', fish: 'Fish', funboard: 'Funboard', foam: 'Mousse', gun: 'Gun' };
const LEVELS = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Avancé', all: 'Tous niveaux' };
const WAVE = { beach: 'Beach Break', reef: 'Reef Break', point: 'Point Break' };

// Maps spot region to the French administrative region (for containedInPlace schema)
const REGION_TO_ADMIN = {
  Landes: 'Nouvelle-Aquitaine',
  'Pays Basque': 'Nouvelle-Aquitaine',
  Vendée: 'Pays de la Loire',
};

// ─── Render a board card ────────────────────────────────────────────────────
// Shows a verified host badge (green check) when:
//   - Stripe Connect charges_enabled = true
//   - identity_status = 'verified' (KYC completed)
//   - ≥3 photos on listing
function renderBoardCard(board, meta) {
  const photos = Array.isArray(board.photos) ? board.photos : [];
  const photo = sanitizePhotoUrl(photos[0] || OG_IMAGE);
  const hourlyRate = board.hourly_rate_cents
    ? (board.hourly_rate_cents / 100).toFixed(0)
    : board.daily_price_cents
      ? Math.round(board.daily_price_cents / 800).toString()
      : '?';
  const rating = parseFloat(board.avg_rating || 0);
  const reviewCount = parseInt(board.review_count || 0, 10);
  const spotName = board.spot_name || (meta && meta.displayName) || '';

  // Verified host: stripe + KYC + ≥3 photos
  const isVerified = board.is_verified_host === true;
  const verifiedBadge = isVerified
    ? `<span class="verified-badge" title="Stripe vérifié + identité confirmée + ≥3 photos">` +
        `<svg viewBox="0 0 24 24" fill="none" style="width:12px;height:12px;display:inline-block;vertical-align:middle;">` +
          `<path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
        `</svg>` +
        `Hôte Vérifié` +
      `</span>`
    : '';

  const imgAlt = spotName
    ? `Planche surf en location à ${spotName} sur Swell — ${board.title}`
    : `Planche surf en location sur Swell — ${board.title}`;
  return `<a href="/board/${board.id}" class="board-card">
    <img src="${esc(photo)}" alt="${imgAlt}" class="board-card-img" loading="lazy">
    <div class="board-card-body">
      <span class="board-card-type">${esc(TYPES[board.board_type] || board.board_type)}</span>
      <h3 class="board-card-title">${esc(board.title)}</h3>
      <div class="board-card-meta">
        ${board.length_ft ? `<span>📏 ${board.length_ft}ft</span>` : ''}
        ${board.skill_level ? `<span>🎯 ${esc(LEVELS[board.skill_level] || board.skill_level)}</span>` : ''}
        ${spotName ? `<span>📍 ${esc(spotName)}</span>` : ''}
      </div>
      <div class="board-card-bottom">
        <span class="board-card-price">${hourlyRate}€<small>/h</small></span>
        <span style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;justify-content:flex-end;">
          ${verifiedBadge}
          ${rating > 0 ? `<span class="board-card-rating">★ ${rating.toFixed(1)} <small>(${reviewCount})</small></span>` : ''}
        </span>
      </div>
    </div>
  </a>`;
}

// ─── Render boards grouped by skill level ──────────────────────────────────
function renderBoardsByLevel(boards, meta) {
  const byLevel = { beginner: [], intermediate: [], advanced: [], all: [] };
  for (const b of boards) {
    const key = b.skill_level || 'all';
    if (byLevel[key]) byLevel[key].push(b);
    else byLevel.all.push(b);
  }

  const sections = [];
  for (const [level, label] of [
    ['beginner', '🦀 Débutant'],
    ['intermediate', '🏄 Intermédiaire'],
    ['advanced', '🔥 Avancé'],
    ['all', '♻️ Tous niveaux'],
  ]) {
    const group = byLevel[level];
    if (!group || group.length === 0) continue;
    sections.push(`<div class="boards-level-group">
      <h3 class="boards-level-label">${label}</h3>
      <div class="boards-grid">${group.map(b => renderBoardCard(b, meta)).join('')}</div>
    </div>`);
  }
  return sections.join('');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hourlyPriceFromBoard(board) {
  if (board.hourly_rate_cents) return (board.hourly_rate_cents / 100).toFixed(2);
  if (board.daily_price_cents) return (board.daily_price_cents / 800).toFixed(2);
  return null;
}

function makeOffer(b) {
  const price = hourlyPriceFromBoard(b);
  return {
    '@type': 'Offer',
    name: b.title,
    priceCurrency: 'EUR',
    price: price,
    unitCode: 'HUR',
    priceSpecification: price ? {
      '@type': 'UnitPriceSpecification',
      price: price,
      priceCurrency: 'EUR',
      unitCode: 'HUR',
      description: 'per hour',
    } : undefined,
    availability: 'https://schema.org/InStock',
    url: `${BASE_URL}/board/${b.id}`,
  };
}

// ─── FAQ template: 5 standardised questions per task spec ───────────────────
// Generated at render time from spot data — ensures every page has the key
// commercial-intent Q&As that Google Rich Results needs.
function buildTemplateFaq(meta, boards) {
  const name = meta.displayName;
  // Price range from live boards (floor/ceiling), fallback to generic range
  let minPrice = null, maxPrice = null;
  for (const b of boards) {
    const p = b.hourly_rate_cents ? b.hourly_rate_cents / 100 : (b.daily_price_cents ? b.daily_price_cents / 800 : null);
    if (p) { minPrice = minPrice === null ? p : Math.min(minPrice, p); maxPrice = maxPrice === null ? p : Math.max(maxPrice, p); }
  }
  const priceRange = minPrice !== null
    ? `${Math.round(minPrice)} à ${Math.round(maxPrice)}€/h`
    : '6 à 15€/h';

  // Board type recommendation based on spot level
  const primaryLevel = meta.beginnerFriendly ? 'beginner' : (meta.typicalWaves && meta.typicalWaves.includes('1m') ? 'intermediate' : 'all');
  const boardReco = primaryLevel === 'beginner'
    ? `Une mousse ou longboard 8-9ft est idéale. Volume maximum pour débutants — la stabilité prime sur la performance.`
    : primaryLevel === 'intermediate'
      ? `Un mid-length (7-8ft) ou shortboard 6'2-6'8 selon ton niveau. ${name} fonctionne bien pour progresser avec un bon volume.`
      : `Une shortboard performante (6'0-6'6) ou fish adaptés à ${meta.typicalWaves ? meta.typicalWaves.split('.')[0] : 'les vagues locales'}.`;

  return [
    {
      q: `Combien coûte la location d'une planche à ${name} ?`,
      a: `Avec Swell, la location à ${name} coûte ${priceRange} selon le type de board. C'est payé à l'heure — tu paies uniquement ce que tu surfes, sans minimum journée. La protection dommages Swell Shield est disponible en option.`,
    },
    {
      q: `Quel type de planche pour surfer à ${name} ?`,
      a: boardReco,
    },
    {
      q: `Comment fonctionne la caution Swell Shield à ${name} ?`,
      a: `Swell Shield est notre garantie dommages optionnelle. Pour quelques euros par session, tu es couvert en cas de casse accidentelle. L'hôte est également protégé — tout est réglé directement via la plateforme, sans stress.`,
    },
    {
      q: `Puis-je annuler ma réservation à ${name} ?`,
      a: `Oui. Les annulations sont gérées directement sur Swell. Annule avant le début de la session pour un remboursement. Les conditions exactes sont précisées sur chaque annonce — les hôtes fixent leur politique.`,
    },
    {
      q: `Quelles sont les meilleures conditions à ${name} ?`,
      a: `${meta.typicalWaves ? `Les vagues à ${name} sont typiquement ${meta.typicalWaves}.` : ''} La meilleure période est ${meta.bestSeason || 'de juin à octobre'}. Vent idéal : ${meta.bestWind || 'offshore'}. Marée : ${meta.bestTide || 'mi-marée'}.`,
    },
  ];
}

// ─── Main render function ───────────────────────────────────────────────────
function renderSpotPage(slug, meta, data) {
  const { spots, boards, failureZones, reviews, isRegion, availableToday = 0, verifiedOnly = false, nearbySpots = [], dbPartners = [] } = data;
  const boardCount = boards.length;
  const spotCount = spots.length;

  // Pick cheapest available board for the Offer schema
  const cheapestBoard = boards.length > 0
    ? boards.reduce((cheapest, b) => {
        const price = b.hourly_rate_cents || (b.daily_price_cents ? Math.round(b.daily_price_cents / 8) : Infinity);
        const cheapestPrice = cheapest.hourly_rate_cents || (cheapest.daily_price_cents ? Math.round(cheapest.daily_price_cents / 8) : Infinity);
        return price < cheapestPrice ? b : cheapest;
      })
    : null;

  const adminRegion = REGION_TO_ADMIN[meta.region] || meta.region;

  // TouristAttraction + FAQPage JSON-LD schemas (task: Google Rich Results)
  const activitySchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': ['TouristAttraction', 'SportsActivityLocation'],
    name: `Spot de surf ${meta.displayName} — Location planches Swell`,
    description: meta.metaDesc,
    url: `${BASE_URL}/spot/${slug}`,
    image: OG_IMAGE,
    sport: {
      '@type': 'Sport',
      name: 'Surf',
      url: 'https://en.wikipedia.org/wiki/Surfing',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: parseFloat(spots[0]?.latitude || 0),
      longitude: parseFloat(spots[0]?.longitude || 0),
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: meta.displayName,
      addressRegion: meta.region,
      addressCountry: 'FR',
    },
    containedInPlace: {
      '@type': 'AdministrativeArea',
      name: adminRegion,
      containedInPlace: {
        '@type': 'Country',
        name: 'France',
      },
    },
    ...(cheapestBoard ? {
      makesOffer: makeOffer(cheapestBoard),
    } : {}),
  });

  // BreadcrumbList — Swell › Spots › [Spot Name]
  const breadcrumbSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Swell', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Spots', item: `${BASE_URL}/app.html` },
      { '@type': 'ListItem', position: 3, name: meta.displayName, item: `${BASE_URL}/spot/${slug}` },
    ],
  });

  // FAQPage schema: template Qs (5) + custom local Qs from meta
  const templateFaq = buildTemplateFaq(meta, boards);
  const customFaq = meta.faq || [];
  // Dedup: skip custom Qs whose stem already appears in template
  const templateStems = new Set(templateFaq.map(f => f.q.toLowerCase().substring(0, 30)));
  const uniqueCustomFaq = customFaq.filter(f => !templateStems.has(f.q.toLowerCase().substring(0, 30)));
  const allFaq = [...templateFaq, ...uniqueCustomFaq];
  const faqSchema = allFaq.length > 0 ? JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: allFaq.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }) : null;

  const nonce = typeof meta.nonce !== 'undefined' ? meta.nonce : '';
  const cspMeta = nonce
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src 'none'; object-src 'none'; upgrade-insecure-requests;">`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  ${cspMeta}
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(meta.metaTitle)} | ${boardCount} board${boardCount !== 1 ? 's' : ''} dispo — Swell</title>
  <meta name="description" content="${esc(meta.metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE_URL}/spot/${slug}">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Swell">
  <meta property="og:url" content="${BASE_URL}/spot/${slug}">
  <meta property="og:title" content="${esc(meta.metaTitle)} | Swell">
  <meta property="og:description" content="${esc(meta.metaDesc)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(meta.metaTitle)} — spot de surf sur Swell">
  <meta property="og:locale" content="fr_FR">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(meta.metaTitle)} | Swell">
  <meta name="twitter:description" content="${esc(meta.metaDesc)}">
  <meta name="twitter:image" content="${OG_IMAGE}">
  <meta name="twitter:image:alt" content="${esc(meta.metaTitle)} — spot de surf sur Swell">

  <!-- JSON-LD: SportsActivityLocation + FAQPage + BreadcrumbList -->
  <script type="application/ld+json">${activitySchema}</script>
  ${faqSchema ? `<script type="application/ld+json">${faqSchema}</script>` : ''}
  <script type="application/ld+json">${breadcrumbSchema}</script>

  <!-- PWA -->
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0e1e36">
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
  <noscript><link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet"></noscript>

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --night: #0e1e36; --night-deep: #09152a; --dusk: #142540;
      --deep: #101c32; --mid: #1c3058; --surface: #1f3560;
      --white: #fff; --white-80: rgba(255,255,255,0.88);
      --white-55: rgba(255,255,255,0.62); --white-30: rgba(255,255,255,0.38);
      --coral: #ff6b35; --coral-glow: rgba(255,107,53,0.18); --coral-light: #ff8c5a;
      --ocean: #1a90d8; --ocean-deep: #0066aa; --ocean-glow: rgba(26,144,216,0.2);
      --border: rgba(255,255,255,0.08); --border-accent: rgba(0,194,224,0.15);
      --primary: #00c2e0; --green: #4ade80; --gold: #f0c870;
      --radius: 16px; --radius-sm: 10px;
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'DM Sans', 'Space Grotesk', system-ui, sans-serif;
      background: var(--night); color: var(--white);
      line-height: 1.6; -webkit-font-smoothing: antialiased;
    }

    /* ── Nav ── */
    .nav {
      position: sticky; top: 0; z-index: 200;
      padding: 1rem 5%;
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(14,30,54,0.95);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
    }
    .nav-logo {
      font-family: 'Syne', sans-serif; font-size: 1.5rem; font-weight: 800;
      color: var(--white); text-decoration: none;
    }
    .nav-logo em { font-style: normal; color: var(--coral); }
    .nav-links { display: flex; gap: 0.25rem; align-items: center; }
    .nav-link {
      color: var(--white-55); font-size: 0.9rem; text-decoration: none;
      padding: 0.5rem 0.8rem; border-radius: 8px; transition: color 0.2s;
    }
    .nav-link:hover { color: var(--white); }
    .nav-cta {
      background: var(--coral); color: white; padding: 0.55rem 1.3rem;
      border-radius: 100px; font-weight: 700; font-size: 0.85rem;
      text-decoration: none; margin-left: 0.5rem;
      box-shadow: 0 4px 16px rgba(255,107,53,0.3);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .nav-cta:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(255,107,53,0.45); }

    /* ── Breadcrumb ── */
    .breadcrumb {
      max-width: 1100px; margin: 1.5rem auto 0; padding: 0 1.5rem;
      font-size: 0.82rem; color: var(--white-30);
    }
    .breadcrumb a { color: var(--primary); text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }

    /* ── Hero ── */
    .spot-hero {
      max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem 0;
    }
    .spot-hero h1 {
      font-family: 'Syne', sans-serif; font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800; line-height: 1.15; margin-bottom: 0.5rem;
    }
    .spot-hero .tagline {
      font-size: 1.1rem; color: var(--white-55); max-width: 600px; margin-bottom: 1.25rem;
    }
    .spot-hero .hero-sub {
      font-size: 0.9rem; color: var(--primary); font-weight: 500; margin-bottom: 1.25rem;
      background: rgba(0,194,224,0.08); border: 1px solid rgba(0,194,224,0.15);
      display: inline-block; padding: 0.3rem 0.85rem; border-radius: 100px;
    }
    .spot-stats {
      display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 2rem;
    }
    .stat-pill {
      display: flex; align-items: center; gap: 0.4rem;
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: 100px; padding: 0.4rem 1rem;
      font-size: 0.85rem; color: var(--white-80);
    }
    .stat-pill strong { color: var(--white); }

    /* ── Section containers ── */
    .container { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem; }
    .section {
      margin-top: 3rem;
    }
    .section-header {
      display: flex; align-items: center; gap: 0.6rem;
      margin-bottom: 1.25rem;
    }
    .section-icon {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem; flex-shrink: 0;
    }
    .section-icon.boards { background: var(--ocean-glow); }
    .section-icon.guide { background: rgba(74,222,128,0.12); }
    .section-icon.conditions { background: rgba(240,200,112,0.12); }
    .section-icon.schools { background: rgba(255,107,53,0.12); }
    .section-icon.shops { background: rgba(0,194,224,0.12); }
    .section-icon.faq { background: rgba(139,92,246,0.12); }
    .section-icon.reviews { background: rgba(251,191,36,0.12); }
    .section-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.3rem; font-weight: 700;
    }

    /* ── Board grid ── */
    .boards-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1.25rem;
    }
    .board-card {
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden;
      text-decoration: none; color: var(--white);
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    }
    .board-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.3);
      border-color: rgba(0,194,224,0.25);
    }
    .board-card-img {
      width: 100%; height: 180px; object-fit: cover; display: block;
    }
    .board-card-body { padding: 1rem; }
    .board-card-type {
      display: inline-block; font-size: 0.65rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--primary); background: rgba(0,194,224,0.1);
      border: 1px solid rgba(0,194,224,0.2); border-radius: 100px;
      padding: 0.15rem 0.5rem; margin-bottom: 0.5rem;
    }
    .board-card-title {
      font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem;
      line-height: 1.3;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .board-card-meta {
      display: flex; gap: 0.75rem; font-size: 0.78rem; color: var(--white-55);
      margin-bottom: 0.6rem;
    }
    .board-card-bottom {
      display: flex; justify-content: space-between; align-items: center;
    }
    .board-card-price {
      font-size: 1.1rem; font-weight: 800; color: var(--white);
    }
    .board-card-price small { font-size: 0.75rem; font-weight: 500; color: var(--white-55); }
    .board-card-rating { font-size: 0.82rem; color: var(--gold); }
    .board-card-rating small { color: var(--white-30); }

    /* ── Boards by level groups ── */
    .boards-level-group { margin-bottom: 2rem; }
    .boards-level-label {
      font-family: 'Space Grotesk', sans-serif; font-size: 0.85rem; font-weight: 600;
      color: var(--white-55); margin-bottom: 0.85rem;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .boards-level-label::after {
      content: ''; flex: 1; height: 1px;
      background: var(--border); margin-left: 0.5rem;
    }
    .boards-empty {
      background: var(--dusk); border: 1px dashed var(--border);
      border-radius: var(--radius); padding: 2.5rem; text-align: center;
      color: var(--white-55);
    }
    .boards-empty strong { color: var(--white); display: block; margin-bottom: 0.5rem; font-size: 1.1rem; }

    /* ── Spot guide ── */
    .spots-list {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }
    .spot-card {
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 1.25rem;
      transition: border-color 0.2s;
    }
    .spot-card:hover { border-color: rgba(0,194,224,0.2); }
    .spot-card h3 { font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; }
    .spot-card-tags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
    .spot-tag {
      font-size: 0.72rem; font-weight: 600; padding: 0.2rem 0.6rem;
      border-radius: 100px; border: 1px solid;
    }
    .tag-wave { color: var(--ocean); border-color: rgba(26,144,216,0.3); background: rgba(26,144,216,0.08); }
    .tag-level { color: var(--green); border-color: rgba(74,222,128,0.3); background: rgba(74,222,128,0.08); }
    .tag-level.advanced { color: var(--coral); border-color: rgba(255,107,53,0.3); background: rgba(255,107,53,0.08); }
    .spot-card p { font-size: 0.85rem; color: var(--white-55); line-height: 1.5; }

    /* ── Conditions grid ── */
    .conditions-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }
    .condition-item {
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 1rem;
    }
    .condition-item .label {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--white-30); font-weight: 600; margin-bottom: 0.35rem;
    }
    .condition-item .value { font-size: 0.9rem; font-weight: 600; color: var(--white-80); }

    /* ── List items (schools, shops) ── */
    .list-items { display: flex; flex-direction: column; gap: 0.75rem; }
    .list-item {
      display: flex; align-items: flex-start; gap: 1rem;
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 1rem 1.25rem;
    }
    .list-item-icon {
      width: 38px; height: 38px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem; flex-shrink: 0;
    }
    .list-item-icon.school { background: rgba(255,107,53,0.1); }
    .list-item-icon.shop { background: rgba(0,194,224,0.1); }
    .list-item-body h4 { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.15rem; }
    .list-item-body .type-badge {
      font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--white-30); margin-bottom: 0.25rem;
    }
    .list-item-body p { font-size: 0.82rem; color: var(--white-55); }

    /* ── FAQ ── */
    .faq-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .faq-item {
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 1.25rem;
    }
    .faq-item h4 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem; color: var(--white); }
    .faq-item p { font-size: 0.88rem; color: var(--white-55); line-height: 1.6; }

    /* ── Reviews ── */
    .reviews-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .review-card {
      background: var(--dusk); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 1.25rem;
    }
    .review-header {
      display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;
    }
    .review-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: var(--surface); display: flex; align-items: center;
      justify-content: center; font-size: 0.8rem; font-weight: 700;
      color: var(--primary); flex-shrink: 0; overflow: hidden;
    }
    .review-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .review-author { font-weight: 600; font-size: 0.88rem; }
    .review-stars { color: var(--gold); font-size: 0.82rem; }
    .review-board { font-size: 0.75rem; color: var(--white-30); }
    .review-comment { font-size: 0.88rem; color: var(--white-55); line-height: 1.55; }

    /* ── Risk alert ── */
    .risk-banner {
      background: rgba(255,107,53,0.06); border: 1px solid rgba(255,107,53,0.2);
      border-radius: var(--radius-sm); padding: 1rem 1.25rem;
      margin-top: 1rem;
    }
    .risk-banner h4 {
      font-size: 0.88rem; font-weight: 700; color: var(--coral-light);
      margin-bottom: 0.35rem;
    }
    .risk-banner p { font-size: 0.82rem; color: var(--white-55); }

    /* ── CTA section ── */
    .cta-dual {
      margin-top: 3.5rem; margin-bottom: 3rem;
      display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;
    }
    .cta-card {
      border-radius: var(--radius); padding: 2rem; text-align: center;
    }
    .cta-card.host {
      background: linear-gradient(135deg, var(--coral), #ff8c42);
      color: white;
    }
    .cta-card.rider {
      background: linear-gradient(135deg, var(--ocean), #0088cc);
      color: white;
    }
    .cta-card h2 { font-size: 1.3rem; font-weight: 800; margin-bottom: 0.5rem; }
    .cta-card p { font-size: 0.9rem; opacity: 0.9; margin-bottom: 1.25rem; }
    .cta-btn {
      display: inline-block; background: white; padding: 0.75rem 2rem;
      border-radius: 100px; font-weight: 800; font-size: 0.95rem;
      text-decoration: none; transition: transform 0.2s;
    }
    .cta-card.host .cta-btn { color: var(--coral); }
    .cta-card.rider .cta-btn { color: var(--ocean-deep); }
    .cta-btn:hover { transform: translateY(-2px); }

    /* ═══ FOOTER v7 — Premium elevated ═══ */
    .site-footer {
      position: relative;
      background: linear-gradient(180deg, #060d18 0%, #040a12 100%);
      color: rgba(255,255,255,0.5);
      padding: 0; margin-top: 2rem; overflow: hidden;
    }
    .site-footer::before {
      content: ''; position: absolute;
      top: -120px; left: 50%; transform: translateX(-50%);
      width: 800px; height: 400px; border-radius: 50%;
      background: radial-gradient(ellipse, rgba(255,107,53,0.04) 0%, transparent 70%);
      pointer-events: none;
    }
    .footer-nl-band {
      position: relative;
      background: linear-gradient(135deg, rgba(255,107,53,0.06) 0%, rgba(255,107,53,0.02) 100%);
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .footer-nl-band-inner {
      max-width: 1100px; margin: 0 auto;
      padding: 3.5rem 2.5rem;
      display: flex; align-items: center; gap: 3rem;
    }
    .footer-nl-text { flex: 1; min-width: 0; }
    .footer-nl-text h3 {
      font-family: 'Syne', sans-serif; font-weight: 700;
      font-size: 1.35rem; color: rgba(255,255,255,0.92);
      margin-bottom: 0.6rem; letter-spacing: -0.02em;
    }
    .footer-nl-text h3 span { color: var(--coral, #ff6b35); }
    .footer-nl-text p {
      font-size: 0.88rem; color: rgba(255,255,255,0.35);
      font-family: 'DM Sans', sans-serif; line-height: 1.6; max-width: 380px;
    }
    .footer-newsletter-form {
      display: flex; gap: 0.65rem; flex-shrink: 0; width: 380px;
    }
    .footer-newsletter-form input[type="email"] {
      flex: 1; padding: 0.9rem 1.1rem; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; background: rgba(255,255,255,0.04);
      color: #fff; font-size: 0.88rem; outline: none;
      font-family: 'DM Sans', sans-serif;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      box-sizing: border-box; min-width: 0;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    }
    .footer-newsletter-form input[type="email"]:focus {
      border-color: rgba(255,107,53,0.5);
      box-shadow: 0 0 0 3px rgba(255,107,53,0.1), 0 0 20px rgba(255,107,53,0.06);
      background: rgba(255,255,255,0.06);
    }
    .footer-newsletter-form input[type="email"]::placeholder { color: rgba(255,255,255,0.22); }
    .footer-newsletter-form button {
      padding: 0.9rem 1.8rem; border: none; cursor: pointer;
      background: linear-gradient(135deg, #ff6b35 0%, #ff8a5c 100%);
      color: #fff; font-size: 0.82rem;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      letter-spacing: 0.04em; white-space: nowrap; border-radius: 12px;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      box-shadow: 0 2px 12px rgba(255,107,53,0.2);
    }
    .footer-newsletter-form button:hover {
      background: linear-gradient(135deg, #e8602f 0%, #ff7a48 100%);
      box-shadow: 0 6px 28px rgba(255,107,53,0.3);
      transform: translateY(-2px);
    }
    .footer-newsletter-form button:active { transform: translateY(0) scale(0.97); }
    .footer-accent-line {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,107,53,0.25) 20%, rgba(255,107,53,0.45) 50%, rgba(255,107,53,0.25) 80%, transparent);
    }
    .site-footer-inner {
      max-width: 1100px; margin: 0 auto;
      padding: 5rem 2.5rem 0; position: relative;
    }
    .footer-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr 1fr;
      gap: 4rem; padding-bottom: 4rem;
    }
    .footer-brand .footer-logo {
      font-family: 'Syne', sans-serif; font-weight: 800; font-size: 2.2rem;
      color: #fff; display: inline-block; text-decoration: none;
      letter-spacing: -0.04em; margin-bottom: 1.4rem;
      transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
    }
    .footer-brand .footer-logo:hover { opacity: 0.7; letter-spacing: 0.02em; }
    .footer-brand .footer-logo em { font-style: normal; color: var(--coral, #ff6b35); }
    .footer-brand .footer-tagline {
      font-size: 0.88rem; line-height: 1.8;
      color: rgba(255,255,255,0.28);
      font-family: 'DM Sans', sans-serif;
      margin-bottom: 2.25rem; max-width: 280px;
    }
    .footer-socials { display: flex; gap: 0.7rem; }
    .footer-social-btn {
      width: 40px; height: 40px; border-radius: 12px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      display: flex; align-items: center; justify-content: center;
      color: rgba(255,255,255,0.3); text-decoration: none;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .footer-social-btn:hover {
      background: rgba(255,107,53,0.08); border-color: rgba(255,107,53,0.2);
      color: #ff6b35; transform: translateY(-3px);
      box-shadow: 0 6px 16px rgba(255,107,53,0.1);
    }
    .footer-social-btn svg { width: 17px; height: 17px; }
    .footer-col h4 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.18em;
      color: rgba(255,255,255,0.5); margin-bottom: 1.8rem;
    }
    .footer-col ul { list-style: none; }
    .footer-col ul li { margin-bottom: 0.9rem; }
    .footer-col ul li a {
      font-size: 0.88rem; color: rgba(255,255,255,0.35); text-decoration: none;
      display: inline-block; transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
      position: relative; padding-bottom: 1px;
    }
    .footer-col ul li a::after {
      content: ''; position: absolute; bottom: 0; left: 0;
      width: 0; height: 1px; background: rgba(255,107,53,0.5);
      transition: width 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .footer-col ul li a:hover { color: rgba(255,255,255,0.9); transform: translateX(3px); }
    .footer-col ul li a:hover::after { width: 100%; }
    .footer-spot-tag { position: relative; padding-left: 1.2rem; }
    .footer-spot-tag::before {
      content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--coral, #ff6b35); opacity: 0.3;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .footer-spot-tag:hover::before {
      opacity: 1; transform: translateY(-50%) scale(1.3);
      box-shadow: 0 0 12px rgba(255,107,53,0.5);
    }
    .footer-divider {
      height: 1px; max-width: 1100px; margin: 0 auto;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05) 20%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.05) 80%, transparent);
    }
    .footer-trust-bar {
      display: flex; align-items: center; justify-content: center;
      gap: 1.25rem; padding: 2.5rem 2.5rem;
      max-width: 1100px; margin: 0 auto;
    }
    .footer-trust-pill {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.6rem 1.15rem; border-radius: 100px;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.05);
      font-size: 0.78rem; color: rgba(255,255,255,0.4);
      font-family: 'DM Sans', sans-serif; font-weight: 500;
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    }
    .footer-trust-pill:hover {
      border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.65);
      background: rgba(255,255,255,0.04); transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }
    .footer-trust-pill svg { width: 14px; height: 14px; flex-shrink: 0; transition: all 0.3s ease; }
    .footer-trust-pill .trust-icon-lock { color: rgba(72,187,120,0.6); }
    .footer-trust-pill .trust-icon-check { color: rgba(99,179,237,0.6); }
    .footer-trust-pill .trust-icon-shield { color: rgba(255,107,53,0.6); }
    .footer-trust-pill:hover .trust-icon-lock { color: rgba(72,187,120,0.9); }
    .footer-trust-pill:hover .trust-icon-check { color: rgba(99,179,237,0.9); }
    .footer-trust-pill:hover .trust-icon-shield { color: rgba(255,107,53,0.9); }
    .footer-bottom {
      padding: 2rem 2.5rem;
      display: flex; align-items: center; justify-content: space-between;
      max-width: 1100px; margin: 0 auto;
    }
    .footer-bottom-copy { font-size: 0.76rem; color: rgba(255,255,255,0.18); font-family: 'DM Sans', sans-serif; }
    .footer-bottom-links { display: flex; gap: 2rem; }
    .footer-bottom-links a {
      font-size: 0.76rem; color: rgba(255,255,255,0.18); text-decoration: none;
      font-family: 'DM Sans', sans-serif; transition: color 0.25s cubic-bezier(0.4,0,0.2,1);
    }
    .footer-bottom-links a:hover { color: rgba(255,255,255,0.5); }
    @media (max-width: 700px) {
      .footer-nl-band-inner { flex-direction: column; gap: 1.5rem; padding: 2.5rem 1.5rem; text-align: center; }
      .footer-nl-text p { max-width: 100%; }
      .footer-newsletter-form { width: 100%; max-width: 400px; margin: 0 auto; }
      .footer-grid { grid-template-columns: 1fr 1fr; gap: 2.5rem; }
      .footer-trust-bar { gap: 0.75rem; flex-wrap: wrap; justify-content: flex-start; padding: 2rem 1.5rem; }
      .site-footer-inner { padding: 3.5rem 1.5rem 0; }
      .footer-bottom { padding: 1.5rem 1.5rem; flex-direction: column; align-items: flex-start; gap: 0.7rem; }
      .footer-bottom-links { gap: 1.25rem; flex-wrap: wrap; }
    }
    @media (max-width: 480px) {
      .footer-nl-band-inner { padding: 2rem 1.25rem; }
      .footer-newsletter-form { flex-direction: column; width: 100%; }
      .footer-newsletter-form button { width: 100%; }
      .footer-grid { grid-template-columns: 1fr; gap: 2rem; }
      .site-footer-inner { padding: 2.5rem 1.25rem 0; }
      .footer-trust-bar { gap: 0.6rem; padding: 1.5rem 1.25rem; }
      .footer-trust-pill { font-size: 0.72rem; padding: 0.45rem 0.85rem; }
      .footer-bottom { padding: 1.25rem 1.25rem; }
    }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .spot-hero h1 { font-size: 1.8rem; }
      .cta-dual { grid-template-columns: 1fr; }
      .boards-grid { grid-template-columns: 1fr; }
      .conditions-grid { grid-template-columns: 1fr 1fr; }
      .nav-links { display: none; }
    }

    /* ── Promo banner ── */
    .promo-strip {
      background: linear-gradient(135deg, rgba(255,107,53,0.13) 0%, rgba(240,200,112,0.09) 100%);
      border: 1px solid rgba(255,107,53,0.22); border-radius: var(--radius-sm);
      padding: 0.8rem 1.25rem; margin: 1.5rem 0;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 0.75rem;
    }
    .promo-strip-left { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .promo-strip-text { font-size: 0.92rem; font-weight: 600; color: var(--white-80); }
    .promo-strip-text strong { color: var(--white); }
    .promo-strip-code {
      display: inline-flex; align-items: center;
      background: rgba(255,107,53,0.18); border: 1.5px dashed rgba(255,107,53,0.6);
      border-radius: 6px; padding: 0.25rem 0.65rem;
      font-family: monospace; font-weight: 800; font-size: 0.95rem;
      color: var(--coral); letter-spacing: 0.06em;
      cursor: pointer; user-select: all;
    }
    .promo-strip-sub { font-size: 0.72rem; color: var(--white-30); }
    .promo-strip-cta {
      display: inline-flex; align-items: center; gap: 0.3rem;
      background: var(--coral); color: white;
      padding: 0.4rem 1rem; border-radius: 100px;
      font-size: 0.8rem; font-weight: 700; text-decoration: none;
      white-space: nowrap; flex-shrink: 0;
    }

    /* ── Verified Host badge (board cards + spot pages) ── */
    .verified-badge {
      display: inline-flex; align-items: center; gap: 0.3rem;
      background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.3);
      border-radius: 100px; padding: 0.15rem 0.55rem;
      font-size: 0.65rem; font-weight: 700; color: #4ade80;
      white-space: nowrap;
    }

    /* ── Sticky availability counter ── */
    .stat-pill-clickable {
      cursor: pointer; text-decoration: none; transition: all 0.2s;
    }
    .stat-pill-clickable:hover {
      background: rgba(0,194,224,0.12);
      border-color: rgba(0,194,224,0.35);
    }

    /* ── Vérifié uniquement toggle ── */
    .stat-pill-verified {
      cursor: pointer; text-decoration: none; transition: all 0.2s;
      color: var(--white-55);
    }
    .stat-pill-verified:hover,
    .stat-pill-verified.active {
      background: rgba(74,222,128,0.12);
      border-color: rgba(74,222,128,0.35);
      color: #4ade80;
    }

    /* ── Nearby spots ── */
    .nearby-spots-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem;
    }
    .nearby-spot-card {
      display: flex; flex-direction: column; gap: 0.25rem;
      background: rgba(255,255,255,0.04); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 0.9rem 1rem;
      text-decoration: none; transition: border-color 0.2s, background 0.2s;
    }
    .nearby-spot-card:hover { border-color: rgba(0,194,224,0.3); background: rgba(0,194,224,0.06); text-decoration: none; }
    .nearby-spot-name { font-weight: 700; font-size: 0.95rem; color: var(--white); }
    .nearby-spot-meta { font-size: 0.78rem; color: var(--white-55); }
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
    <a href="/app.html" class="nav-cta">🏄 Louer une board</a>
  </nav>

  <div class="breadcrumb">
    <a href="/">Swell</a> › <a href="/app.html">Spots</a> › ${esc(meta.displayName)}
  </div>

  <!-- HERO -->
  <div class="spot-hero">
    <h1>${esc(meta.heroHeadline || (meta.emoji + ' ' + meta.displayName))}</h1>
    ${meta.heroHeadline ? `<p class="tagline">${esc(meta.tagline)}</p>` : ''}
    ${meta.heroSubtext ? `<p class="hero-sub">${esc(meta.heroSubtext)}</p>` : ''}
    <div class="spot-stats">
      ${availableToday > 0 ? `
        <a href="#boards" class="stat-pill stat-pill-clickable" id="avail-today-counter">
          ⚡ <strong>${availableToday}</strong> planche${availableToday !== 1 ? 's' : ''} dispo aujourd'hui
        </a>
      ` : `
        <div class="stat-pill">🏄 <strong>${boardCount}</strong> board${boardCount !== 1 ? 's' : ''} dispo</div>
      `}
      <div class="stat-pill">📍 <strong>${spotCount}</strong> spot${spotCount !== 1 ? 's' : ''}</div>
      <div class="stat-pill">🌍 ${esc(meta.region)}</div>
      ${reviews.length > 0 ? `<div class="stat-pill">⭐ <strong>${reviews.length}</strong> avis</div>` : ''}
      <!-- Vérifié uniquement toggle -->
      <a href="/spot/${slug}${verifiedOnly ? '' : '?verified=1'}"
         class="stat-pill stat-pill-verified ${verifiedOnly ? 'active' : ''}"
         id="verified-toggle">
        <svg viewBox="0 0 24 24" fill="none" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:2px;">
          <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Hôte Vérifié ${verifiedOnly ? '(✓)' : 'uniquement'}
      </a>
    </div>
  </div>

  <div class="container">

    <!-- PROMO BANNER -->
    <div class="promo-strip">
      <div class="promo-strip-left">
        <span class="promo-strip-text">🎁 Ta première session à <strong>-50%</strong></span>
        <span class="promo-strip-code" onclick="navigator.clipboard?.writeText('FIRSTSESSION50').then(()=>{this.textContent='✓ Copié!';setTimeout(()=>this.textContent='FIRSTSESSION50',1500)}).catch(()=>{})" title="Copier le code">FIRSTSESSION50</span>
        <span class="promo-strip-sub">Max. €15 · 1ère résa à l'heure</span>
      </div>
      <a href="/app.html" class="promo-strip-cta">Réserver →</a>
    </div>

    <!-- 1. BOARDS LIVE -->
    <div class="section" id="boards">
      <div class="section-header">
        <div class="section-icon boards">🏄</div>
        <h2 class="section-title">Boards disponibles à ${esc(meta.displayName)}</h2>
      </div>
      ${boardCount > 0 ? renderBoardsByLevel(boards, meta) : `
        <div class="boards-empty">
          <strong>Aucune planche dispo en ce moment — active les alertes</strong>
          Sois le premier à lister ta planche à ${esc(meta.displayName)} — c'est gratuit et ça prend 10 min.
          <br><br>
          <a href="/app.html#list" class="cta-btn" style="background:var(--coral);color:white;display:inline-block;padding:0.65rem 1.5rem;border-radius:100px;font-weight:700;text-decoration:none;">Lister ma board →</a>
        </div>
      `}
    </div>

    <!-- 2. GUIDE DU SPOT -->
    <div class="section">
      <div class="section-header">
        <div class="section-icon guide">🗺️</div>
        <h2 class="section-title">Guide${isRegion ? ' des spots' : ' du spot'}</h2>
      </div>
      <div class="spots-list">
        ${spots.map(s => `
          <div class="spot-card">
            <h3>${esc(s.name)}</h3>
            <div class="spot-card-tags">
              <span class="spot-tag tag-wave">🌊 ${esc(WAVE[s.wave_type] || s.wave_type)}</span>
              <span class="spot-tag tag-level ${s.level === 'advanced' ? 'advanced' : ''}">${esc(LEVELS[s.level] || s.level)}</span>
            </div>
            <p>${esc(s.description)}</p>
          </div>
        `).join('')}
      </div>
      ${failureZones.length > 0 ? `
        <div class="risk-banner">
          <h4>⚠️ Swell Shield — Analyse des risques</h4>
          <p>${failureZones.map(z => `${esc(z.zone_name)}: multiplicateur dommage ×${z.damage_multiplier}${z.rider_level_warning ? ` — niveau min. ${esc(LEVELS[z.rider_level_warning] || z.rider_level_warning)}` : ''}`).join('. ')}. Toutes les boards Swell sont couvertes par notre garantie dommages.</p>
        </div>
      ` : ''}
    </div>

    <!-- 3. CONDITIONS -->
    <div class="section">
      <div class="section-header">
        <div class="section-icon conditions">🌤️</div>
        <h2 class="section-title">Conditions de surf</h2>
      </div>
      <div class="conditions-grid">
        <div class="condition-item">
          <div class="label">Meilleure saison</div>
          <div class="value">${esc(meta.bestSeason)}</div>
        </div>
        <div class="condition-item">
          <div class="label">Vagues typiques</div>
          <div class="value">${esc(meta.typicalWaves)}</div>
        </div>
        <div class="condition-item">
          <div class="label">Température eau</div>
          <div class="value">${esc(meta.waterTemp)}</div>
        </div>
        <div class="condition-item">
          <div class="label">Vent idéal</div>
          <div class="value">${esc(meta.bestWind)}</div>
        </div>
        <div class="condition-item">
          <div class="label">Marée idéale</div>
          <div class="value">${esc(meta.bestTide)}</div>
        </div>
      </div>
    </div>

    <!-- 4. ÉCOLES DE SURF -->
    <div class="section">
      <div class="section-header">
        <div class="section-icon schools">🎓</div>
        <h2 class="section-title">Écoles de surf</h2>
      </div>
      <div class="list-items">
        ${meta.surfSchools.map(s => `
          <div class="list-item">
            <div class="list-item-icon school">🏫</div>
            <div class="list-item-body">
              <h4>${esc(s.name)}</h4>
              <div class="type-badge">${esc(s.type)}</div>
              <p>${esc(s.desc)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 5. SHOPS PARTENAIRES -->
    <div class="section">
      <div class="section-header">
        <div class="section-icon shops">🛒</div>
        <h2 class="section-title">Shops & Partenaires</h2>
      </div>
      <div class="list-items">
        ${meta.shops.map(s => `
          <div class="list-item">
            <div class="list-item-icon shop">🏪</div>
            <div class="list-item-body">
              <h4>${esc(s.name)}</h4>
              <div class="type-badge">${esc(s.type)}</div>
              <p>${esc(s.desc)}</p>
            </div>
          </div>
        `).join('')}
        ${dbPartners.map(p => `
          <div class="list-item">
            <div class="list-item-icon shop">🤝</div>
            <div class="list-item-body">
              <h4>${esc(p.name)}${p.website ? ` <a href="${esc(p.website)}" rel="noopener" target="_blank" style="font-size:0.78rem;color:var(--primary);margin-left:0.4rem;">→ Site</a>` : ''}</h4>
              <div class="type-badge">Partenaire Swell</div>
              <p>${esc(p.type ? p.type.charAt(0).toUpperCase() + p.type.slice(1) : '')}${p.location ? ` — ${esc(p.location)}` : ''}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 6. FAQ LOCALE -->
    <div class="section">
      <div class="section-header">
        <div class="section-icon faq">❓</div>
        <h2 class="section-title">FAQ — ${esc(meta.displayName)}</h2>
      </div>
      <div class="faq-list">
        ${allFaq.map(f => `
          <div class="faq-item">
            <h4>${esc(f.q)}</h4>
            <p>${esc(f.a)}</p>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 7. REVIEWS -->
    ${reviews.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <div class="section-icon reviews">⭐</div>
        <h2 class="section-title">Avis des riders</h2>
      </div>
      <div class="reviews-list">
        ${reviews.map(r => `
          <div class="review-card">
            <div class="review-header">
              <div class="review-avatar">${r.reviewer_avatar ? `<img src="${esc(r.reviewer_avatar)}" alt="Avatar du reviewer Swell">` : esc((r.reviewer_name || '?').charAt(0).toUpperCase())}</div>
              <div>
                <div class="review-author">${esc(r.reviewer_name)}</div>
                <div class="review-stars">${'★'.repeat(Math.round(r.rating))}${'☆'.repeat(5 - Math.round(r.rating))}</div>
                <div class="review-board">${esc(r.board_title)}${r.spot_name ? ` — ${esc(r.spot_name)}` : ''}</div>
              </div>
            </div>
            ${r.comment ? `<p class="review-comment">${esc(r.comment)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- AUTRES SPOTS PROCHES -->
    ${nearbySpots.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <div class="section-icon guide">📍</div>
        <h2 class="section-title">Autres spots proches</h2>
      </div>
      <div class="nearby-spots-grid">
        ${nearbySpots.map(s => {
          const nearbyMeta = SPOT_META[s.slug];
          const label = nearbyMeta ? nearbyMeta.displayName : s.name;
          const levelLabel = LEVELS[s.level] || s.level;
          const waveLabel = WAVE[s.wave_type] || s.wave_type;
          return `<a href="/spot/${esc(s.slug)}" class="nearby-spot-card">
            <span class="nearby-spot-name">${esc(label)}</span>
            <span class="nearby-spot-meta">${esc(waveLabel)} · ${esc(levelLabel)}</span>
          </a>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- CTAs -->
    <div class="cta-dual">
      <div class="cta-card host">
        <h2>Tu as une board ici ?</h2>
        <p>Liste ta planche à ${esc(meta.displayName)} — c'est gratuit, garanti par Swell Shield.</p>
        <a href="/app.html#list" class="cta-btn">Lister ma board →</a>
      </div>
      <div class="cta-card rider">
        <h2>Tu cherches une board ?</h2>
        <p>Trouve la planche parfaite louée par des surfeurs locaux.</p>
        <a href="/app.html${isRegion ? '' : `?spot=${slug}`}" class="cta-btn">Voir les boards →</a>
      </div>
    </div>
  </div>

  <footer class="site-footer">
    <div class="footer-accent-line"></div>
    <div class="footer-nl-band">
      <div class="footer-nl-band-inner">
        <div class="footer-nl-text">
          <h3>Reste dans le <span>lineup</span></h3>
          <p>Spots, boards rares, nouveaux riders &mdash; dans ta bo&icirc;te, pas ton feed.</p>
        </div>
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
          <p class="footer-tagline">Arrive l&eacute;ger. Surfe local.<br>Location de planches entre surfeurs &mdash; sans shop, sans interm&eacute;diaire.</p>
          <div class="footer-socials">
            <a href="mailto:swell@polsia.app" class="footer-social-btn" aria-label="Email">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M22 6l-10 7L2 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
            <a href="https://instagram.com/swell_surf" target="_blank" rel="noopener noreferrer" class="footer-social-btn" aria-label="Instagram">
              <svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>
            </a>
            <a href="https://tiktok.com/@swell_surf" target="_blank" rel="noopener noreferrer" class="footer-social-btn" aria-label="TikTok">
              <svg viewBox="0 0 24 24" fill="none"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
          </div>
        </div>
        <div class="footer-col">
          <h4>Navigation</h4>
          <ul>
            <li><a href="/">Accueil</a></li>
            <li><a href="/app.html">Marketplace</a></li>
            <li><a href="/blog">Blog</a></li>
            <li><a href="/partner">Partenaires</a></li>
            <li><a href="/#faq">FAQ</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Spots</h4>
          <ul>
            <li><a href="/spot/hossegor" class="footer-spot-tag">Hossegor</a></li>
            <li><a href="/spot/seignosse" class="footer-spot-tag">Seignosse</a></li>
            <li><a href="/spot/anglet" class="footer-spot-tag">Anglet</a></li>
            <li><a href="/spot/capbreton" class="footer-spot-tag">Capbreton</a></li>
            <li><a href="/spot/cote-des-basques" class="footer-spot-tag">C&ocirc;te des Basques</a></li>
            <li><a href="/spot/lafitenia" class="footer-spot-tag">Lafitenia</a></li>
            <li><a href="/spot/biarritz" class="footer-spot-tag">Biarritz</a></li>
            <li><a href="/spot/bidart" class="footer-spot-tag">Bidart</a></li>
            <li><a href="/spot/guethary" class="footer-spot-tag">Gu&eacute;thary</a></li>
            <li><a href="/spot/hendaye" class="footer-spot-tag">Hendaye</a></li>
            <li><a href="/spot/saint-jean-de-luz" class="footer-spot-tag">St-Jean-de-Luz</a></li>
            <li><a href="/spot/sables-d-olonne" class="footer-spot-tag">Sables-d&rsquo;Olonne</a></li>
            <li><a href="/spot/la-tranche-sur-mer" class="footer-spot-tag">La Tranche</a></li>
            <li><a href="/spot/noirmoutier" class="footer-spot-tag">Noirmoutier</a></li>
            <li><a href="/spot/longeville-sur-mer" class="footer-spot-tag">Longeville</a></li>
            <li><a href="/spot/saint-gilles-croix-de-vie" class="footer-spot-tag">St-Gilles</a></li>
            <li><a href="/spot/parlementia" class="footer-spot-tag">Parlementia</a></li>
            <li><a href="/spot/les-bourdaines" class="footer-spot-tag">Les Bourdaines</a></li>
          </ul>
        </div>
      </div>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-trust-bar">
      <span class="footer-trust-pill">
        <svg class="trust-icon-lock" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Paiement s&eacute;curis&eacute;
      </span>
      <span class="footer-trust-pill">
        <svg class="trust-icon-check" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Identit&eacute; v&eacute;rifi&eacute;e
      </span>
      <span class="footer-trust-pill">
        <svg class="trust-icon-shield" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        Garantie dommages
      </span>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-bottom">
      <span class="footer-bottom-copy">&copy; 2026 Swell &mdash; Made in Hossegor &#x1f91f;</span>
      <div class="footer-bottom-links">
        <a href="/cgv">CGU / CGV</a>
        <a href="/confidentialite">Confidentialit&eacute;</a>
        <a href="mailto:swell@polsia.app">Contact</a>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

// ─── Route ──────────────────────────────────────────────────────────────────
const SUPPORTED_SLUGS = Object.keys(SPOT_META);

router.get('/:slug', async (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const meta = SPOT_META[slug];

  if (!meta) {
    return res.status(404).send(`
      <!DOCTYPE html><html><head><title>Spot non trouvé | Swell</title></head>
      <body style="background:#0e1e36;color:#fff;font-family:sans-serif;text-align:center;padding:4rem;">
        <h1>Spot non trouvé</h1>
        <p>Essaie : <a href="/spot/hossegor" style="color:#00c2e0;">Hossegor</a>,
        <a href="/spot/seignosse" style="color:#00c2e0;">Seignosse</a>,
        <a href="/spot/anglet" style="color:#00c2e0;">Anglet</a>,
        <a href="/spot/capbreton" style="color:#00c2e0;">Capbreton</a>,
        <a href="/spot/cote-des-basques" style="color:#00c2e0;">Côte des Basques</a>,
        <a href="/spot/biarritz" style="color:#00c2e0;">Biarritz</a>,
        <a href="/spot/lafitenia" style="color:#00c2e0;">Lafitenia</a>,
        <a href="/spot/sables-d-olonne" style="color:#00c2e0;">Sables-d&Olonne</a>,
        <a href="/spot/la-tranche-sur-mer" style="color:#00c2e0;">La Tranche-sur-Mer</a>,
        <a href="/spot/longeville-sur-mer" style="color:#00c2e0;">Longeville-sur-Mer</a>,
        <a href="/spot/saint-gilles-croix-de-vie" style="color:#00c2e0;">Saint-Gilles</a>,
        <a href="/spot/noirmoutier" style="color:#00c2e0;">Noirmoutier</a></p>
        <br><a href="/" style="color:#ff6b35;">← Retour à Swell</a>
      </body></html>
    `);
  }

  try {
    const verifiedOnly = req.query.verified === '1';
    const data = await getSpotPageData(slug, { verifiedOnly });
    if (!data || !data.spots || data.spots.length === 0) {
      return res.status(404).send('Spot data not found');
    }

    // Sticky counter: how many boards are available today at this spot?
    const spotIds = data.spots.map(s => s.id);
    // Location keywords for partner lookup: use displayName + region
    const locationKeywords = [meta.displayName, meta.region].filter(Boolean);
    const [availableToday, nearbySpots, dbPartners] = await Promise.all([
      getSpotAvailableTodayCount(spotIds),
      getNearbySpots(
        data.spots[0]?.latitude,
        data.spots[0]?.longitude,
        spotIds
      ),
      getPartnersByLocation(locationKeywords),
    ]);

    const html = renderSpotPage(slug, { ...meta, nonce: res.locals.cspNonce }, { ...data, availableToday, verifiedOnly, nearbySpots, dbPartners });
    // Cache for 5 min — spot pages change infrequently
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(html);
  } catch (err) {
    console.error(`GET /spot/${slug} error:`, err);
    res.status(500).send('Erreur serveur — réessayez plus tard.');
  }
});

module.exports = router;
