import { definePreScript } from '@opentabs-dev/plugin-sdk/pre-script';

/**
 * Pre-script for the Teams plugin.
 *
 * Runs at document_start in MAIN world, strictly before any page script.
 *
 * Captures the MSAL-issued Skype-API access token and the MSAL ID token
 * claims by observing the cache layer MSAL writes through —
 * `Storage.prototype.setItem` plus an initial scan of existing
 * `localStorage` entries. The pre-script inspects each entry's *value*
 * (`credentialType`, `target`, `secret`, `expiresOn`) rather than its
 * *key* shape, so it is agnostic to the cache key layout (which Microsoft
 * has already changed twice — v1 dash-separated `<scope>--` suffix → v2
 * pipe-separated `|<scopes>|`).
 *
 * Why setItem / scan instead of `window.fetch` interception:
 * In Microsoft Teams enterprise web v2, the Skype-scoped access token
 * (`aud=https://api.spaces.skype.com`) is never sent through main-world
 * fetch — it only flows through MSAL's internal cache and is consumed
 * directly by the plugin to call `/api/authsvc/v1.0/authz`. Verified
 * empirically across `fetch`, `XMLHttpRequest`, `WebSocket`,
 * `sendBeacon`, and `chrome.debugger`'s Network domain (which sees
 * Service Worker and worker traffic as well). Hooking `setItem` is the
 * earliest deterministic point at which the token is observable.
 *
 * Adapter reads via `getPreScriptValue` keys:
 *   - `consumerToken`     → { secret, expiresOn } for `teams.live.com`
 *   - `enterpriseToken`   → { secret, expiresOn } for `teams.microsoft.com`
 *   - `signInName`        → preferred_username / upn / email from the ID token
 */
definePreScript(({ set, log }) => {
  const SKYPE_HOST_PATTERN = /spaces\.skype\.com/i;

  type CapturedToken = { secret: string; expiresOn: number };

  const decodeJwtClaims = (jwt: string): Record<string, unknown> | null => {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    try {
      // base64url payloads are emitted without `=` padding; restore it before
      // calling atob, which throws InvalidCharacterError on lengths not
      // divisible by 4.
      const raw = (parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
      const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
      return JSON.parse(atob(padded)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  /**
   * Inspect a single localStorage value. If it parses as an MSAL credential
   * cache entry of interest, stash the relevant pieces.
   */
  const inspect = (value: string): void => {
    if (typeof value !== 'string' || value.length < 32) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(value) as Record<string, unknown>;
    } catch {
      return;
    }

    const credentialType = String(parsed.credentialType ?? '').toLowerCase();
    const secret = typeof parsed.secret === 'string' ? parsed.secret : '';
    if (!secret) return;

    if (credentialType === 'accesstoken') {
      const target = String(parsed.target ?? '');
      if (!SKYPE_HOST_PATTERN.test(target)) return;

      const expiresOn = Number.parseInt(String(parsed.expiresOn ?? '0'), 10);
      if (!Number.isFinite(expiresOn) || expiresOn <= Date.now() / 1000) return;

      const captured: CapturedToken = { secret, expiresOn };
      // Route by current page hostname so the slot we write matches the
      // adapter's detectEnvironment() (which also keys off hostname).
      // Routing on the cached value's `target` host could disagree with
      // detectEnvironment if MSAL ever caches a token for the other audience.
      const slot = window.location.hostname === 'teams.live.com' ? 'consumerToken' : 'enterpriseToken';
      set(slot, captured);
      log.debug(`[teams] captured ${slot}`);
      return;
    }

    if (credentialType === 'idtoken') {
      const claims = decodeJwtClaims(secret);
      if (!claims) return;
      const signInName = String(claims.preferred_username ?? claims.upn ?? claims.email ?? '');
      if (signInName) {
        set('signInName', signInName);
        // Don't log the value — preferred_username / upn / email is PII.
        log.debug('[teams] captured sign-in name from ID token');
      }
    }
  };

  // 1. Initial scan — picks up tokens MSAL persisted in a previous session.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      if (val) inspect(val);
    }
  } catch {
    // localStorage access can throw under sandboxing; ignore.
  }

  // 2. Hook setItem — picks up token refreshes and fresh logins.
  // Idempotent: if the prototype is already patched (re-injection during
  // dev hot reload, future iframe-realm reuse, etc.), skip rather than
  // stack wrappers (which would walk an N-deep call chain on every write).
  const PATCH_MARKER = '__opentabsTeamsSetItemPatched';
  const proto = Storage.prototype as Storage & Record<string, unknown>;
  if (!proto[PATCH_MARKER]) {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key: string, value: string) {
      try {
        if (this === localStorage) inspect(value);
      } catch {
        // Never break the page if our observer throws.
      }
      return realSetItem.call(this, key, value);
    };
    proto[PATCH_MARKER] = true;
  }

  log.info('[teams] MSAL cache observer installed');
});
