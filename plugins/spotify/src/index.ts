import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, resetInterceptor, waitForAuth } from './spotify-api.js';

// GraphQL-backed tools (internal API, no rate limits)
import { getCurrentUser } from './tools/get-current-user.js';
import { search } from './tools/search.js';
import { getArtist } from './tools/get-artist.js';
import { getAlbum } from './tools/get-album.js';
import { getPlaylist } from './tools/get-playlist.js';
import { getSavedTracks } from './tools/get-saved-tracks.js';

// Public API tools (playback control — separate rate limit pool)
import { getPlaybackState } from './tools/get-playback-state.js';
import { getCurrentlyPlaying } from './tools/get-currently-playing.js';
import { startPlayback } from './tools/start-playback.js';
import { pausePlayback } from './tools/pause-playback.js';
import { skipToNext } from './tools/skip-to-next.js';
import { skipToPrevious } from './tools/skip-to-previous.js';
import { seekToPosition } from './tools/seek-to-position.js';
import { setVolume } from './tools/set-volume.js';
import { setRepeatMode } from './tools/set-repeat-mode.js';
import { toggleShuffle } from './tools/toggle-shuffle.js';
import { getAvailableDevices } from './tools/get-available-devices.js';
import { transferPlayback } from './tools/transfer-playback.js';
import { addToQueue } from './tools/add-to-queue.js';
import { getQueue } from './tools/get-queue.js';
import { getRecentlyPlayed } from './tools/get-recently-played.js';

class SpotifyPlugin extends OpenTabsPlugin {
  readonly name = 'spotify';
  readonly description = 'OpenTabs plugin for Spotify';
  override readonly displayName = 'Spotify';
  readonly urlPatterns = ['*://open.spotify.com/*'];
  override readonly homepage = 'https://open.spotify.com';
  readonly tools: ToolDefinition[] = [
    // Data (GraphQL internal API)
    getCurrentUser,
    search,
    getArtist,
    getAlbum,
    getPlaylist,
    getSavedTracks,
    // Playback control (public API)
    getPlaybackState,
    getCurrentlyPlaying,
    startPlayback,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    seekToPosition,
    setVolume,
    setRepeatMode,
    toggleShuffle,
    getAvailableDevices,
    transferPlayback,
    addToQueue,
    getQueue,
    getRecentlyPlayed,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }

  override teardown(): void {
    resetInterceptor();
  }
}

export default new SpotifyPlugin();
