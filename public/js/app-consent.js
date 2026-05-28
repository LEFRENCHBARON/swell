// Cookie consent — CNIL-compliant banner, consent-gated pixel loader.
// Categories:
//   analytics: optional, opt-in (performance/traffic)
//   marketing:  optional, opt-in (Meta Pixel)
//
// Server-side proof logged to consent_log via POST /api/consent/log.
// Essential cookies (session, CSRF) are always active and never logged.
(function () {
  var COOKIE_NAME = 'cookie_consent';
  var LS_KEY = 'swell_analytics';
  var COOKIE_MAX_AGE = 365 * 24 * 3600; // 1 year

  function getStored() {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]*)'));
    if (match) {
      try { return JSON.parse(decodeURIComponent(match[1])); }
      catch (e) { return null; }
    }
    return null;
  }

  function setCookie(value) {
    document.cookie = COOKIE_NAME + '=' + encodeURIComponent(JSON.stringify(value)) +
      ';max-age=' + COOKIE_MAX_AGE + ';path=/;SameSite=Lax' +
      (location.protocol === 'https:' ? ';Secure' : '');
  }

  // Fire or silence the queued pixel callbacks based on marketing consent
  function applyConsent(consent) {
    if (!consent) return;
    if (consent.marketing === true && window._swellPixelFns) {
      window._swellPixelFns.forEach(function (fn) { fn.fire(); });
    } else if (window._swellPixelFns) {
      window._swellPixelFns.forEach(function (fn) { fn.fire = function () {}; });
    }
  }

  // Accept all: analytics + marketing = true
  window.__swellAcceptConsent = function () {
    var consent = { analytics: true, marketing: true };
    localStorage.setItem(LS_KEY, 'accepted');
    setCookie(consent);
    applyConsent(consent);
    document.getElementById('consent-banner').classList.add('hidden');
    sendToServer(consent);
  };

  // Deny all: analytics + marketing = false
  window.__swellDenyConsent = function () {
    var consent = { analytics: false, marketing: false };
    localStorage.setItem(LS_KEY, 'denied');
    setCookie(consent);
    applyConsent(consent);
    document.getElementById('consent-banner').classList.add('hidden');
    sendToServer(consent);
  };

  // Custom: link to privacy policy where user can exercise rights
  window.__swellCustomConsent = function () {
    window.location.href = '/confidentialite';
  };

  // Async POST — does not block the UI
  function sendToServer(consent) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/consent/log', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ consent: consent }));
    } catch (e) { /* non-critical */ }
  }

  // On page load: show banner only if no stored consent
  (function () {
    var stored = getStored();
    if (stored) {
      applyConsent(stored);
      document.getElementById('consent-banner').classList.add('hidden');
    }
  })();
})();