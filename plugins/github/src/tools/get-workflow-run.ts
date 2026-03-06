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

export const getWorkflowRun = defineTool({
  name: 'get_workflow_run',
  displayName: 'Get Workflow Run',
  description: 'Get detailed information about a specific GitHub Actions workflow run by its run ID.',
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
    const data = await api<RawWorkflowRun>(`/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}`);
    return {
      workflow_run: {
        id: data.id ?? 0,
        name: data.name ?? '',
        status: data.status ?? '',
        conclusion: data.conclusion ?? '',
        head_branch: data.head_branch ?? '',
        head_sha: data.head_sha ?? '',
        html_url: data.html_url ?? '',
        created_at: data.created_at ?? '',
        updated_at: data.updated_at ?? '',
      },
    };
  },
});
