import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const removeBookmark = defineTool({
  name: 'remove_bookmark',
  displayName: 'Remove Bookmark',
  description: 'Remove a bookmark from a Slack channel. Use list_bookmarks to find bookmark IDs.',
  summary: 'Remove a channel bookmark',
  icon: 'bookmark-minus',
  group: 'Bookmarks',
  input: z.object({
    channel: z.string().describe('Channel ID the bookmark belongs to (e.g., C1234567890)'),
    bookmark_id: z.string().describe('Bookmark ID to remove (from list_bookmarks)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async params => {
    await slackApi('bookmarks.remove', {
      channel_id: params.channel,
      bookmark_id: params.bookmark_id,
    });

    return { success: true };
  },
});
