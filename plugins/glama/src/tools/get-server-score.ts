import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';

interface ScoreRouteData {
  score?: {
    license?: number | null;
    quality?: number | null;
    security?: number | null;
  };
}

export const getServerScore = defineTool({
  name: 'get_server_score',
  displayName: 'Get Server Score',
  description:
    'Get the quality and security score breakdown for a specific MCP server. Returns license, quality, and security scores as numbers (0-100) or null if unavailable.',
  summary: 'Get quality and security scores for an MCP server',
  icon: 'shield-check',
  group: 'MCP Servers',
  input: z.object({
    namespace: z.string().describe('Owner/namespace slug of the server'),
    slug: z.string().describe('Server slug'),
  }),
  output: z.object({
    licenseScore: z.number().nullable().describe('License score (0-100), null if unavailable'),
    qualityScore: z.number().nullable().describe('Quality score (0-100), null if unavailable'),
    securityScore: z.number().nullable().describe('Security score (0-100), null if unavailable'),
  }),
  handle: async params => {
    const data = await navigateAndLoad<ScoreRouteData>(
      `/mcp/servers/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.slug)}/score`,
      'routes/_public/mcp/servers/~namespace/~slug/_pages/score/_route',
    );

    const score = data.score ?? {};

    return {
      licenseScore: score.license ?? null,
      qualityScore: score.quality ?? null,
      securityScore: score.security ?? null,
    };
  },
});
