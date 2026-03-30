import {
  ToolError,
  getCookie,
  getMetaContent,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
  log,
} from '@opentabs-dev/plugin-sdk';

// --- Types ---

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

interface AwsSessionInfo {
  accountId: string;
  displayName: string;
  sessionARN: string;
  infrastructureRegion: string;
}

// --- Credential Interception ---

/** Active MutationObserver for iframe discovery — disconnected after credentials are captured. */
let iframeObserver: MutationObserver | null = null;

/** Disconnect the iframe MutationObserver if still active. */
export const disconnectCredentialObserver = (): void => {
  if (iframeObserver) {
    iframeObserver.disconnect();
    iframeObserver = null;
    log.debug('Disconnected credential interception MutationObserver');
  }
};

/**
 * Install credential interception hooks on service iframes.
 *
 * The AWS Console loads each service (EC2, Lambda, etc.) in a same-origin iframe.
 * Each iframe's Janus SDK exchanges the console session cookies for temporary STS
 * credentials via an HTTP request whose JSON response contains the full credential
 * set (accessKeyId, secretAccessKey, sessionToken, expiration).
 *
 * We patch Response.prototype.json in every same-origin iframe — both existing ones
 * and new ones discovered via MutationObserver — to capture the credential exchange
 * response. Captured credentials are persisted via the SDK auth cache so they survive
 * adapter re-injection.
 *
 * Because the adapter runs at document_idle (after page scripts), we cannot intercept
 * the initial credential exchange on the first page load. Credentials become available
 * after the user navigates to a second service page or an iframe triggers a credential
 * refresh (credentials expire every ~15 minutes).
 */
const installCredentialInterceptor = (): void => {
  const g = globalThis as Record<string, unknown>;
  if (g.__awsCredInterceptorInstalled) return;
  g.__awsCredInterceptorInstalled = true;

  const patchFrame = (win: Window): void => {
    try {
      const w = win as unknown as { __awsPatched?: boolean; Response: typeof Response };
      if (w.__awsPatched) return;
      w.__awsPatched = true;

      const origJson = w.Response.prototype.json;
      w.Response.prototype.json = async function (this: Response) {
        const result = await origJson.call(this);
        try {
          const c = (result as Record<string, unknown>)?.credentials ?? result;
          if (
            c &&
            typeof c === 'object' &&
            typeof (c as Record<string, unknown>).accessKeyId === 'string' &&
            typeof (c as Record<string, unknown>).secretAccessKey === 'string' &&
            typeof (c as Record<string, unknown>).sessionToken === 'string'
          ) {
            setAuthCache<AwsCredentials>('aws-console', c as AwsCredentials);
            log.debug('Captured AWS credentials from iframe credential exchange');
            disconnectCredentialObserver();
          }
        } catch {
          // Ignore non-credential responses
        }
        return result;
      };
    } catch {
      // Cross-origin iframes throw — ignore
    }
  };

  const patchIframe = (iframe: HTMLIFrameElement): void => {
    // Patch on load (catches iframes that haven't loaded yet)
    iframe.addEventListener('load', () => {
      try {
        if (iframe.contentWindow) patchFrame(iframe.contentWindow);
      } catch {
        // Ignore cross-origin
      }
    });
    // Also patch immediately (catches already-loaded iframes)
    try {
      if (iframe.contentWindow) patchFrame(iframe.contentWindow);
    } catch {
      // Ignore cross-origin
    }
  };

  // Patch all existing iframes
  for (const iframe of document.querySelectorAll('iframe')) {
    patchIframe(iframe);
  }

  // Watch for new iframes added to the DOM
  iframeObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLIFrameElement) {
          patchIframe(node);
        }
        if (node instanceof HTMLElement) {
          for (const f of node.querySelectorAll('iframe')) {
            patchIframe(f);
          }
        }
      }
    }
  });

  if (document.body) {
    iframeObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      iframeObserver?.observe(document.body, { childList: true, subtree: true });
    });
  }
};

