import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';
import { bookmarkSchema, mapBookmark } from './schemas.js';

export const addBookmark = defineTool({
  name: 'add_bookmark',
  displayName: 'Add Bookmark',
  description:
    'Add a bookmark (pinned link) to a Slack channel. Bookmarks appear at the top of the channel for quick access to external resources.',
  summary: 'Add a bookmark to a channel',
  icon: 'bookmark-plus',
  group: 'Bookmarks',
  input: z.object({
    channel: z.string().describe('Channel ID to add the bookmark to (e.g., C1234567890)'),
    title: z.string().describe('Bookmark title'),
    link: z.string().describe('URL for the bookmark'),
    emoji: z.string().optional().describe('Emoji to display with the bookmark (e.g., ":books:")'),
  }),
  output: z.object({
    bookmark: bookmarkSchema,
  }),
  handle: async params => {
    const apiParams: Record<string, unknown> = {
      channel_id: params.channel,
      title: params.title,
      type: 'link',
      link: params.link,
    };
    if (params.emoji) apiParams.emoji = params.emoji;

    const data = await slackApi<{
      bookmark: Record<string, unknown>;
    }>('bookmarks.add', apiParams);

    return {
      bookmark: mapBookmark(data.bookmark ?? {}),
    };
  },
});
