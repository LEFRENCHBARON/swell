# Brand Migration Plan — Swell → [Winning Brand]

**Cible :** Moins de 30 minutes entre validation de Sebas et marque live en prod.
**Stratégie :** Commit unique sur `main` — on ne fait pas de rolling upgrade, on bascule tout en une fois.

---

## 1. Inventaire exhaustif des occurrences "Swell" / "swell.polsia.app"

Run this to get a fresh count before your migration commit:

```bash
grep -rn "Swell\|swell\|swell\.polsia\.app" \
  public/ routes/ server.js services/ \
  --include="*.html" --include="*.js" --include="*.json" --include="*.svg" \
  | grep -v "public/brand" | grep -v "brand-lab"
```

### Known occurrences by file (as of 2026-05-28)

| File | Occurrences | What to change |
|------|-------------|----------------|
| `public/index.html` | 53 | `<title>`, `og:title`, `og:site_name`, `og:url`, `og:image`, `twitter:*`, JSON-LD `name`/`url`/`logo`/`sameAs`, nav wordmark, footer copy, all inline copy mentioning "Swell" |
| `public/app.html` | 61 | Same meta + all in-page copy, PWA prompt text, booking/review copy |
| `public/host.html` | 3 | `<title>`, nav logo |
| `public/payment-success.html` | ~14 | Title, headings, CTAs, `swell.polsia.app` URLs |
| `public/deposit-success.html` | ~14 | Same |
| `public/partner.html` | ~14 | Title, headings, copy |
| `public/manifest.json` | 2 | `name`, `short_name` |
| `public/og-image.svg` | 2 | `Swell` text, subtitle |
| `public/robots.txt` | 1 | `Sitemap:` URL |
| `server.js` | 11 | `BASE_URL`, session cookie name, schema.org strings, CORS origin if set |
| `routes/seo.js` | 11 | `BASE_URL`, JSON-LD `name`/`url`/`logo`/`sameAs`, `<title>`, footer copy in HTML templates |
| `routes/spot-pages.js` | 40 | Same pattern — `BASE_URL`, JSON-LD, all HTML strings |
| `services/email.js` | 1 | `replyTo: 'sebastien@swell.fr'` → `sebastien@[newdomain].com` |
| `public/blog/*.html` | multiple | Check each article's `<title>`, `<meta og:>`, in-text brand mentions |
| `public/sw.js` | check | Cache name strings like `swell-v3` |
| `public/sw-v3.js` | check | Same |

### Additional strings to grep

```bash
# Domain references
grep -rn "swell\.polsia\.app\|swell\.fr\|swell\.com" public/ routes/ server.js services/

# Schema.org JSON-LD (most critical for SEO)
grep -rn '"@type".*Organization\|"name".*Swell\|"url".*swell' routes/ server.js

# Service Worker cache names
grep -n "swell" public/sw.js public/sw-v3.js
```

---

## 2. Stratégie de remplacement — commit unique

### Approche recommandée : sed + targeted edits

```bash
# 1. Export the new brand variables
NEW_NAME="Wavehold"           # ← remplacer par le gagnant
NEW_DOMAIN="wavehold.com"     # ← nouveau domaine .com
NEW_TAGLINE="Hold the local knowledge."
NEW_SHORT="Wavehold"
NEW_THEME="#060e0b"
NEW_PRIMARY="#0ec6a2"
OLD_URL="https://swell.polsia.app"
NEW_URL="https://wavehold.com"   # ← ou https://${NEW_NAME,,}.polsia.app en attendant le DNS

# 2. Bulk replace the safe strings (URLs, site name)
find public routes server.js services -name "*.html" -o -name "*.js" -o -name "*.json" | \
  xargs sed -i \
    -e "s|swell\.polsia\.app|${NEW_DOMAIN}|g" \
    -e "s|https://swell\.polsia\.app|${NEW_URL}|g"

# 3. Replace brand name in meta tags and JSON-LD
# (careful — don't blindly replace all "Swell", some appear mid-sentence)
# Use targeted patches for the JSON-LD blocks in routes/seo.js and routes/spot-pages.js
```

**Important:** Après le `sed` en masse, relire manuellement les 5 fichiers les plus gros (`index.html`, `app.html`, `routes/seo.js`, `routes/spot-pages.js`) pour les chaînes mi-phrase qui auraient besoin d'un rewrite humain plutôt qu'un replace mécanique.

### Fichiers à patcher manuellement (pas de sed aveugle)

