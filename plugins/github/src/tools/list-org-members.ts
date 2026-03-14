import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated } from '../github-api.js';

export const listOrgMembers = defineTool({
  name: 'list_org_members',
  displayName: 'List Organization Members',
  description: 'List members of a GitHub organization.',
  summary: 'List members of an organization',
  icon: 'users',
  group: 'Users',
  input: z.object({
    org: z.string().min(1).describe('Organization name'),
  }),
  output: z.object({
    members: z
      .array(
        z.object({
          login: z.string().describe('Username'),
          avatar_url: z.string().describe('Avatar URL'),
          html_url: z.string().describe('Profile URL'),
        }),
      )
      .describe('List of organization members'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    const html = await fetchText(`/orgs/${params.org}/people`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const memberEls = doc.querySelectorAll('.member-list-item, [data-bulk-actions-id]');
    const members = [];

    for (const el of memberEls) {
      const linkEl = el.querySelector('a[data-hovercard-type="user"]');
      const imgEl = el.querySelector('img.avatar');
      const login = linkEl?.textContent?.trim() ?? '';
      if (!login) continue;

      members.push({
        login,
        avatar_url: imgEl?.getAttribute('src') ?? '',
        html_url: `https://github.com/${login}`,
      });
    }

    return { members };
  },
});
