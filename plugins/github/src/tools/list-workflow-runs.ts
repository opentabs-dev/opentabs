import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const workflowRunSchema = z.object({
  id: z.number().describe('Workflow run ID'),
  name: z.string().describe('Workflow name'),
  status: z.string().describe('Run status: queued, in_progress, completed, etc.'),
  conclusion: z.string().describe('Run conclusion: success, failure, cancelled, skipped, etc.'),
  head_branch: z.string().describe('Branch the workflow ran on'),
  head_sha: z.string().describe('HEAD commit SHA'),
  html_url: z.string().describe('URL to the workflow run on GitHub'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

interface RawWorkflowRun {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string;
  head_sha?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
}

interface RawWorkflowRunsResponse {
  total_count?: number;
  workflow_runs?: RawWorkflowRun[];
}

const mapWorkflowRun = (r: RawWorkflowRun) => ({
  id: r.id ?? 0,
  name: r.name ?? '',
  status: r.status ?? '',
  conclusion: r.conclusion ?? '',
  head_branch: r.head_branch ?? '',
  head_sha: r.head_sha ?? '',
  html_url: r.html_url ?? '',
  created_at: r.created_at ?? '',
  updated_at: r.updated_at ?? '',
});

export const listWorkflowRuns = defineTool({
  name: 'list_workflow_runs',
  displayName: 'List Workflow Runs',
  description:
    'List workflow runs for a repository. Optionally filter by workflow ID, branch, or status. Returns runs sorted by creation date.',
  summary: 'List GitHub Actions workflow runs',
  icon: 'play',
  group: 'Actions',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    workflow_id: z.string().optional().describe('Workflow ID or filename to filter by (e.g., "ci.yml")'),
    branch: z.string().optional().describe('Filter by branch name'),
    status: z
      .enum([
        'completed',
        'action_required',
        'cancelled',
        'failure',
        'neutral',
        'skipped',
        'stale',
        'success',
        'timed_out',
        'in_progress',
        'queued',
        'requested',
        'waiting',
        'pending',
      ])
      .optional()
      .describe('Filter by run status'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    total_count: z.number().describe('Total number of matching workflow runs'),
    workflow_runs: z.array(workflowRunSchema).describe('List of workflow runs'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      per_page: params.per_page ?? 30,
      page: params.page,
    };
    if (params.branch) query.branch = params.branch;
    if (params.status) query.status = params.status;

    const endpoint = params.workflow_id
      ? `/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}/runs`
      : `/repos/${params.owner}/${params.repo}/actions/runs`;

    const data = await api<RawWorkflowRunsResponse>(endpoint, { query });
    return {
      total_count: data.total_count ?? 0,
      workflow_runs: (data.workflow_runs ?? []).map(mapWorkflowRun),
    };
  },
});
