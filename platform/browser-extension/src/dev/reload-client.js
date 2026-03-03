/**
 * Dev reload client for the side panel.
 *
 * Connects to the dev reload WebSocket relay server and refreshes the
 * page when a matching DO_UPDATE signal is received. Responds to both
 * 'side-panel' (UI-only change) and 'extension' (full reload — the
 * background script will also trigger chrome.runtime.reload(), but
 * refreshing the side panel first is harmless and can feel faster).
 *
 * This file is plain JS (not TypeScript) because it is read at build
 * time and prepended to the side panel bundle via esbuild's banner
 * option. The __DEV_RELOAD_PORT__ placeholder is replaced by string
 * substitution in the build script with the actual port number.
 */
(() => {
  const port = __DEV_RELOAD_PORT__;
  const url = `ws://localhost:${port}`;
  const prefix = '[dev-reload]';
  let backoff = 500;
  const maxBackoff = 10000;

  const connect = () => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(prefix, 'Connected to', url);
      backoff = 500;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'do_update' && (msg.id === 'side-panel' || msg.id === 'extension')) {
          console.log(prefix, `Reloading side panel (${msg.id})`);
          window.location.reload();
        }
      } catch (_) {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      console.log(prefix, 'Disconnected — reconnecting in', `${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    };

    ws.onerror = () => {
      // onclose fires after onerror, so reconnect logic is handled there
    };
  };

  connect();
})();
