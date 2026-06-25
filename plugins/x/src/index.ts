import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './x-api.js';

// Timelines
import { getHomeTimeline } from './tools/get-home-timeline.js';
import { getLatestTimeline } from './tools/get-latest-timeline.js';
import { getUserTweets } from './tools/get-user-tweets.js';

// Tweets
import { getTweet } from './tools/get-tweet.js';
import { createTweet } from './tools/create-tweet.js';
import { quoteTweet } from './tools/quote-tweet.js';
import { deleteTweet } from './tools/delete-tweet.js';
import { getTweetReplies } from './tools/get-tweet-replies.js';
import { pinTweet } from './tools/pin-tweet.js';

// Users
import { getUserProfile } from './tools/get-user-profile.js';
import { getUserById } from './tools/get-user-by-id.js';
import { getFollowing } from './tools/get-following.js';
import { getUserLikes } from './tools/get-user-likes.js';

// Engagement
import { likeTweet } from './tools/like-tweet.js';
import { unlikeTweet } from './tools/unlike-tweet.js';
import { retweet } from './tools/retweet.js';
import { unretweet } from './tools/unretweet.js';
import { bookmarkTweet } from './tools/bookmark-tweet.js';
import { removeBookmark } from './tools/remove-bookmark.js';
import { getLikers } from './tools/get-likers.js';
import { getRetweeters } from './tools/get-retweeters.js';

// Bookmarks & Explore
import { getBookmarks } from './tools/get-bookmarks.js';
import { getTrending } from './tools/get-trending.js';
import { searchTweets } from './tools/search-tweets.js';

// Lists
import { getList } from './tools/get-list.js';
import { createList } from './tools/create-list.js';
import { updateList } from './tools/update-list.js';
import { deleteList } from './tools/delete-list.js';
import { getListTweets } from './tools/get-list-tweets.js';
import { addListMember } from './tools/add-list-member.js';
import { removeListMember } from './tools/remove-list-member.js';

class XPlugin extends OpenTabsPlugin {
  readonly name = 'x';
  readonly description =
    'OpenTabs plugin for X (Twitter) — read timelines, post tweets, search, manage lists, and more.';
  override readonly displayName = 'X';
  readonly urlPatterns = ['*://*.x.com/*'];
  override readonly homepage = 'https://x.com';

  readonly tools: ToolDefinition[] = [
    // Timelines
    getHomeTimeline,
    getLatestTimeline,
    getUserTweets,
    // Tweets
    getTweet,
    createTweet,
    quoteTweet,
    deleteTweet,
    getTweetReplies,
    pinTweet,
    // Users
    getUserProfile,
    getUserById,
    getFollowing,
    getUserLikes,
    // Engagement
    likeTweet,
    unlikeTweet,
    retweet,
    unretweet,
    bookmarkTweet,
    removeBookmark,
    getLikers,
    getRetweeters,
    // Bookmarks & Explore
    getBookmarks,
    getTrending,
    searchTweets,
    // Lists
    getList,
    createList,
    updateList,
    deleteList,
    getListTweets,
    addListMember,
    removeListMember,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new XPlugin();
