import { OpenTabsPlugin, waitUntil } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { getItem } from './tools/get-item.js';
import { getUser } from './tools/get-user.js';
import { listTopStories } from './tools/list-top-stories.js';
import { listNewStories } from './tools/list-new-stories.js';
import { listBestStories } from './tools/list-best-stories.js';
import { listAskStories } from './tools/list-ask-stories.js';
import { listShowStories } from './tools/list-show-stories.js';
import { listJobStories } from './tools/list-job-stories.js';
import { getStoryComments } from './tools/get-story-comments.js';
import { submitCommentTool } from './tools/submit-comment.js';

class HackerNewsPlugin extends OpenTabsPlugin {
  readonly name = 'hackernews';
  readonly description = 'OpenTabs plugin for Hacker News';
  override readonly displayName = 'Hacker News';
  readonly urlPatterns = ['*://news.ycombinator.com/*'];
  override readonly homepage = 'https://news.ycombinator.com';
  readonly tools: ToolDefinition[] = [
    getItem,
    getUser,
    listTopStories,
    listNewStories,
    listBestStories,
    listAskStories,
    listShowStories,
    listJobStories,
    getStoryComments,
    submitCommentTool,
  ];

  async isReady(): Promise<boolean> {
    // HN is server-rendered. The plugin is ready once the page has loaded.
    // All tools fetch same-origin HTML pages, so no auth is required.
    try {
      await waitUntil(() => document.readyState === 'complete', {
        interval: 200,
        timeout: 5000,
      });
      return true;
    } catch {
      return document.readyState === 'complete';
    }
  }
}

export default new HackerNewsPlugin();
