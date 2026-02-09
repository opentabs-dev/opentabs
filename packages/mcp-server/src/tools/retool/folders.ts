import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolFolderTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List branches
  define(
    'retool_list_branches',
    {
      description: `List all source control branches in Retool.

Returns: branchCount, branches[] (id, name, ownerId, numOfCommits, shared, createdAt, updatedAt).
Use branch names from results with retool_list_commits to see what changed on a branch.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/branches',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: strip elementUuids and hotfix fields, keep essential branch info
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const branches = r.branches as Record<string, unknown>[] | undefined;
        if (Array.isArray(branches)) {
          shaped.branchCount = branches.length;
          shaped.branches = branches.map(b => ({
            id: b.id,
            name: b.name,
            ownerId: b.ownerId,
            numOfCommits: b.numOfCommits,
            shared: b.shared,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
          }));
        }
      }
      return success(shaped);
    },
  );

  // List user tasks (HITL)
  define(
    'retool_list_user_tasks',
    {
      description: `List Human-in-the-Loop (HITL) tasks pending approval or input. Tasks are created by workflows that pause execution until a human responds. Returns task IDs, status, and associated workflow info.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/userTask/',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get workflow usage stats
  define(
    'retool_get_workflow_usage',
    {
      description: `Get workflow billing and usage statistics. Returns current billing period, total billable runs, and usage breakdown by organization.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/workflowUsage/',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // List HITL task definitions
  define(
    'retool_list_task_definitions',
    {
      description:
        'List all HITL (Human-in-the-Loop) task type definitions configured across Retool workflows. Shows what types of human approval tasks exist in the organization.',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/userTask/userTaskDefinitions',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // List vectors (RAG knowledge bases)
  define(
    'retool_list_vectors',
    {
      description:
        'List all vector embeddings and RAG (Retrieval-Augmented Generation) knowledge bases configured in Retool. Vectors power AI-enhanced search in Retool apps and agents.',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/vectors/getVectors',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // List Retool Database grids
  define(
    'retool_list_grids',
    {
      description:
        'List all Retool Database tables (grids). Retool Database is a built-in PostgreSQL database for storing app data. Returns grid IDs, names, and metadata.',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/grid',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
