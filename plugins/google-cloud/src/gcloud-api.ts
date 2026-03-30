import {
  ToolError,
  getCookie,
  getPageGlobal,
  waitUntil,
  getCurrentUrl,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
} from '@opentabs-dev/plugin-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GapiClient {
  request: (args: {
    path: string;
    method: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
  }) => {
    then: (
      onOk: (r: { status: number; result: unknown }) => void,
      onErr: (e: { status: number; result?: { error?: { code?: number; message?: string; status?: string } } }) => void,
    ) => void;
  };
}

interface GapiRoot {
  client: GapiClient;
}

// ---------------------------------------------------------------------------
// Auth detection
// ---------------------------------------------------------------------------

const getGapi = (): GapiClient | null => {
  const gapi = getPageGlobal('gapi') as GapiRoot | undefined;
  return gapi?.client ?? null;
};

export const isAuthenticated = (): boolean => {
  // gapi.client must be loaded AND user must have a session cookie
  return getGapi() !== null && !!getCookie('SAPISID');
};

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), {
      interval: 500,
      timeout: 8000,
    });
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

interface ProjectContext {
  projectId: string;
}

const getProjectFromUrl = (): string | null => {
  const url = getCurrentUrl();
  const match = url.match(/[?&]project=([^&#]+)/);
  return match?.[1] ?? null;
};

export const getProjectContext = (): ProjectContext | null => {
  const cached = getAuthCache<ProjectContext>('google-cloud');
  const urlProject = getProjectFromUrl();
  if (urlProject) {
    if (!cached || cached.projectId !== urlProject) {
      setAuthCache('google-cloud', { projectId: urlProject });
    }
    return { projectId: urlProject };
  }
  return cached;
};

export const resolveProjectId = (explicit?: string): string => {
  if (explicit) return explicit;
  const ctx = getProjectContext();
  if (ctx?.projectId) return ctx.projectId;
  throw ToolError.validation(
    'No project ID found — provide a project_id parameter or navigate to a project in the console.',
  );
};

// ---------------------------------------------------------------------------
// API caller
// ---------------------------------------------------------------------------

const classifyGapiError = (err: {
  status: number;
  result?: { error?: { code?: number; message?: string; status?: string } };
}): never => {
  const code = err.result?.error?.code ?? err.status;
  const message = err.result?.error?.message ?? `GCP API error (HTTP ${err.status})`;

  switch (code) {
    case 401:
    case 403:
      clearAuthCache('google-cloud');
      throw ToolError.auth(message);
    case 404:
      throw ToolError.notFound(message);
    case 429:
      throw ToolError.rateLimited(message);
    case 400:
      throw ToolError.validation(message);
    case 0:
      throw ToolError.timeout(message);
    default:
      throw ToolError.internal(message);
  }
};

/**
 * Call a GCP REST API via gapi.client.request().
 * Auth (SAPISIDHASH + cookies) is handled automatically by the gapi proxy.
 */
export const gcpApi = async <T>(
  path: string,
  options: {
    method?: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {},
): Promise<T> => {
  const client = getGapi();
  if (!client) throw ToolError.auth('Not authenticated — please log in to Google Cloud Console.');

  const method = options.method ?? 'GET';

  // Filter out undefined params
  const params: Record<string, string | number | boolean> = {};
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined) params[k] = v;
    }
  }

  const result = await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject({ status: 0, result: { error: { code: 0, message: 'Request timed out after 25 seconds' } } }),
      25000,
    );
    client
      .request({
        path,
        method,
        params: Object.keys(params).length > 0 ? params : undefined,
        body: options.body,
      })
      .then(
        response => {
          clearTimeout(timeout);
          resolve(response.result as T);
        },
        err => {
          clearTimeout(timeout);
          reject(err);
        },
      );
  }).catch(err => classifyGapiError(err));

  return result;
};
