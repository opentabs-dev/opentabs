import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { gql } from '../twitch-api.js';
import { streamSchema, mapStream } from './schemas.js';
import type { RawStream } from './schemas.js';

const channelResultSchema = z.object({
  id: z.string().describe('Channel user ID'),
  login: z.string().describe('Channel login name'),
  displayName: z.string().describe('Channel display name'),
  profileImageURL: z.string().describe('Profile image URL'),
  followerCount: z.number().describe('Total number of followers'),
  isLive: z.boolean().describe('Whether the channel is currently live'),
  stream: streamSchema.nullable().describe('Current stream info if live, null otherwise'),
});

export const searchChannels = defineTool({
  name: 'search_channels',
  displayName: 'Search Channels',
  description:
    'Search for Twitch channels by keyword. Returns matching channels with their live status, follower count, and current stream info if live.',
  summary: 'Search for Twitch channels',
  icon: 'search',
  group: 'Search',
  input: z.object({
    query: z.string().describe('Search query text'),
  }),
  output: z.object({ channels: z.array(channelResultSchema) }),
  handle: async params => {
    interface RawChannelItem {
      id?: string;
      login?: string;
      displayName?: string;
      profileImageURL?: string;
      followers?: { totalCount?: number };
      stream?: RawStream | null;
    }
    const data = await gql<{
      searchFor: {
        channels: { items: RawChannelItem[] };
      };
    }>(`{
      searchFor(userQuery: "${params.query.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", platform: "web", options: { targets: [{ index: CHANNEL }] }) {
        channels {
          items {
            id login displayName
            profileImageURL(width: 70)
            followers { totalCount }
            stream {
              id title viewersCount type createdAt
              broadcaster { id login displayName profileImageURL(width: 70) }
              game { id name }
            }
          }
        }
      }
    }`);
    const items = data.searchFor?.channels?.items ?? [];
    return {
      channels: items.map(c => ({
        id: c.id ?? '',
        login: c.login ?? '',
        displayName: c.displayName ?? '',
        profileImageURL: c.profileImageURL ?? '',
        followerCount: c.followers?.totalCount ?? 0,
        isLive: !!c.stream,
        stream: c.stream ? mapStream(c.stream) : null,
      })),
    };
  },
});