// Install at module scope (guard for Node.js build environment)
if (typeof document !== 'undefined') {
  installCredentialInterceptor();
}

// --- Auth Detection ---

const getSessionInfo = (): AwsSessionInfo | null => {
  const raw = getMetaContent('awsc-session-data');
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data.accountId) return null;
    return {
      accountId: String(data.accountId),
      displayName: String(data.displayName ?? ''),
      sessionARN: String(data.sessionARN ?? ''),
      infrastructureRegion: String(data.infrastructureRegion ?? ''),
    };
  } catch {
    return null;
  }
};

const getUserInfo = (): { username: string; arn: string; signinType: string } | null => {
  const raw = getCookie('aws-userInfo');
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const data = JSON.parse(decoded) as Record<string, string>;
    if (!data.arn) return null;
    return { username: data.username ?? '', arn: data.arn ?? '', signinType: data.signinType ?? '' };
  } catch {
    return null;
  }
};

export const isAuthenticated = (): boolean => getUserInfo() !== null || getSessionInfo() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

export const getAccountInfo = (): {
  accountId: string;
  username: string;
  arn: string;
  sessionARN: string;
  region: string;
  signinType: string;
} => {
  const session = getSessionInfo();
  const user = getUserInfo();
  if (!session && !user) {
    throw ToolError.auth('Not authenticated — please log in to the AWS Console.');
  }
  return {
    accountId: session?.accountId ?? '',
    username: user?.username ?? session?.displayName ?? '',
    arn: user?.arn ?? '',
    sessionARN: session?.sessionARN ?? '',
    region: session?.infrastructureRegion ?? '',
    signinType: user?.signinType ?? '',
  };
};

// --- Region and Service Data ---

export const getCurrentRegion = (): string => getMetaContent('awsc-mezz-region') ?? 'us-east-1';

interface MezzRegion {
  id?: string;
  name?: string;
  location?: string;
  optIn?: boolean;
}

export const getRegions = (): MezzRegion[] => {
  const raw = getMetaContent('awsc-mezz-data');
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as { regions?: MezzRegion[] }).regions ?? [];
  } catch {
    return [];
  }
};

// --- SigV4 Signing ---

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
};

const hmacSha256 = async (key: string | Uint8Array, data: string): Promise<Uint8Array> => {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const dataBytes = new TextEncoder().encode(data);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, dataBytes));
};

