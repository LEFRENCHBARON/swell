if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw-v3.js?v=3').catch(() => {});
  });
}

