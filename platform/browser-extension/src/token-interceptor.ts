/**
 * Token interceptor — injected at document_start in MAIN world before any page scripts run.
 *
 * Patches window.fetch and XMLHttpRequest.prototype to capture Bearer tokens from
 * outgoing API calls to graph.microsoft.com and outlook.office.com. Stores the
 * captured token in window.__opentabs_auth so plugin adapters (injected later) can
 * read it without re-scanning an encrypted MSAL localStorage cache.
 *
 * This runs as a static content script because chrome.scripting.executeScript
 * (used for dynamic adapter injection) only runs after the page has loaded —
 * too late to intercept the initial authenticated requests.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export {};

declare global {
  interface Window {
    __opentabs_auth?: { token: string; apiBase: string };
    __opentabs_captured_urls?: string[];
  }
}

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const OUTLOOK_CLOUD_BASE = 'https://outlook.cloud.microsoft/ows/v1.0';
const OUTLOOK_REST_BASE = 'https://outlook.office.com/api/v2.0';

const decodeJwt = (token: string): Record<string, unknown> => {
  try {
    const part = token.split('.')[1] ?? '';
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch { return {}; }
};

const jwtScopes = (token: string): string => {
  const p = decodeJwt(token);
  return ((p['scp'] ?? p['scope'] ?? '') as string);
};

const jwtAud = (token: string): string => {
  const p = decodeJwt(token);
  return ((p['aud'] ?? '') as string);
};

const MAIL_SCOPES = ['mail.read', 'mail.readwrite', 'mail.send'];
const NOTES_SCOPES = ['notes.read', 'notes.create', 'notes.readwrite'];
const hasMailScope = (scp: string): boolean => {
  const lower = scp.toLowerCase();
  return MAIL_SCOPES.some(s => lower.includes(s));
};
const hasNotesScope = (scp: string): boolean => {
  const lower = scp.toLowerCase();
  return NOTES_SCOPES.some(s => lower.includes(s));
};

// Per-plugin auth slots — keyed by plugin name so Outlook and OneNote
// running in separate tabs each get their own window.__opentabs_auth.
// The interceptor detects the current host to know which plugin is active.
const isOneNotePage = (): boolean =>
  typeof location !== 'undefined' && (
    location.hostname.includes('onenote.cloud.microsoft') ||
    location.hostname.includes('onenote.com')
  );

const capture = (url: string, authHeader: string): void => {
  if (!authHeader.startsWith('Bearer ')) return;
  const isGraph = url.includes('graph.microsoft.com');
  const isOutlookCloud = url.includes('outlook.cloud.microsoft') || url.startsWith('/owa/');
  const isOutlookOffice = url.includes('outlook.office.com');

  if ((isGraph || isOutlookCloud || isOutlookOffice) && !window.__opentabs_auth) {
    const token = authHeader.slice(7);
    const scopes = jwtScopes(token);
    const onOneNote = isOneNotePage();

    if (isGraph && onOneNote && hasNotesScope(scopes)) {
      // On a OneNote page: capture Graph token with Notes scope
      window.__opentabs_auth = { token, apiBase: GRAPH_API_BASE };
    } else if (isGraph && !onOneNote && !hasMailScope(scopes)) {
      // On an Outlook page: skip Graph tokens without mail scopes
    } else if (!isGraph) {
      // Outlook REST/OWS token — use aud to determine correct base
      const aud = jwtAud(token);
      const apiBase = aud.includes('outlook.office.com') ? OUTLOOK_REST_BASE : OUTLOOK_CLOUD_BASE;
      window.__opentabs_auth = { token, apiBase };
    } else if (!onOneNote) {
      // Graph token with mail scope on Outlook page
      window.__opentabs_auth = { token, apiBase: GRAPH_API_BASE };
    }
  }

  // Also log ALL bearer-token URLs so the adapter can see what Outlook actually calls
  if (!window.__opentabs_captured_urls) window.__opentabs_captured_urls = [];
  if ((window.__opentabs_captured_urls as string[]).length < 20) {
    (window.__opentabs_captured_urls as string[]).push(url);
  }
};

// Patch window.fetch — runs before page scripts so Outlook cannot capture the original first
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  try {
    const url = input instanceof Request ? input.url : String(input);
    const hdrs = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    let auth: string | null = null;
    if (hdrs instanceof Headers) auth = hdrs.get('Authorization');
    else if (hdrs && typeof hdrs === 'object') auth = (hdrs as Record<string, string>)['Authorization'] ?? null;
    if (auth) capture(url, auth);
  } catch { /* never block real fetch */ }
  return originalFetch(input, init);
};

// Patch XMLHttpRequest prototype — shared by ALL instances regardless of when the
// constructor reference was captured, so this intercepts even cached XHR references.
const proto = XMLHttpRequest.prototype;
const origOpen = proto.open;
const origSetHeader = proto.setRequestHeader;

proto.open = function (this: XMLHttpRequest & { _otUrl?: string }, method: string, url: string, ...rest: unknown[]) {
  this._otUrl = url;
  return (origOpen as Function).apply(this, [method, url, ...rest]);
};

proto.setRequestHeader = function (this: XMLHttpRequest & { _otUrl?: string }, name: string, value: string) {
  try {
    if (name.toLowerCase() === 'authorization' && this._otUrl) capture(this._otUrl, value);
  } catch { /* ignore */ }
  return origSetHeader.call(this, name, value);
};
