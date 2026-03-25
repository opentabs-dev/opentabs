import { ToolError, getPageGlobal, waitUntil, getAuthCache, setAuthCache } from '@opentabs-dev/plugin-sdk';

// React Router Data Router interface
interface RouterState {
  location: { pathname: string; search: string };
  loaderData: Record<string, Record<string, unknown> | undefined>;
  navigation: { state: string };
  errors: Record<string, { status?: number; statusText?: string }> | null;
}

interface DataRouter {
  state: RouterState;
  navigate: (path: string) => Promise<void>;
}

const getRouter = (): DataRouter | null => getPageGlobal('__reactRouterDataRouter') as DataRouter | null;

// --- Auth ---

interface GlamaAuth {
  authenticated: boolean;
}

const getAuth = (): GlamaAuth | null => {
  const cached = getAuthCache<GlamaAuth>('glama');
  if (cached) return cached;

  const router = getRouter();
  if (!router) return null;

  const rootData = router.state.loaderData.root;
  if (!rootData) return null;

  const visitor = rootData.visitor as
    | {
        visitorSession?: {
          attributes?: string[];
        };
      }
    | undefined;

  const attrs = visitor?.visitorSession?.attributes ?? [];
  if (!attrs.includes('authenticated')) return null;

  const auth: GlamaAuth = { authenticated: true };
  setAuthCache('glama', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), {
      interval: 500,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
};

// --- Data Loading via React Router ---

const waitForNavigation = async (router: DataRouter): Promise<void> => {
  await waitUntil(() => router.state.navigation.state === 'idle', {
    interval: 100,
    timeout: 10000,
  });
};

const checkRouterErrors = (router: DataRouter): void => {
  const errors = router.state.errors;
  if (!errors) return;

  for (const err of Object.values(errors)) {
    if (err?.status === 404) {
      throw ToolError.notFound('The requested resource was not found on Glama.');
    }
    if (err?.status === 401 || err?.status === 403) {
      throw ToolError.auth('Not authenticated — please log in to Glama.');
    }
    if (err?.status && err.status >= 400) {
      throw ToolError.internal(`Glama returned an error: ${err.status} ${err.statusText ?? ''}`);
    }
  }
};

export const navigateAndLoad = async <T>(
  path: string,
  routeKey: string,
  options?: { requireAuth?: boolean },
): Promise<T> => {
  const router = getRouter();
  if (!router) throw ToolError.internal('React Router not available');

  if (options?.requireAuth && !isAuthenticated()) {
    throw ToolError.auth('Not authenticated — please log in to Glama.');
  }

  await router.navigate(path);
  await waitForNavigation(router);

  checkRouterErrors(router);

  const data = router.state.loaderData[routeKey];
  if (!data) {
    throw ToolError.internal(`No data loaded for route: ${routeKey}`);
  }

  return data as T;
};

export const getCurrentRouteData = <T>(routeKey: string): T | null => {
  const router = getRouter();
  if (!router) return null;

  return (router.state.loaderData[routeKey] as T) ?? null;
};
