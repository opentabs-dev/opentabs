import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../jira-api.js';

export const addWatcher = defineTool({
  name: 'add_watcher',
  displayName: 'Add Watcher',
  description: 'Add a user as a watcher on a Jira issue. The user will receive notifications for issue updates.',
  summary: 'Add a watcher to an issue',
  icon: 'eye',
  group: 'Issues',
  input: z.object({
    issue_key: z.string().describe('Issue key (e.g. "KAN-1") or issue ID'),
    account_id: z.string().describe('Account ID of the user to add as watcher (use search_users to find IDs)'),
  }),
  output: z.object({}),
  handle: async params => {
    await api<Record<string, never>>(`/issue/${encodeURIComponent(params.issue_key)}/watchers`, {
      method: 'POST',
      rawBody: JSON.stringify(params.account_id),
    });
    return {};
  },
});
