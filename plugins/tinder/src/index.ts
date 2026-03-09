import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './tinder-api.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getFastMatchCount } from './tools/get-fast-match-count.js';
import { getFastMatchPreview } from './tools/get-fast-match-preview.js';
import { getMetadata } from './tools/get-metadata.js';
import { getRecommendations } from './tools/get-recommendations.js';
import { getUpdates } from './tools/get-updates.js';
import { getUser } from './tools/get-user.js';
import { likeMessage } from './tools/like-message.js';
import { likeUser } from './tools/like-user.js';
import { listMatches } from './tools/list-matches.js';
import { passUser } from './tools/pass-user.js';
import { sendMessage } from './tools/send-message.js';
import { superLikeUser } from './tools/super-like-user.js';
import { unmatch } from './tools/unmatch.js';
import { updateLocation } from './tools/update-location.js';
import { updateProfile } from './tools/update-profile.js';

class TinderPlugin extends OpenTabsPlugin {
  readonly name = 'tinder';
  readonly description = 'OpenTabs plugin for Tinder';
  override readonly displayName = 'Tinder';
  readonly urlPatterns = ['*://*.tinder.com/*'];
  override readonly homepage = 'https://tinder.com';

  readonly tools: ToolDefinition[] = [
    getCurrentUser,
    updateProfile,
    getRecommendations,
    likeUser,
    passUser,
    superLikeUser,
    listMatches,
    unmatch,
    sendMessage,
    likeMessage,
    getUser,
    getMetadata,
    getUpdates,
    updateLocation,
    getFastMatchCount,
    getFastMatchPreview,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new TinderPlugin();
