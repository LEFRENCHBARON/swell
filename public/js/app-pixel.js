    (function(){
      var PIXEL_ID = '1367150358557387';
      function firePixel() {
        var f = window.fbq = window.fbq || function(){ (window.fbq.queue = window.fbq.queue || []).push(arguments) };
        var s,t; s = document.createElement('script'); s.async = 1;
        s.src = 'https://connect.facebook.net/en_US/fbevents.js';
        t = document.getElementsByTagName('script')[0]; t.parentNode.insertBefore(s, t);
        window.fbq('init', PIXEL_ID);
        window.fbq('track', 'PageView');
      }
      function hasConsent() { return localStorage.getItem('swell_analytics') === 'accepted'; }
      if (hasConsent()) { firePixel(); }
      else {
        window._swellPixelFns = window._swellPixelFns || [];
        window._swellPixelFns.push({ fire: firePixel });
      }
    })();

