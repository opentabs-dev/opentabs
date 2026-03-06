import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapUser, userSchema } from './schemas.js';

export const listMembers = defineTool({
  name: 'list_members',
  displayName: 'List Members',
  description: 'List members in a Discord guild (server)',
  summary: 'List members in a server',
  icon: 'users',
  group: 'Users',
  input: z.object({
    guild_id: z.string().min(1).describe('Guild (server) ID to list members for'),
    limit: z.number().int().min(1).max(1000).optional().describe('Max members to return (default 100, max 1000)'),
    after: z.string().optional().describe('Get members after this user ID (for pagination)'),
  }),
  output: z.object({
    members: z
      .array(
        z.object({
          user: userSchema.describe('Member user info'),
          nick: z.string().nullable().describe('Server nickname'),
          roles: z.array(z.string()).describe('List of role IDs'),
          joined_at: z.string().describe('When the member joined the guild'),
        }),
      )
      .describe('List of guild members'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 100,
    };
    if (params.after) query.after = params.after;

    const data = await discordApi<Record<string, unknown>>(`/guilds/${params.guild_id}/members`, { query });

    interface RawMember {
      user?: Record<string, unknown>;
      nick?: string | null;
      roles?: string[];
      joined_at?: string;
    }

    const members = Array.isArray(data)
      ? (data as RawMember[]).map(m => ({
          user: mapUser(m.user),
          nick: m.nick ?? null,
          roles: m.roles ?? [],
          joined_at: m.joined_at ?? '',
        }))
      : [];
    return { members };
  },
});
