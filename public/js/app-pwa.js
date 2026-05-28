// PWA: Service Worker registration + install prompt
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw-v3.js?v=3').catch(() => {});
  });
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show install banner after 20s of browsing
  setTimeout(() => {
    if (!deferredPrompt) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-install';
    banner.innerHTML = `
      <style>
        #pwa-install{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;
          background:#fff;border:1px solid rgba(0,0,0,0.1);
          border-radius:16px;padding:16px 20px;display:flex;align-items:center;gap:14px;
          box-shadow:0 12px 40px rgba(0,0,0,0.15);max-width:420px;width:calc(100% - 32px);
          font-family:'Space Grotesk','DM Sans',sans-serif;animation:slideUp .4s ease}
        @keyframes slideUp{from{transform:translateX(-50%) translateY(100px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
        #pwa-install img{width:44px;height:44px;border-radius:10px;flex-shrink:0}
        #pwa-install .txt{flex:1;color:#1a1a1a}
        #pwa-install .txt b{font-size:.95rem;display:block;margin-bottom:2px}
        #pwa-install .txt span{font-size:.8rem;color:rgba(0,0,0,0.5)}
        #pwa-install button{border:none;border-radius:10px;padding:10px 18px;font-weight:600;font-size:.85rem;cursor:pointer}
        #pwa-install .install{background:linear-gradient(135deg,#ff6b35,#ff8c5a);color:#fff}
        #pwa-install .dismiss{background:transparent;color:rgba(0,0,0,0.35);font-size:.8rem;padding:8px}
      </style>
      <img src="/icons/icon-192.png" alt="Swell">
      <div class="txt"><b>Installe Swell</b><span>Accès rapide depuis ton écran d'accueil</span></div>
      <button class="install" onclick="document.getElementById('pwa-install').__install()">Installer</button>
      <button class="dismiss" onclick="this.parentElement.remove()">&#x2715;</button>
    `;
    banner.__install = async () => {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner.remove();
    };
    document.body.appendChild(banner);
  }, 20000);
});