const sha256Hex = async (data: string): Promise<string> => {
  const bytes = new TextEncoder().encode(data);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const formatDate = (d: Date): { dateStamp: string; amzDate: string } => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const amzDate = `${dateStamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return { dateStamp, amzDate };
};

/**
 * Sign an AWS API request using SigV4 via the Web Crypto API.
 *
 * Supports both query-string APIs (EC2, IAM) and REST APIs (Lambda, CloudWatch Logs).
 * The path may include a query string (e.g., "/2015-03-31/functions?MaxItems=50") which
 * is separated and included in the canonical request per SigV4 spec.
 */
const signRequest = async (
  creds: AwsCredentials,
  method: string,
  host: string,
  path: string,
  body: string,
  region: string,
  service: string,
  headers: Record<string, string>,
): Promise<Record<string, string>> => {
  const { dateStamp, amzDate } = formatDate(new Date());
  const bodyHash = await sha256Hex(body);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const allHeaders: Record<string, string> = {
    host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amzDate,
    'x-amz-security-token': creds.sessionToken,
    ...headers,
  };

  const signedHeaderNames = Object.keys(allHeaders).sort().join(';');
  const canonicalHeaders = Object.keys(allHeaders)
    .sort()
    .map(k => `${k}:${allHeaders[k]}\n`)
    .join('');

  // Separate path and query string for canonical request
  const qsIndex = path.indexOf('?');
  const canonicalPath = qsIndex >= 0 ? path.substring(0, qsIndex) : path;
  const canonicalQueryString = qsIndex >= 0 ? path.substring(qsIndex + 1) : '';

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaderNames,
    bodyHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmacSha256(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  return { ...allHeaders, authorization };
};

// --- Credentials ---

const getCredentials = (): AwsCredentials => {
  const cached = getAuthCache<AwsCredentials>('aws-console');
  if (cached?.accessKeyId && cached.secretAccessKey && cached.sessionToken) {
    if (cached.expiration) {
      const expiresAt = new Date(cached.expiration).getTime();
      if (Date.now() < expiresAt - 60_000) return cached;
      log.debug('AWS credentials expired, clearing cache');
      clearAuthCache('aws-console');
    } else {
      return cached;
    }
  }
  throw ToolError.auth(
    'AWS credentials not yet captured. Navigate to an AWS service page (e.g., EC2, Lambda) and wait a few seconds, then retry. Credentials are captured automatically when a service page loads its iframe.',
  );
};

// --- Error Classification ---

const classifyError = (status: number, body: string, service: string): never => {
  if (status === 401 || status === 403) {
    // Parse the error body to decide whether to clear cached credentials.
    // Real auth failures include an XML/JSON error body; CORS-blocked or permission
    // errors on specific resources should not invalidate the credential cache.
    const isExpiredCreds =
      body.includes('ExpiredToken') || body.includes('RequestExpired') || body.includes('InvalidClientTokenId');
    if (isExpiredCreds) {
      clearAuthCache('aws-console');
    }
    const msgMatch = body.match(/<Message>(.*?)<\/Message>/);
    throw ToolError.auth(msgMatch?.[1] ?? `AWS ${service} authentication failed (${status}).`);
  }
  if (status === 404) {
    throw ToolError.notFound(`AWS ${service} resource not found.`);
  }
  if (status === 429) {
    throw ToolError.rateLimited(`AWS ${service} rate limit exceeded. Try again later.`);
  }
  if (status === 400) {
    const msgMatch = body.match(/<Message>(.*?)<\/Message>/);
    let jsonMsg: string | undefined;
    if (body.startsWith('{')) {
      try {
        jsonMsg = (JSON.parse(body) as { Message?: string }).Message;
      } catch {
        // Malformed JSON body — fall through to generic message
      }
    }
    throw ToolError.validation(msgMatch?.[1] ?? jsonMsg ?? `AWS ${service} bad request (400).`);
  }
  const msgMatch = body.match(/<Message>(.*?)<\/Message>/);
  throw ToolError.internal(msgMatch?.[1] ?? `AWS ${service} error (${status}): ${body.substring(0, 200)}`);
};

// --- XML Parser ---

/**
 * Parse an AWS XML response into a nested object.
 *
 * Uses DOMParser (available in the browser page context). Handles:
 * - Nested elements via recursion
 * - Repeated sibling elements with the same tag name as arrays
 * - AWS list wrapper tags (`<item>`, `<member>`) always treated as arrays
 * - Leaf text nodes returned as strings
 * - XML namespace prefixes stripped (uses localName)
 */
const parseXml = (xml: string): Record<string, unknown> => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const nodeToObject = (node: Element): unknown => {
    const children = Array.from(node.children);
    if (children.length === 0) return node.textContent ?? '';

    const result: Record<string, unknown> = {};
    const seenKeys = new Set<string>();

    for (const child of children) {
      const key = child.localName;
      const value = nodeToObject(child);
      const isListWrapper = key === 'item' || key === 'member';

      if (seenKeys.has(key) || isListWrapper) {
        // Convert to array on second occurrence, or always for list wrappers
        const existing = result[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else if (existing !== undefined) {
          result[key] = [existing, value];
        } else {
          result[key] = [value];
        }
      } else {
        result[key] = value;
      }
      seenKeys.add(key);
    }

    return result;
  };

  return nodeToObject(doc.documentElement) as Record<string, unknown>;
};

// --- AWS API Caller ---

/** Options for a single signed AWS API request. */
interface AwsApiOptions {
  /** Override the region (default: current console region). */
  region?: string;
  /** API version string added to query-string APIs (e.g., "2016-11-15" for EC2). */
  version?: string;
  /** Override the service hostname. */
  host?: string;
  /** HTTP method (default: "POST"). */
  method?: string;
  /**
   * Request path including optional query string. Default: "/".
   * For REST APIs, set this to the resource path (e.g., "/2015-03-31/functions").
   */
  path?: string;
  /** Content type header. Default depends on whether jsonBody is set. */
  contentType?: string;
  /** JSON body for REST/JSON APIs. When set, the body is JSON-serialized. */
  jsonBody?: unknown;
  /** Raw string body. When set, used as-is (takes precedence over query params). */
  rawBody?: string;
  /** Extra headers to include and sign. */
  extraHeaders?: Record<string, string>;
}

/**
 * Make a signed AWS API call.
 *
 * Supports both query-string APIs (EC2, IAM, CloudWatch) and REST APIs (Lambda).
 *
 * @param service - AWS service identifier used for signing and hostname (e.g., "ec2", "lambda")
 * @param action  - API action. For query APIs this becomes the Action parameter. For JSON
 *                  APIs with amz-json content type, this becomes the X-Amz-Target header.
 *                  For REST APIs where the action is encoded in the path, pass an empty string.
 * @param params  - Query parameters for query-string APIs (ignored when jsonBody/rawBody is set)
 * @param options - Additional options (see AwsApiOptions)
 */
export const awsApi = async <T = Record<string, unknown>>(
  service: string,
  action: string,
  params: Record<string, string> = {},
  options: AwsApiOptions = {},
): Promise<T> => {
  const creds = getCredentials();
  const region = options.region ?? getCurrentRegion();
  const method = options.method ?? 'POST';
  const path = options.path ?? '/';

  // Determine host — IAM is a global service with a fixed endpoint
  let host = options.host ?? `${service}.${region}.amazonaws.com`;
  if (service === 'iam') host = 'iam.amazonaws.com';

  // Determine signing region — IAM always signs with us-east-1
  const signingRegion = service === 'iam' ? 'us-east-1' : region;

  // Build request body and headers
  let body: string;
  const headers: Record<string, string> = { ...options.extraHeaders };

  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers['content-type'] = options.contentType ?? 'application/x-www-form-urlencoded';
  } else if (options.jsonBody !== undefined) {
    body = JSON.stringify(options.jsonBody);
    headers['content-type'] = options.contentType ?? 'application/x-amz-json-1.0';
    if (action && options.contentType?.includes('amz-json')) {
      headers['x-amz-target'] = action;
    }
  } else {
    // Query-string API (default)
    const qs = new URLSearchParams(action ? { Action: action, ...params } : params);
    if (options.version) qs.set('Version', options.version);
    body = qs.toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }

  // For GET requests, the body must be empty (query params go in the URL path)
  const fetchBody = method === 'GET' ? undefined : body;
  const signBody = method === 'GET' ? '' : body;

  const signedHeaders = await signRequest(creds, method, host, path, signBody, signingRegion, service, headers);

  let resp: Response;
  try {
    resp = await fetch(`https://${host}${path}`, {
      method,
      headers: signedHeaders,
      body: fetchBody,
    });
  } catch (e) {
    // "Failed to fetch" typically means CORS blocked the request
    const msg = e instanceof Error ? e.message : String(e);
    throw ToolError.internal(
      `AWS ${service} request failed (likely CORS): ${msg}. This endpoint may not allow cross-origin requests from the console.`,
    );
  }

  const respText = await resp.text();
  if (!resp.ok) classifyError(resp.status, respText, service);

  // Parse response based on content type
  const trimmed = respText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed) as T;
  if (trimmed.startsWith('<')) return parseXml(trimmed) as T;
  return trimmed as unknown as T;
};
