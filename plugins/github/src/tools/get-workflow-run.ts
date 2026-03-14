import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated } from '../github-api.js';
import { workflowRunSchema } from './schemas.js';

export const getWorkflowRun = defineTool({
  name: 'get_workflow_run',
  displayName: 'Get Workflow Run',
  description: 'Get information about a specific GitHub Actions workflow run by its run ID.',
  summary: 'Get a workflow run by ID',
  icon: 'play',
  group: 'Actions',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    run_id: z.number().int().min(1).describe('Workflow run ID'),
  }),
  output: z.object({
    workflow_run: workflowRunSchema.describe('The workflow run'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    const html = await fetchText(`/${params.owner}/${params.repo}/actions/runs/${params.run_id}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');

    const titleEl = doc.querySelector('h1, .workflow-run-title');
    const statusEl = doc.querySelector('[data-testid="conclusion-icon"], .octicon-check, .octicon-x');
    const branchEl = doc.querySelector('a[href*="tree/"]');
    const timeEl = doc.querySelector('relative-time, time');
    const shaEl = doc.querySelector('a[href*="commit/"]');

    return {
      workflow_run: {
        id: params.run_id,
        name: titleEl?.textContent?.trim() ?? '',
        status: statusEl?.getAttribute('aria-label') ?? '',
        conclusion: '',
        head_branch: branchEl?.textContent?.trim() ?? '',
        head_sha: shaEl?.textContent?.trim() ?? '',
        html_url: `https://github.com/${params.owner}/${params.repo}/actions/runs/${params.run_id}`,
        created_at: timeEl?.getAttribute('datetime') ?? '',
        updated_at: timeEl?.getAttribute('datetime') ?? '',
      },
    };
  },
});