- `routes/seo.js` — les chaînes de copy comme `"Réserve directement sur Swell"`, `"© 2026 Swell"` → vérifier le contexte avant replace
- `routes/spot-pages.js` — même chose
- `services/email.js` — changer `replyTo` vers nouvelle adresse email
- `public/manifest.json` — copier depuis `public/brand/${ID}/manifest.json`
- `public/og-image.svg` — copier depuis `public/brand/${ID}/og-image.svg`

---

## 3. Plan DNS

### Registrar recommandé

**Cloudflare Registrar** (cloudflare.com/products/registrar) — tarif coûtant, DNSSEC gratuit, interface API-first.
Alternative : Namecheap, Porkbun.

### Vérifier la disponibilité du domaine en premier

```bash
whois wavehold.com
whois tidale.com
whois surfpal.com
whois localboard.com
whois shackwave.com
```

### Configuration DNS (Cloudflare)

Une fois le domaine acheté et nameservers pointés sur Cloudflare :

```
# A record pointing to Render
Type  Name   Value                  TTL    Proxy
A     @      [Render IP]            Auto   ✓ (proxied)
A     www    [Render IP]            Auto   ✓ (proxied)

# Ou CNAME vers Render (si Render supporte les CNAME apex — utiliser ALIAS/ANAME)
CNAME @      swell.onrender.com     Auto   ✓
CNAME www    swell.onrender.com     Auto   ✓
```

Pour trouver l'IP Render : `nslookup swell.polsia.app`

### Étapes Render custom domain

1. Dashboard Render → Service Swell → **Settings** → **Custom Domains**
2. Ajouter `newdomain.com` et `www.newdomain.com`
3. Render affiche un CNAME cible (ex: `swell.onrender.com`) — ajouter en DNS Cloudflare
4. Attendre validation SSL (2–5 min avec Cloudflare proxy actif)
5. Vérifier : `curl -I https://newdomain.com` → 200 OK

---

## 4. Redirects 301 : swell.polsia.app → nouveau-domaine.com

### Option A — Render Rewrites (recommandé, zéro latence supplémentaire)

Dans `render.yaml`, ajouter un service de redirect ou utiliser les headers :

```yaml
# render.yaml
services:
  - type: web
    name: swell
    env: node
    redirects:
      - source: /*
        destination: https://newdomain.com/:splat
        type: 301
        hosts:
          - swell.polsia.app
```

Ou via une route Express dans `server.js` (déjà actif, plus rapide à déployer) :

```js
// server.js — avant toutes les autres routes
app.use((req, res, next) => {
  if (req.hostname === 'swell.polsia.app') {
    return res.redirect(301, `https://newdomain.com${req.url}`);
  }
  next();
});
```

### Option B — Cloudflare Worker (si swell.polsia.app est aussi sur Cloudflare)

```js
// worker.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'newdomain.com';
    return Response.redirect(url.toString(), 301);
  }
}
```

**Note :** `swell.polsia.app` est un sous-domaine Polsia — contacter support@polsia.com pour activer le redirect au niveau plateforme. En attendant, la route Express ci-dessus est autonome.

---

## 5. Postmark — signature domain nouveau

### Actions requises

1. **Nouveau domaine d'envoi** dans Postmark :
   - Settings → Sender Signatures → Add Sender Signature
   - Adresse : `noreply@newdomain.com` (ou `sebastien@newdomain.com`)

2. **DNS records à ajouter** (Postmark vous les fournit) :
   ```
   # DKIM
   TXT   pm._domainkey.newdomain.com   "k=rsa; p=..."

   # SPF (ajouter à l'enregistrement SPF existant ou créer)
   TXT   @                              "v=spf1 include:spf.mtasv.net ~all"

   # Return-Path (bounce tracking)
   CNAME pm-bounces.newdomain.com      pm.mtasv.net
   ```

3. **Mettre à jour `services/email.js`** :
   ```js
   // Avant
   replyTo: replyTo || 'sebastien@swell.fr',

   // Après
   replyTo: replyTo || 'sebastien@newdomain.com',
   ```

4. **Mise à jour du `From:` dans Postmark** : changer le Sender Signature actif de `@swell.fr` vers `@newdomain.com` — garder l'ancien actif pendant 30 jours pour les emails en transit.

5. **Déprécation progressive** : après 30 jours, supprimer l'ancienne signature `@swell.fr`.

---

## 6. Schema.org JSON-LD — mise à jour

### Fichiers concernés

- `routes/seo.js` — Organization schema (homepage), Product/Offer schema (boards)
- `routes/spot-pages.js` — LocalBusiness, BreadcrumbList, Place schema
- `public/index.html` — inline Organization JSON-LD block

### Champs à mettre à jour

```json
{
  "@type": "Organization",
  "name": "NewBrandName",
  "url": "https://newdomain.com",
  "logo": "https://newdomain.com/brand/newbrand/logo-mark-light.svg",
  "sameAs": [
    "https://www.instagram.com/newbrandname",
    "https://www.facebook.com/newbrandname"
  ]
}
```

```json
{
  "@type": "LocalBusiness",
  "name": "NewBrandName — Location de planches",
  "url": "https://newdomain.com"
}
```

Dans les BreadcrumbList :
```json
{ "@type": "ListItem", "position": 1, "name": "NewBrandName", "item": "https://newdomain.com" }
```

---

## 7. SEO — stratégie complète

### Google Search Console

1. Ajouter le nouveau domaine comme nouvelle propriété dans Search Console
2. Méthode de vérification recommandée : DNS TXT record (le plus robuste)
3. Soumettre `https://newdomain.com/sitemap.xml` immédiatement après déploiement
4. Utiliser l'outil **Change of Address** dans la Search Console (Settings → Change of Address)
   — cela accélère le re-crawl et la transmission du PageRank

