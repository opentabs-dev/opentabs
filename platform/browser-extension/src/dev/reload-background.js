/**
 * Dev reload client for the background service worker.
 *
 * Connects to the dev reload WebSocket relay server and triggers a full
 * extension reload (chrome.runtime.reload()) when a DO_UPDATE signal with
 * id 'extension' is received. Ignores 'side-panel' updates — the side
 * panel has its own reload client that handles those.
 *
 * Before reloading, clears the 'wsConnected' session storage key to prevent
 * the restarted background script from reading stale connection state.
 *
 * This file is plain JS (not TypeScript) because it is read at build time
 * and prepended to the background bundle via esbuild's banner option. The
 * __DEV_RELOAD_PORT__ placeholder is replaced by string substitution in
 * the build script with the actual port number.
 */
(() => {
  const port = __DEV_RELOAD_PORT__;
  const url = `ws://localhost:${port}`;
  const prefix = '[dev-reload:bg]';
  let backoff = 500;
  const maxBackoff = 10000;

  const connect = () => {
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log(prefix, 'Connected to', url);
      backoff = 500;
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'do_update' && msg.id === 'extension') {
          console.log(prefix, 'Reloading extension (full)');
          // Clear wsConnected from session storage before reload to prevent
          // the restarted background script from reading stale state.
          chrome.storage.session
            .set({ wsConnected: false })
            .catch(() => {})
            .then(() => {
              setTimeout(() => {
                chrome.runtime.reload();
              }, 100);
            });
        }
      } catch (_) {
        // Ignore malformed messages
      }
    });

    ws.addEventListener('close', () => {
      console.log(prefix, 'Disconnected — reconnecting in', `${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    });

    ws.addEventListener('error', () => {
      // onclose fires after onerror, so reconnect logic is handled there
    });
  };

  connect();
})();
