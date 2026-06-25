import { clearAuthCache, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isSharePointDocument } from '../microsoft-word-api.js';

/** localStorage key the pre-script mirrors the captured Graph token to. */
const LS_TOKEN_KEY = '__opentabs_word_graph_token';

/**
 * Recover from a stale Graph token on SharePoint/OneDrive-hosted documents.
 *
 * On those pages the Graph token is captured by the pre-script from MSAL's
 * AAD token-endpoint responses. After the captured token expires (~1h), MSAL
 * keeps minting fresh tokens silently — but reads them from its encrypted
 * cache without re-hitting the token endpoint, so the pre-script's
 * window-of-opportunity has closed and the LS mirror goes stale.
 *
 * The only reliable recovery is to clear MSAL's localStorage state so that
 * the next page load forces MSAL to re-acquire from the token endpoint —
 * which the pre-script catches. SSO cookies stay intact, so the
 * re-acquisition is silent (no sign-in UI).
 *
 * Caller protocol: when `microsoft-word__*` tools return an `AUTH_ERROR` whose
 * message ends with "Call `microsoft-word__reauthenticate` to recover", invoke
 * this tool, wait for the tab to reload (~5 seconds), then retry the
 * original operation.
 */
export const reauthenticate = defineTool({
  name: 'reauthenticate',
  displayName: 'Reauthenticate',
  description:
    'Clear cached MSAL state and reload the SharePoint/OneDrive tab to force a fresh Microsoft Graph token. ' +
    'Use this when another Word tool returns an authentication error pointing at this tool. ' +
    'After invoking, wait ~5 seconds for the tab to finish reloading, then retry the original operation.',
  summary: 'Force a fresh Microsoft Graph token by clearing stale MSAL state and reloading the tab',
  icon: 'refresh-cw',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    status: z.enum(['reloading', 'skipped']),
    message: z.string(),
  }),
  handle: async () => {
    // Only meaningful on SharePoint/OneDrive — the standalone
    // `word.cloud.microsoft` app has no encrypted-cache problem, so
    // there is nothing to clear and no reload to perform.
    if (!isSharePointDocument()) {
      return {
        status: 'skipped' as const,
        message:
          'This tab is not a SharePoint/OneDrive document — reauthenticate has no effect here. If you are seeing AUTH_ERROR on a standalone word.cloud.microsoft tab, sign in to Microsoft 365 in this browser session.',
      };
    }

    // Clear every MSAL entry and our own captured-token mirror. We sweep by
    // prefix rather than by exact key because MSAL's enterprise format
    // namespaces each entry with a home-account-id and tenant id we don't
    // know up front. Use a two-pass delete (collect then remove) so we
    // don't perturb the iteration mid-flight.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('msal.') || k === LS_TOKEN_KEY)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);

    // Drop the adapter's cached token too so the next tool call after reload
    // looks at the freshly captured value.
    clearAuthCache('microsoft-word');

    // Reload after the response is sent. The setTimeout gives the dispatch
    // pipeline a tick to serialize our return value before the page goes
    // away. `location.reload()` itself is fire-and-forget — the adapter
    // process dies with the page.
    setTimeout(() => location.reload(), 50);

    return {
      status: 'reloading' as const,
      message:
        'Cleared cached MSAL state and reloading the tab. The pre-script will capture a fresh Graph token from the next AAD round-trip (silent via SSO cookies). Wait ~5 seconds, then retry the original tool call.',
    };
  },
});
