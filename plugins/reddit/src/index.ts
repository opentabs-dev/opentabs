import { clearSessionCache, isAuthenticated, waitForAuth } from './reddit-api.js';
import { deleteThing } from './tools/delete-thing.js';
import { editText } from './tools/edit-text.js';
import { getCommentThread } from './tools/get-comment-thread.js';
import { getMe } from './tools/get-me.js';
import { getPost } from './tools/get-post.js';
import { getSubreddit } from './tools/get-subreddit.js';
import { listFlairs } from './tools/list-flairs.js';
import { getUser } from './tools/get-user.js';
import { hide } from './tools/hide.js';
import { listPopularSubreddits } from './tools/list-popular-subreddits.js';
import { listPosts } from './tools/list-posts.js';
import { listSubscriptions } from './tools/list-subscriptions.js';
import { listUserContent } from './tools/list-user-content.js';
import { readInbox } from './tools/read-inbox.js';
import { report } from './tools/report.js';
import { save } from './tools/save.js';
import { searchPosts } from './tools/search-posts.js';
import { searchSubreddits } from './tools/search-subreddits.js';
import { sendMessage } from './tools/send-message.js';
import { submitComment } from './tools/submit-comment.js';
import { submitPost } from './tools/submit-post.js';
import { subscribe } from './tools/subscribe.js';
import { vote } from './tools/vote.js';
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';

class RedditPlugin extends OpenTabsPlugin {
  readonly name = 'reddit';
  readonly description = 'OpenTabs plugin for Reddit';
  override readonly displayName = 'Reddit';
  readonly urlPatterns = ['*://www.reddit.com/*', '*://old.reddit.com/*', '*://new.reddit.com/*'];
  override readonly homepage = 'https://www.reddit.com';
  readonly tools: ToolDefinition[] = [
    getMe,
    listPosts,
    getPost,
    searchPosts,
    submitPost,
    submitComment,
    getCommentThread,
    editText,
    deleteThing,
    vote,
    save,
    hide,
    report,
    listUserContent,
    getSubreddit,
    listFlairs,
    searchSubreddits,
    listSubscriptions,
    listPopularSubreddits,
    subscribe,
    getUser,
    sendMessage,
    readInbox,
  ];

  /**
   * Check if the Reddit session is authenticated. The new Reddit SPA
   * hydrates asynchronously, so the `user-logged-in` attribute on
   * `<shreddit-app>` may not be set on first check. Retries briefly
   * at 500ms intervals for up to 3 seconds.
   */
  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }

  override teardown(): void {
    clearSessionCache();
  }
}

export default new RedditPlugin();
