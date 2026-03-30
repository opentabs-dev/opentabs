import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForNetflixAuth } from './netflix-api.js';
import { addToMyList } from './tools/add-to-my-list.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getSeasons } from './tools/get-seasons.js';
import { getTitleDetails } from './tools/get-title-details.js';
import { getTitle } from './tools/get-title.js';
import { getWatchHistory } from './tools/get-watch-history.js';
import { listContinueWatching } from './tools/list-continue-watching.js';
import { listGenreTitles } from './tools/list-genre-titles.js';
import { listMyList } from './tools/list-my-list.js';
import { listProfiles } from './tools/list-profiles.js';
import { listTop10 } from './tools/list-top-10.js';
import { listTrending } from './tools/list-trending.js';
import { navigateToGenre } from './tools/navigate-to-genre.js';
import { navigateToTitle } from './tools/navigate-to-title.js';
import { playTitle } from './tools/play-title.js';
import { rateTitle } from './tools/rate-title.js';
import { removeFromMyList } from './tools/remove-from-my-list.js';
import { searchTitles } from './tools/search-titles.js';

class NetflixPlugin extends OpenTabsPlugin {
  readonly name = 'netflix';
  readonly description = 'OpenTabs plugin for Netflix';
  override readonly displayName = 'Netflix';
  readonly urlPatterns = ['*://*.netflix.com/*'];
  override readonly homepage = 'https://www.netflix.com/browse';
  readonly tools: ToolDefinition[] = [
    getCurrentUser,
    searchTitles,
    getTitle,
    getTitleDetails,
    getSeasons,
    listMyList,
    addToMyList,
    removeFromMyList,
    listContinueWatching,
    getWatchHistory,
    listTrending,
    listTop10,
    listGenreTitles,
    rateTitle,
    listProfiles,
    navigateToTitle,
    navigateToGenre,
    playTitle,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForNetflixAuth();
  }
}

export default new NetflixPlugin();
