import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';

export const getGuildInfo = defineTool({
  name: 'get_guild_info',
  displayName: 'Get Guild Info',
  description:
    'Get detailed information about a Discord guild (server) including description, member count, features, and boost status.',
  summary: 'Get detailed info about a server',
  icon: 'shield',
  group: 'Servers',
  input: z.object({
    guild_id: z.string().min(1).describe('Guild (server) ID to get information for'),
  }),
  output: z.object({
    guild: z.object({
      id: z.string().describe('Guild ID'),
      name: z.string().describe('Guild name'),
      description: z.string().nullable().describe('Guild description'),
      icon: z.string().nullable().describe('Icon hash'),
      owner_id: z.string().describe('User ID of the guild owner'),
      member_count: z.number().describe('Approximate member count'),
      features: z.array(z.string()).describe('Enabled guild features'),
      premium_tier: z.number().describe('Server boost level (0-3)'),
      premium_subscription_count: z.number().describe('Number of active boosts'),
      verification_level: z.number().describe('Verification level (0-4)'),
    }),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(`/guilds/${params.guild_id}`, {
      query: { with_counts: true },
    });
    return {
      guild: {
        id: (data.id as string | undefined) ?? '',
        name: (data.name as string | undefined) ?? '',
        description: (data.description as string | null | undefined) ?? null,
        icon: (data.icon as string | null | undefined) ?? null,
        owner_id: (data.owner_id as string | undefined) ?? '',
        member_count: (data.approximate_member_count as number | undefined) ?? 0,
        features: Array.isArray(data.features) ? (data.features as string[]) : [],
        premium_tier: (data.premium_tier as number | undefined) ?? 0,
        premium_subscription_count: (data.premium_subscription_count as number | undefined) ?? 0,
        verification_level: (data.verification_level as number | undefined) ?? 0,
      },
    };
  },
});