### sitemap.xml

Le sitemap est généré dynamiquement par `routes/seo.js`. Mettre à jour `BASE_URL` :

```js
// routes/seo.js
const BASE_URL = 'https://newdomain.com';  // was 'https://swell.polsia.app'
```

Vérifier que `https://newdomain.com/sitemap.xml` retourne un XML valide après déploiement.

### robots.txt

Mettre à jour `public/robots.txt` :

```
User-agent: *
Disallow: /api/
Disallow: /admin

Sitemap: https://newdomain.com/sitemap.xml
```

### Email aux 22 utilisateurs existants

```
Objet : [NewBrandName] — Nouveau nom, même service ⟶ boardez ici

Salut {first_name},

Swell devient [NewBrandName]. Même équipe, mêmes planches, même confiance.

Ton compte est intact — aucune action requise. Tes réservations et boards
sont visibles à : https://newdomain.com/app.html

On a voulu un nom qui colle mieux à ce qu'on fait : aider les surfeurs à
trouver et partager des planches locales. [Tagline du nouveau nom].

À l'eau,
Sebas

---
[NewBrandName] — newdomain.com
```

**Envoyer depuis Postmark, masse < 50 → pas besoin de liste de désinscription spéciale (transactionnel).**

---

## 8. Checklist de vérification post-déploiement (15 points)

Exécuter dans les 30 minutes suivant le merge en production.

```
☐  1. https://newdomain.com répond 200 (curl -I)
☐  2. https://www.newdomain.com redirige vers https://newdomain.com (301)
☐  3. https://swell.polsia.app redirige vers https://newdomain.com (301)
☐  4. <title> de la homepage contient le nouveau nom
☐  5. og:site_name et og:title contiennent le nouveau nom (view-source)
☐  6. https://newdomain.com/sitemap.xml retourne XML valide
☐  7. https://newdomain.com/robots.txt contient la bonne URL de sitemap
☐  8. PWA manifest.json → name et short_name corrects (DevTools → Application → Manifest)
☐  9. Favicon visible dans l'onglet navigateur (nouveau logo)
☐ 10. OG image affiche le nouveau branding (paste URL in https://opengraph.xyz)
☐ 11. Email de test envoyé — header affiche nouveau nom, reply-to correct
☐ 12. Créer une réservation test — flow complet fonctionne
☐ 13. Login / signup fonctionnent (session cookie pas cassé par le rename)
☐ 14. Google Search Console : soumettre sitemap, lancer crawl test sur /
☐ 15. Service Worker : vider cache navigateur, recharger — nouveau SW actif
```

---

## Commande de déploiement rapide (récap)

```bash
# 1. Générer les assets du brand gagnant
node scripts/generate-brand-kit.js

# 2. Copier les fichiers actifs
cp public/brand/WINNER/manifest.json public/manifest.json
cp public/brand/WINNER/og-image.svg public/og-image.svg
cp public/brand/WINNER/favicon.svg public/icons/icon.svg
cp public/brand/WINNER/favicon-maskable.svg public/icons/icon-maskable.svg

# 3. Appliquer les tokens CSS
# (copier le contenu de public/brand/WINNER/tokens.css dans le :root de index.html et app.html)

# 4. Bulk replace des URLs dans les fichiers serveur
# (voir section 2 ci-dessus)

# 5. Valider
node scripts/generate-brand-kit.js  # idempotent, safe to re-run
node --check server.js
find routes -name "*.js" -exec node --check {} \;

# 6. Commit + push
git add -A
git commit -m "feat: rebrand Swell → WINNER — assets, copy, DNS, manifest"
# push_to_remote depuis Polsia infra
```

**Délai réaliste : 15–20 minutes d'édition + ~5 minutes de déploiement Render = 20–25 min total.**
