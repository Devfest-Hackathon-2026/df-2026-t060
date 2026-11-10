// localhost / HTTPS で開いたとき、アプリを次回のオフライン起動用に保存する。
if ('serviceWorker' in navigator && window.isSecureContext) {
  addEventListener('load', async () => {
    try { const reg = await navigator.serviceWorker.register('./inquiry-offline-sw.js'); await reg.update(); }
    catch (e) { console.info('オフライン保存を準備できませんでした:', e.message); }
  });
}
