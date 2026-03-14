import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated } from '../github-api.js';
import { workflowRunSchema } from './schemas.js';

export const listWorkflowRuns = defineTool({
  name: 'list_workflow_runs',
  displayName: 'List Workflow Runs',
  description: 'List workflow runs for a repository. Returns recent workflow runs from the Actions page.',
  summary: 'List GitHub Actions workflow runs',
  icon: 'play',
  group: 'Actions',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
  }),
  output: z.object({
    workflow_runs: z.array(workflowRunSchema).describe('List of workflow runs'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    const html = await fetchText(`/${params.owner}/${params.repo}/actions`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('.ActionListItem, [data-testid="workflow-run-row"]');
    const runs = [];

    for (const row of rows) {
      const titleEl = row.querySelector('a.Link--primary, .workflow-run-title');
      const statusEl = row.querySelector('[data-testid="workflow-run-status"], .octicon-check, .octicon-x');
      const branchEl = row.querySelector('a[href*="tree/"]');
      const timeEl = row.querySelector('relative-time, time');
      const href = titleEl?.getAttribute('href') ?? '';
      const idMatch = href.match(/\/runs\/(\d+)/);

      runs.push({
        id: idMatch?.[1] ? Number.parseInt(idMatch[1], 10) : 0,
        name: titleEl?.textContent?.trim() ?? '',
        status: statusEl?.getAttribute('aria-label') ?? '',
        conclusion: '',
        head_branch: branchEl?.textContent?.trim() ?? '',
        head_sha: '',
        html_url: href ? `https://github.com${href}` : '',
        created_at: timeEl?.getAttribute('datetime') ?? '',
        updated_at: timeEl?.getAttribute('datetime') ?? '',
      });
    }

    return { workflow_runs: runs };
  },
});
