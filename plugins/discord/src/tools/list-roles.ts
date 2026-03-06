import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';

const roleSchema = z.object({
  id: z.string().describe('Role ID'),
  name: z.string().describe('Role name'),
  color: z.number().describe('Integer representation of hex color code'),
  position: z.number().describe('Sorting position of the role'),
  permissions: z.string().describe('Permission bit set as a string'),
  managed: z.boolean().describe('Whether the role is managed by an integration'),
  mentionable: z.boolean().describe('Whether the role can be mentioned'),
});

interface DiscordRole {
  id?: string;
  name?: string;
  color?: number;
  position?: number;
  permissions?: string;
  managed?: boolean;
  mentionable?: boolean;
}

const mapRole = (r: Partial<DiscordRole> | undefined): z.infer<typeof roleSchema> => ({
  id: r?.id ?? '',
  name: r?.name ?? '',
  color: r?.color ?? 0,
  position: r?.position ?? 0,
  permissions: r?.permissions ?? '0',
  managed: r?.managed ?? false,
  mentionable: r?.mentionable ?? false,
});

export const listRoles = defineTool({
  name: 'list_roles',
  displayName: 'List Roles',
  description: 'List all roles in a Discord guild (server). Returns roles sorted by position.',
  summary: 'List roles in a server',
  icon: 'tag',
  group: 'Servers',
  input: z.object({
    guild_id: z.string().min(1).describe('Guild (server) ID to list roles for'),
  }),
  output: z.object({
    roles: z.array(roleSchema).describe('List of roles'),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(`/guilds/${params.guild_id}/roles`);
    const roles = Array.isArray(data) ? (data as Record<string, unknown>[]).map(r => mapRole(r as DiscordRole)) : [];
    return { roles };
  },
});
