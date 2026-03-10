import { ToolError, fetchFromPage, getCurrentUrl, getPageGlobal, waitUntil } from '@opentabs-dev/plugin-sdk';

// --- Auth detection ---
// Google Maps uses HttpOnly session cookies for API calls.
// Maps works for both anonymous and logged-in users.
// Auth detection verifies the Maps page is loaded and functional.

export const isAuthenticated = (): boolean => {
  const url = getCurrentUrl();
  return url.includes('google.com/maps');
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

// --- Maps search API ---

export const searchPlaces = async (
  query: string,
  lat: number,
  lng: number,
  radius: number,
  maxResults: number,
): Promise<string> => {
  const params = new URLSearchParams({
    tbm: 'map',
    authuser: '0',
    hl: 'en',
    gl: 'us',
    q: query,
  });

  const pb = `!4m8!1m3!1d${radius}!2d${lng}!3d${lat}!3m2!1i1024!2i768!4f13.1!7i${maxResults}`;
  params.set('pb', pb);

  const response = await fetchFromPage(`/search?${params.toString()}`);
  const text = await response.text();
  return text.replace(/^\)\]\}'\n/, '');
};

// --- Page state extraction ---

export const getMapCenter = (): { lat: number; lng: number; zoom: number } | null => {
  const url = getCurrentUrl();
  const match = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)z/);
  if (match?.[1] && match[2] && match[3]) {
    return {
      lat: Number.parseFloat(match[1]),
      lng: Number.parseFloat(match[2]),
      zoom: Number.parseFloat(match[3]),
    };
  }

  const initState = getPageGlobal('APP_INITIALIZATION_STATE') as unknown[] | undefined;
  if (initState?.[0] && Array.isArray(initState[0])) {
    const viewport = initState[0] as (number[] | null)[];
    const coords = viewport[0];
    if (coords && coords.length >= 3 && typeof coords[2] === 'number' && typeof coords[1] === 'number') {
      return { lat: coords[2], lng: coords[1], zoom: 15 };
    }
  }

  return null;
};

export const getSearchQuery = (): string | null => {
  const url = getCurrentUrl();
  const searchMatch = url.match(/\/maps\/search\/([^/@]+)/);
  if (searchMatch?.[1]) return decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));

  const placeMatch = url.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch?.[1]) return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));

  return null;
};

export const getDirectionsFromUrl = (): {
  origin: string;
  destination: string;
  travelMode: string;
} | null => {
  const url = getCurrentUrl();
  const dirMatch = url.match(/\/maps\/dir\/([^/]+)\/([^/@]+)/);
  if (!dirMatch?.[1] || !dirMatch[2]) return null;

  let travelMode = 'driving';
  if (url.includes('!3e1')) travelMode = 'transit';
  else if (url.includes('!3e2')) travelMode = 'walking';
  else if (url.includes('!3e3')) travelMode = 'bicycling';

  return {
    origin: decodeURIComponent(dirMatch[1].replace(/\+/g, ' ')),
    destination: decodeURIComponent(dirMatch[2].replace(/\+/g, ' ')),
    travelMode,
  };
};

// --- Fetch HTML page and extract embedded data ---

export const fetchPageData = async (path: string): Promise<{ state: unknown[]; html: string }> => {
  const resp = await fetchFromPage(path, {
    headers: { Accept: 'text/html' },
  });
  const html = await resp.text();

  const stateMatch = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[[\s\S]*?\]);\s*(?:window|var|<\/script>)/);
  if (!stateMatch?.[1]) {
    throw ToolError.internal('Failed to extract Maps page data');
  }

  const state = JSON.parse(stateMatch[1]) as unknown[];
  return { state, html };
};

// --- Extract embedded JSON from APP_INITIALIZATION_STATE ---

export const extractEmbeddedData = (state: unknown[]): unknown[] | null => {
  const stateArr = state as (unknown[] | null)[];
  const innerContainer = stateArr[3];
  if (!Array.isArray(innerContainer)) return null;

  for (let i = 0; i < innerContainer.length; i++) {
    const entry = innerContainer[i];
    if (typeof entry === 'string' && entry.length > 100) {
      const cleaned = entry.replace(/^\)\]\}'\n/, '');
      try {
        return JSON.parse(cleaned) as unknown[];
      } catch {
        // Malformed JSON — skip and try the next entry
      }
    }
  }
  return null;
};

// --- URL builders ---

export const buildSearchUrl = (query: string, lat?: number, lng?: number, zoom?: number): string => {
  const encodedQuery = encodeURIComponent(query);
  if (lat !== undefined && lng !== undefined) {
    const z = zoom ?? 15;
    return `/maps/search/${encodedQuery}/@${lat},${lng},${z}z`;
  }
  return `/maps/search/${encodedQuery}`;
};

export const buildDirectionsUrl = (origin: string, destination: string, travelMode: string): string => {
  const encodedOrigin = encodeURIComponent(origin);
  const encodedDest = encodeURIComponent(destination);

  const modeMap: Record<string, string> = {
    driving: '0',
    transit: '1',
    walking: '2',
    bicycling: '3',
  };
  const modeCode = modeMap[travelMode] ?? '0';

  return `/maps/dir/${encodedOrigin}/${encodedDest}/data=!4m2!4m1!3e${modeCode}`;
};

export const buildPlaceUrl = (query: string): string => {
  return `/maps/place/${encodeURIComponent(query)}`;
};

export const buildLocationUrl = (lat: number, lng: number, zoom: number): string => {
  return `/maps/@${lat},${lng},${zoom}z`;
};
