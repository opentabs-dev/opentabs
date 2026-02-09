import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolWorkflowTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List workflows
  define(
    'retool_list_workflows',
    {
      description: `List all Retool Workflows with their metadata and folder structure.

Returns: workflowCount, workflows[] (id, name, isEnabled, startTriggerType, resourceNames, createdBy, deployedBy, lastDeployedAt), workflowFolders[].
Use workflow IDs from results with retool_get_workflow, retool_list_workflow_runs, retool_list_workflow_triggers, and retool_get_workflow_releases.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/workflow/',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: drop redundant workflowsDisplayMetadata, keep essential metadata
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const meta = r.workflowsMetadata as Record<string, unknown>[] | undefined;
        if (Array.isArray(meta)) {
          shaped.workflowCount = meta.length;
          shaped.workflows = meta;
        }
        shaped.workflowFolders = r.workflowFolders;
        shaped.universalWorkflowAccess = r.universalWorkflowAccess;
      }
      return success(shaped);
    },
  );

  // Get workflow details
  define(
    'retool_get_workflow',
    {
      description: `Get the full definition of a Retool Workflow including its blocks (steps), configuration, and trigger settings. Optionally specify a source control branch to view that version.`,
      inputSchema: {
        workflowId: z.string().describe('Workflow ID'),
        branchName: z.string().optional().describe('Branch name (for source-controlled workflows)'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ workflowId, branchName, env }) => {
      const params = branchName ? `?branchName=${encodeURIComponent(branchName)}` : '';
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/workflow/${workflowId}${params}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get workflow runs
  define(
    'retool_list_workflow_runs',
    {
      description: `List recent execution runs for a Retool Workflow with pagination.

Returns: rows[] (id, status, triggerType, createdAt, timeTakenToExecuteWorkflow, inputDataSizeBytes, outputDataSizeBytes), canLoadMore.
Use run IDs from results with retool_get_workflow_run and retool_get_workflow_run_log for detailed debugging.`,
      inputSchema: {
        workflowId: z.string().describe('Workflow ID'),
        limit: z.number().optional().default(20).describe('Max results (default: 20)'),
        offset: z.number().optional().default(0).describe('Offset for pagination'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ workflowId, limit, offset, env }) => {
      const queryLimit = Number(limit) || 20;
      const queryOffset = Number(offset) || 0;
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/workflowRun/getRuns?workflowId=${workflowId}&limit=${queryLimit}&offset=${queryOffset}`,
        method: 'POST',
        body: {},
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get workflow run details
  define(
    'retool_get_workflow_run',
    {
      description: `Get the detailed results for a specific workflow run, including status, timing, input/output sizes, and trigger type. Use retool_get_workflow_run_log for block-by-block execution details.`,
      inputSchema: {
        runId: z.string().describe('Workflow run ID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ runId, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/workflowRun/${runId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get workflow run logs
  define(
    'retool_get_workflow_run_log',
    {
      description: `Get execution logs for a workflow run. Returns logs[] (message, timestamp, tags, dropdownData with workflowContext) and top-level status. Each log entry captures a step in the workflow execution.`,
      inputSchema: {
        runId: z.string().describe('Workflow run ID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ runId, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/workflowRun/getLog?runId=${runId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // List workflow triggers
  define(
    'retool_list_workflow_triggers',
    {
      description: `List all triggers configured for a Retool Workflow.

Returns: deployedTriggers[] (currently active) and latestSavedTriggers[] (pending deployment). Each trigger includes id, triggerType (webhook/schedule), triggerOptions (crontab, timezone), and environmentId.`,
      inputSchema: {
        workflowId: z.string().describe('Workflow ID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ workflowId, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/workflowTrigger?workflowId=${workflowId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get workflow run count
  define(
    'retool_get_workflow_run_count',
    {
      description:
        'Get the total execution count for every workflow. Returns a map of workflowId to run count. Useful for identifying active vs dormant workflows and monitoring workflow health.',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/workflowRun/getCountByWorkflow',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get workflow releases
  define(
    'retool_get_workflow_releases',
    {
      description:
        'Get the release/deployment history for a workflow. Returns an array of releases with version, deployer, and timestamps. Useful for understanding when changes were deployed.',
      inputSchema: {
        workflowId: z.string().describe('The workflow ID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ workflowId, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/workflow/${workflowId}/releases`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get workflows configuration
  define(
    'retool_get_workflows_config',
    {
      description:
        'Get the global workflows runtime configuration. Returns Retool backend version, code executor version, Python support, Temporal client status, and other system-level settings.',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/workflow/workflowsConfiguration',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
