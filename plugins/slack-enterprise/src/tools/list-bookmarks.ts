import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';
import { bookmarkSchema, mapBookmark } from './schemas.js';

export const listBookmarks = defineTool({
  name: 'list_bookmarks',
  displayName: 'List Bookmarks',
  description:
    'List all bookmarks (pinned links) in a Slack channel. Bookmarks appear at the top of the channel and link to external resources like dashboards, runbooks, and documents.',
  summary: 'List channel bookmarks',
  icon: 'bookmark',
  group: 'Bookmarks',
  input: z.object({
    channel: z.string().describe('Channel ID to list bookmarks for (e.g., C1234567890)'),
  }),
  output: z.object({
    bookmarks: z.array(bookmarkSchema),
  }),
  handle: async params => {
    const data = await slackApi<{
      bookmarks: Array<Record<string, unknown>>;
    }>('bookmarks.list', { channel_id: params.channel });

    return {
      bookmarks: (data.bookmarks ?? []).map(mapBookmark),
    };
  },
});
