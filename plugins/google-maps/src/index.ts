import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './maps-api.js';
import { getCurrentView } from './tools/get-current-view.js';
import { getDirectionsInfo } from './tools/get-directions-info.js';
import { getDirectionsUrl } from './tools/get-directions-url.js';
import { getMapUrl } from './tools/get-map-url.js';
import { getPlaceDetails } from './tools/get-place-details.js';
import { getPlaceUrl } from './tools/get-place-url.js';
import { navigateToDirections } from './tools/navigate-to-directions.js';
import { navigateToLocation } from './tools/navigate-to-location.js';
import { navigateToPlace } from './tools/navigate-to-place.js';
import { navigateToSearch } from './tools/navigate-to-search.js';
import { searchNearby } from './tools/search-nearby.js';
import { searchPlacesTool } from './tools/search-places.js';
import { setTravelMode } from './tools/set-travel-mode.js';
import { shareLocation } from './tools/share-location.js';
import { toggleLayer } from './tools/toggle-layer.js';
import { zoomMap } from './tools/zoom-map.js';

class GoogleMapsPlugin extends OpenTabsPlugin {
  readonly name = 'google-maps';
  readonly description = 'OpenTabs plugin for Google Maps';
  override readonly displayName = 'Google Maps';
  readonly urlPatterns = ['*://www.google.com/maps*'];
  override readonly homepage = 'https://www.google.com/maps';
  readonly tools: ToolDefinition[] = [
    // Map state
    getCurrentView,
    zoomMap,
    toggleLayer,
    // Search
    searchPlacesTool,
    searchNearby,
    // Places
    getPlaceDetails,
    // Directions
    navigateToDirections,
    getDirectionsInfo,
    setTravelMode,
    // Navigation
    navigateToLocation,
    navigateToSearch,
    navigateToPlace,
    // Sharing
    shareLocation,
    getMapUrl,
    getPlaceUrl,
    getDirectionsUrl,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new GoogleMapsPlugin();
